import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { AuthService, AuthSession } from '../services/authService';
import { decodeImageChunkFrame, type ChatMediaRelayService } from '../services/chatMediaRelayService';
import type { ChatRelayService } from '../services/chatRelayService';
import type { RoomService } from '../services/roomService';
import { createLogger } from '../utils/logger';
import { attachServerHeartbeat } from './serverHeartbeat';

const logger = createLogger('媒体转发');

type MediaUpgradeContext = {
  roomId: string;
  role: 'admin' | 'guest';
  connectionId: string;
  adminSession?: AuthSession;
};

/**
 * 格式化媒体 WebSocket 关闭原因。
 * @param reason ws close 事件携带的二进制原因；核心分支为空时输出“无”，有内容时按 UTF-8 转为日志文本。
 * @returns 可写入日志的关闭原因。
 */
function formatCloseReason(reason: Buffer): string {
  const text = reason.toString('utf8').trim();

  return text || '无';
}

/**
 * 统一媒体 WebSocket 收到的二进制正文。
 * @param rawMessage ws message 事件正文；核心分支兼容 Buffer、ArrayBuffer 和 Buffer 数组。
 * @returns 可交给图片分片帧解码器的 Buffer。
 */
function normalizeBinaryMessage(rawMessage: RawData): Buffer {
  if (Buffer.isBuffer(rawMessage)) {
    return rawMessage;
  }

  if (rawMessage instanceof ArrayBuffer) {
    return Buffer.from(rawMessage);
  }

  if (Array.isArray(rawMessage)) {
    return Buffer.concat(rawMessage);
  }

  return Buffer.from(rawMessage);
}

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
    const heartbeat = attachServerHeartbeat(socket);
    const sender = { send: (message: string | Buffer) => socket.send(message) };
    const connection = dependencies.chatMediaRelayService.connectMedia(
      { connectionId: context.connectionId, roomId: context.roomId, role: context.role },
      sender
    );

    socket.on('message', (rawMessage, isBinary) => {
      heartbeat.markAlive();

      try {
        if (!isBinary) {
          const message = JSON.parse(rawMessage.toString()) as { type?: string };

          if (message.type === 'ping') {
            socket.send(JSON.stringify({ event: 'pong' }));
            return;
          }

          socket.send(JSON.stringify({ event: 'image:error', message: '图片分片格式错误' }));
          return;
        }

        const message = decodeImageChunkFrame(normalizeBinaryMessage(rawMessage));
        const result = dependencies.chatMediaRelayService.handleChunk(connection.connectionId, message);

        if (!result.ok) {
          socket.send(JSON.stringify({ event: 'image:error', imageId: message.imageId, message: result.message }));
          return;
        }

        socket.send(JSON.stringify({ event: 'image:chunk:ack', imageId: message.imageId, chunkIndex: message.chunkIndex }));
      } catch {
        socket.send(JSON.stringify({ event: 'image:error', message: '图片分片格式错误' }));
      }
    });

    socket.on('error', (error) => {
      logger.error(`媒体连接异常：${connection.roomId} ${connection.role} ${(error as Error).message} bufferedAmount=${socket.bufferedAmount}`);
    });

    socket.on('close', (code, reason) => {
      heartbeat.stop();
      dependencies.chatMediaRelayService.disconnectMedia(connection.connectionId, sender);
      logger.info(
        `媒体连接已断开：${connection.roomId} ${connection.role} code=${code} reason=${formatCloseReason(reason)} bufferedAmount=${socket.bufferedAmount}`
      );
    });

    logger.info(`媒体连接已建立：${connection.roomId} ${connection.role}`);
  });

  return wsServer;
}
