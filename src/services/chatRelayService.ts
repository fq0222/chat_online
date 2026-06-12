import crypto from 'node:crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('聊天转发');

export type MessageType = 'text' | 'image' | 'image:start';

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
    }
  | {
      type: 'image:start';
      clientMessageId: string;
      targetConnectionId?: string;
      payload: {
        imageId: string;
        mimeType: string;
        size: number;
        chunkSize: number;
        totalChunks: number;
        previewDataUrl: string;
      };
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
 * 格式化图片载荷体积。
 * @param bytes 字节数；核心分支为超过 1MB 时输出 MB，否则输出 KB。
 * @returns 面向日志的体积文本。
 */
function formatPayloadBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

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
    this.maxImageBytes = options.maxImageBytes ?? 1024 * 1024 * 5;
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
    this.sendRoomUsers(roomId);
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
    this.sendRoomUsers(roomId);
    logger.info(`访客连接聊天室：${roomId}`);
    return this.toPublicConnection(connection);
  }

  /**
   * 移除在线连接。
   * @param connectionId 连接 ID。
   */
  disconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      return;
    }

    this.connections.delete(connectionId);
    this.sendRoomUsers(connection.roomId);
  }

  /**
   * 查询当前控制通道连接。
   * @param connectionId 控制通道连接 ID；核心分支为媒体通道握手校验提供同房间、同角色的连接摘要。
   * @returns 连接在线时返回公开连接摘要，否则返回 null。
   */
  getConnection(connectionId: string): RelayConnection | null {
    const connection = this.connections.get(connectionId);

    return connection ? this.toPublicConnection(connection) : null;
  }

  /**
   * 处理客户端消息并转发给目标连接。
   * @param connectionId 发送方连接 ID。
   * @param message 客户端消息，支持 text、image 和 image:start。
   */
  handleClientMessage(connectionId: string, message: ClientMessage): void {
    const startedAt = Date.now();
    const sender = this.connections.get(connectionId);

    if (!sender) {
      return;
    }

    if (message.type === 'image') {
      logger.info(
        `图片消息开始处理：${sender.roomId} ${sender.role} ${message.payload.mimeType} ` +
          `载荷 ${formatPayloadBytes(Buffer.byteLength(message.payload.dataUrl, 'utf8'))}`
      );
    } else if (message.type === 'image:start') {
      logger.info(
        `图片开始控制消息：${sender.roomId} ${sender.role} ${message.payload.mimeType} ` +
          `图片 ${formatPayloadBytes(message.payload.size)} 分片 ${message.payload.totalChunks}`
      );
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
      payload: this.createRelayPayload(message)
    };

    target.sender.send(JSON.stringify(relayMessage));
    this.sendEvent(sender, 'message:ack', { clientMessageId: message.clientMessageId });

    if (message.type === 'image') {
      logger.info(`图片消息转发完成：${sender.roomId} ${sender.role} 耗时 ${Date.now() - startedAt}ms`);
    } else if (message.type === 'image:start') {
      logger.info(`图片开始控制消息转发完成：${sender.roomId} ${sender.role} 耗时 ${Date.now() - startedAt}ms`);
    }

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

    if (message.type === 'image:start') {
      const { imageId, mimeType, size, chunkSize, totalChunks } = message.payload;

      if (!imageId.trim()) {
        return '图片 ID 不能为空';
      }

      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
        return '图片类型不支持';
      }

      if (!Number.isSafeInteger(size) || size <= 0 || size > this.maxImageBytes) {
        return '图片大小超过限制';
      }

      if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 64 * 1024) {
        return '图片分片大小不合法';
      }

      if (!Number.isSafeInteger(totalChunks) || totalChunks <= 0) {
        return '图片分片数量不合法';
      }

      if (Math.ceil(size / chunkSize) !== totalChunks) {
        return '图片分片数量不匹配';
      }

      return null;
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

  /**
   * 构造允许转发给对端的消息载荷。
   * @param message 客户端消息；核心分支为 image:start 只保留占位元数据，避免运行时夹带完整图片正文。
   * @returns 可安全转发的消息载荷。
   */
  private createRelayPayload(message: ClientMessage): ClientMessage['payload'] {
    if (message.type === 'image:start') {
      const { imageId, mimeType, size, chunkSize, totalChunks, previewDataUrl } = message.payload;

      return { imageId, mimeType, size, chunkSize, totalChunks, previewDataUrl };
    }

    return message.payload;
  }

  private sendEvent(connection: InternalConnection, event: string, payload: Record<string, unknown>): void {
    connection.sender.send(JSON.stringify({ event, ...payload }));
  }

  /**
   * 向房间内管理员推送当前在线用户列表。
   * @param roomId 房间 ID；核心分支按管理员优先、访客随后输出，供前端左侧用户列表实时刷新。
   */
  private sendRoomUsers(roomId: string): void {
    const users = [...this.connections.values()]
      .filter((connection) => connection.roomId === roomId)
      .sort((left, right) => (left.role === right.role ? 0 : left.role === 'admin' ? -1 : 1))
      .map((connection) => this.toPublicConnection(connection));

    [...this.connections.values()]
      .filter((connection) => connection.roomId === roomId && connection.role === 'admin')
      .forEach((connection) => {
        this.sendEvent(connection, 'room:users', { users });
      });
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
