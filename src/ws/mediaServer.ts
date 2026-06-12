import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AuthService, AuthSession } from '../services/authService';
import type { ChatMediaRelayService, ImageChunkMessage } from '../services/chatMediaRelayService';
import type { ChatRelayService } from '../services/chatRelayService';
import type { RoomService } from '../services/roomService';
import { createLogger } from '../utils/logger';

const logger = createLogger('媒体转发');

type MediaUpgradeContext = {
  roomId: string;
  role: 'admin' | 'guest';
  connectionId: string;
  adminSession?: AuthSession;
};

/**
 * 挂载图片媒体 WebSocket 服务。
 * @param server HTTP 服务实例。
 * @param dependencies 房间、鉴权、聊天控制通道和媒体转发服务。
 * @returns WebSocketServer 实例。
 */
export function attachMediaServer(
  server: http.Server,
  dependencies: {
    roomService: RoomService;
    authService: AuthService;
    chatRelayService: ChatRelayService;
    chatMediaRelayService: ChatMediaRelayService;
  }
): WebSocketServer {
  const wsServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost');

    if (url.pathname !== '/ws/media') {
      return;
    }

    const roomId = url.searchParams.get('roomId');
    const role = url.searchParams.get('role');
    const connectionId = url.searchParams.get('connectionId');
    const token = url.searchParams.get('token') ?? undefined;

    if (!roomId || !connectionId || (role !== 'admin' && role !== 'guest')) {
      socket.destroy();
      return;
    }

    const room = await dependencies.roomService.getRoomInfo(roomId);

    if (!room) {
      socket.destroy();
      return;
    }

    const session = await dependencies.authService.verifyToken(token);

    if (role === 'admin' && (!session || session.isBootstrap)) {
      socket.destroy();
      return;
    }

    const controlConnection = dependencies.chatRelayService.getConnection(connectionId);

    if (!controlConnection || controlConnection.roomId !== roomId || controlConnection.role !== role) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (socketInstance) => {
      wsServer.emit('connection', socketInstance, request, {
        roomId,
        role,
        connectionId,
        adminSession: role === 'admin' ? session : undefined
      });
    });
  });

  wsServer.on('connection', (socket: WebSocket, _request: IncomingMessage, context: MediaUpgradeContext) => {
    const sender = { send: (message: string) => socket.send(message) };
    const connection = dependencies.chatMediaRelayService.connectMedia(
      { connectionId: context.connectionId, roomId: context.roomId, role: context.role },
      sender
    );

    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString()) as ImageChunkMessage;
        const result = dependencies.chatMediaRelayService.handleChunk(connection.connectionId, message);

        if (!result.ok) {
          socket.send(JSON.stringify({ event: 'image:error', imageId: message.imageId, message: result.message }));
        }
      } catch {
        socket.send(JSON.stringify({ event: 'image:error', message: '图片分片格式错误' }));
      }
    });

    socket.on('close', () => {
      dependencies.chatMediaRelayService.disconnectMedia(connection.connectionId);
      logger.info(`媒体连接已断开：${connection.roomId} ${connection.role}`);
    });

    logger.info(`媒体连接已建立：${connection.roomId} ${connection.role}`);
  });

  return wsServer;
}
