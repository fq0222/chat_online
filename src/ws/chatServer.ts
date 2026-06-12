import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AuthService, AuthSession } from '../services/authService';
import type { ChatRelayService, ClientMessage } from '../services/chatRelayService';
import type { RoomService } from '../services/roomService';
import { createLogger } from '../utils/logger';

const logger = createLogger('WebSocket');
const websocketHeartbeatMs = 25 * 1000;

type ChatUpgradeContext = {
  roomId: string;
  role: string;
  adminSession?: AuthSession;
  welcomeMessage?: string;
  guestIdentity?: {
    guestSessionId?: string;
    username?: string;
  };
};

/**
 * 为服务端 WebSocket 添加协议层心跳。
 * @param socket WebSocket 连接；核心分支为定时 ping，连续无 pong 时终止僵尸连接。
 * @returns 清理心跳定时器的方法。
 */
function attachServerHeartbeat(socket: WebSocket): () => void {
  let isAlive = true;
  const heartbeatTimer = setInterval(() => {
    if (!isAlive) {
      socket.terminate();
      return;
    }

    isAlive = false;
    socket.ping();
  }, websocketHeartbeatMs);

  socket.on('pong', () => {
    isAlive = true;
  });

  return () => {
    clearInterval(heartbeatTimer);
  };
}

/**
 * 挂载聊天室 WebSocket 服务。
 * @param server HTTP 服务实例。
 * @param dependencies 房间、鉴权和转发服务。
 * @returns WebSocketServer 实例。
 */
export function attachChatServer(
  server: http.Server,
  dependencies: {
    roomService: RoomService;
    authService: AuthService;
    chatRelayService: ChatRelayService;
  }
): WebSocketServer {
  const wsServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost');

    if (url.pathname !== '/ws/chat') {
      return;
    }

    const roomId = url.searchParams.get('roomId');
    const role = url.searchParams.get('role');
    const token = url.searchParams.get('token') ?? undefined;
    const guestSessionId = url.searchParams.get('guestSessionId') ?? undefined;
    const guestName = url.searchParams.get('guestName') ?? undefined;

    if (!roomId || (role !== 'admin' && role !== 'guest')) {
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

    wsServer.handleUpgrade(request, socket, head, (socketInstance) => {
      wsServer.emit('connection', socketInstance, request, {
        roomId,
        role,
        adminSession: role === 'admin' ? session : undefined,
        guestIdentity: role === 'guest' ? { guestSessionId, username: guestName } : undefined,
        welcomeMessage: room.welcomeMessage
      });
    });
  });

  wsServer.on('connection', (socket: WebSocket, _request: IncomingMessage, context: ChatUpgradeContext) => {
    const stopHeartbeat = attachServerHeartbeat(socket);
    const sender = { send: (message: string) => socket.send(message) };
    const connection =
      context.role === 'admin' && context.adminSession
        ? dependencies.chatRelayService.connectAdmin(context.roomId, context.adminSession.adminId, sender)
        : dependencies.chatRelayService.connectGuest(context.roomId, sender, context.guestIdentity);

    socket.send(JSON.stringify({ event: 'connection:ready', connection }));

    if (context.role === 'guest' && context.welcomeMessage) {
      dependencies.chatRelayService.sendWelcomeMessageToGuest(context.roomId, connection.connectionId, context.welcomeMessage);
    }

    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString()) as ClientMessage;

        if ((message as { type?: string }).type === 'ping') {
          socket.send(JSON.stringify({ event: 'pong' }));
          return;
        }

        dependencies.chatRelayService.handleClientMessage(connection.connectionId, message);
      } catch (error) {
        socket.send(JSON.stringify({ event: 'message:error', message: '消息格式错误' }));
      }
    });

    socket.on('close', () => {
      stopHeartbeat();
      dependencies.chatRelayService.disconnect(connection.connectionId);
      logger.info(`连接已断开：${connection.roomId} ${connection.role}`);
    });
  });

  return wsServer;
}
