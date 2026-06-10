import crypto from 'node:crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('聊天转发');

export type MessageType = 'text' | 'image';

export type ClientMessage =
  | {
      type: 'text';
      clientMessageId: string;
      targetConnectionId?: string;
      payload: { text: string };
    }
  | {
      type: 'image';
      clientMessageId: string;
      targetConnectionId?: string;
      payload: { mimeType: string; dataUrl: string };
    };

export type RelayConnection = {
  connectionId: string;
  roomId: string;
  role: 'admin' | 'guest';
  adminId?: string;
  username: string;
};

export type MessageSender = {
  send: (message: string) => void;
};

type InternalConnection = RelayConnection & {
  sender: MessageSender;
};

type ChatRelayOptions = {
  now?: () => Date;
  maxImageBytes?: number;
};

/**
 * 聊天消息转发服务。
 * 职责：维护在线连接并实时转发消息；关键参数为连接 ID、房间 ID 和客户端消息；核心分支为管理员发访客、访客发管理员和目标离线。
 */
export class ChatRelayService {
  private readonly connections = new Map<string, InternalConnection>();
  private readonly now: () => Date;
  private readonly maxImageBytes: number;

  constructor(options: ChatRelayOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxImageBytes = options.maxImageBytes ?? 1024 * 1024 * 2;
  }

  /**
   * 注册管理员连接。
   * @param roomId 房间 ID。
   * @param adminId 管理员 ID。
   * @param sender 消息发送器，生产环境为 WebSocket。
   * @returns 连接摘要。
   */
  connectAdmin(roomId: string, adminId: string, sender: MessageSender): RelayConnection {
    const connection = this.createConnection(roomId, 'admin', sender, {
      adminId,
      username: '管理员'
    });
    logger.info(`管理员连接聊天室：${roomId}`);
    return this.toPublicConnection(connection);
  }

  /**
   * 注册访客连接。
   * @param roomId 房间 ID。
   * @param sender 消息发送器，生产环境为 WebSocket。
   * @returns 自动生成用户名后的连接摘要。
   */
  connectGuest(roomId: string, sender: MessageSender): RelayConnection {
    const timestamp = this.now().getTime();
    const connection = this.createConnection(roomId, 'guest', sender, {
      username: `用户-${timestamp}`
    });
    logger.info(`访客连接聊天室：${roomId}`);
    return this.toPublicConnection(connection);
  }

  /**
   * 移除在线连接。
   * @param connectionId 连接 ID。
   */
  disconnect(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * 处理客户端消息并转发给目标连接。
   * @param connectionId 发送方连接 ID。
   * @param message 客户端消息，支持 text 和 image。
   */
  handleClientMessage(connectionId: string, message: ClientMessage): void {
    const sender = this.connections.get(connectionId);

    if (!sender) {
      return;
    }

    const error = this.validateMessage(message);

    if (error) {
      this.sendEvent(sender, 'message:error', { clientMessageId: message.clientMessageId, message: error });
      return;
    }

    const target = this.findTarget(sender, message.targetConnectionId);

    if (!target) {
      this.sendEvent(sender, 'message:error', {
        clientMessageId: message.clientMessageId,
        message: sender.role === 'guest' ? '管理员当前不在线' : '访客当前不在线'
      });
      return;
    }

    const relayMessage = {
      event: 'message:new',
      serverMessageId: crypto.randomUUID(),
      roomId: sender.roomId,
      type: message.type,
      from: this.toPublicConnection(sender),
      to: this.toPublicConnection(target),
      clientMessageId: message.clientMessageId,
      sentAt: this.now().toISOString(),
      payload: message.payload
    };

    target.sender.send(JSON.stringify(relayMessage));
    this.sendEvent(sender, 'message:ack', { clientMessageId: message.clientMessageId });
    logger.info(`消息转发成功：${sender.roomId} ${message.type} ${sender.role}`);
  }

  private createConnection(
    roomId: string,
    role: 'admin' | 'guest',
    sender: MessageSender,
    data: { adminId?: string; username: string }
  ): InternalConnection {
    const connection = {
      connectionId: crypto.randomUUID(),
      roomId,
      role,
      adminId: data.adminId,
      username: data.username,
      sender
    };

    this.connections.set(connection.connectionId, connection);
    return connection;
  }

  private findTarget(sender: InternalConnection, targetConnectionId?: string): InternalConnection | null {
    if (sender.role === 'guest') {
      return (
        [...this.connections.values()].find(
          (connection) => connection.roomId === sender.roomId && connection.role === 'admin'
        ) ?? null
      );
    }

    if (!targetConnectionId) {
      return null;
    }

    const target = this.connections.get(targetConnectionId);

    if (!target || target.roomId !== sender.roomId || target.role !== 'guest') {
      return null;
    }

    return target;
  }

  private validateMessage(message: ClientMessage): string | null {
    if (message.type === 'text') {
      return message.payload.text.trim() ? null : '文本消息不能为空';
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(message.payload.mimeType)) {
      return '图片类型不支持';
    }

    const base64 = message.payload.dataUrl.split(',')[1] ?? '';
    const size = Buffer.byteLength(base64, 'base64');

    if (size > this.maxImageBytes) {
      return '图片大小超过限制';
    }

    return null;
  }

  private sendEvent(connection: InternalConnection, event: string, payload: Record<string, unknown>): void {
    connection.sender.send(JSON.stringify({ event, ...payload }));
  }

  private toPublicConnection(connection: InternalConnection): RelayConnection {
    return {
      connectionId: connection.connectionId,
      roomId: connection.roomId,
      role: connection.role,
      adminId: connection.adminId,
      username: connection.username
    };
  }
}
