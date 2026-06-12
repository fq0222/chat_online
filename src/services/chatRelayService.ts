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
        previewDataUrl?: string;
      };
    };

export type RelayConnection = {
  connectionId: string;
  roomId: string;
  role: 'admin' | 'guest';
  adminId?: string;
  guestSessionId?: string;
  username: string;
};

export type MessageSender = {
  send: (message: string) => void;
};

type InternalConnection = RelayConnection & {
  sender: MessageSender;
};

type GuestIdentity = {
  guestSessionId?: string;
  username?: string;
};

type ChatRelayOptions = {
  now?: () => Date;
  maxImageBytes?: number;
  maxPreviewBytes?: number;
  onImageStart?: (session: {
    imageId: string;
    roomId: string;
    fromConnectionId: string;
    toConnectionId: string;
    totalChunks: number;
    chunkSize: number;
    size: number;
  }) => void;
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
  private readonly maxPreviewBytes: number;
  private readonly onImageStart?: ChatRelayOptions['onImageStart'];

  constructor(options: ChatRelayOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxImageBytes = options.maxImageBytes ?? 1024 * 1024 * 5;
    this.maxPreviewBytes = options.maxPreviewBytes ?? 1024 * 64;
    this.onImageStart = options.onImageStart;
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
  connectGuest(roomId: string, sender: MessageSender, identity: GuestIdentity = {}): RelayConnection {
    const timestamp = this.now().getTime();
    const guestSessionId = this.normalizeGuestSessionId(identity.guestSessionId);
    const username = this.normalizeGuestUsername(identity.username) ?? `用户-${timestamp}`;
    const connection = this.createConnection(roomId, 'guest', sender, {
      guestSessionId,
      username
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
   * 向指定访客自动发送房间首次进入欢迎语。
   * @param roomId 房间 ID；核心分支会校验目标访客仍在该房间内，避免跨房间误发。
   * @param guestConnectionId 访客连接 ID；管理员连接不会收到也不会触发欢迎语。
   * @param welcomeMessage 管理员配置的欢迎语；空白文本会被忽略。
   */
  sendWelcomeMessageToGuest(roomId: string, guestConnectionId: string, welcomeMessage: string): void {
    const text = welcomeMessage.trim();

    if (!text) {
      return;
    }

    const guest = this.connections.get(guestConnectionId);

    if (!guest || guest.roomId !== roomId || guest.role !== 'guest') {
      return;
    }

    const from: RelayConnection = {
      connectionId: `room-welcome:${roomId}`,
      roomId,
      role: 'admin',
      username: '管理员'
    };

    guest.sender.send(
      JSON.stringify({
        event: 'message:new',
        serverMessageId: crypto.randomUUID(),
        roomId,
        type: 'text',
        from,
        to: this.toPublicConnection(guest),
        sentAt: this.now().toISOString(),
        payload: { text }
      })
    );
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

    if (message.type === 'image:start') {
      this.onImageStart?.({
        imageId: message.payload.imageId,
        roomId: sender.roomId,
        fromConnectionId: sender.connectionId,
        toConnectionId: target.connectionId,
        totalChunks: message.payload.totalChunks,
        chunkSize: message.payload.chunkSize,
        size: message.payload.size
      });
    }

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
    data: { adminId?: string; guestSessionId?: string; username: string }
  ): InternalConnection {
    const connection = {
      connectionId: crypto.randomUUID(),
      roomId,
      role,
      adminId: data.adminId,
      guestSessionId: data.guestSessionId,
      username: data.username,
      sender
    };

    this.connections.set(connection.connectionId, connection);
    return connection;
  }

  /**
   * 规范化访客浏览器会话标识。
   * @param guestSessionId 客户端本地保存的访客会话 ID；核心分支为只接受短横线、下划线和字母数字，避免把任意查询串透传到管理端。
   * @returns 合法会话 ID，不合法或为空时返回 undefined 并退回一次性连接身份。
   */
  private normalizeGuestSessionId(guestSessionId: string | undefined): string | undefined {
    const value = guestSessionId?.trim();

    if (!value || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
      return undefined;
    }

    return value;
  }

  /**
   * 规范化访客展示名称。
   * @param username 客户端随稳定会话传回的显示名；核心分支为去除首尾空白并限制长度，空值继续使用服务端默认名称。
   * @returns 可展示的访客名称，不合法或为空时返回 undefined。
   */
  private normalizeGuestUsername(username: string | undefined): string | undefined {
    const value = username?.trim();

    if (!value) {
      return undefined;
    }

    return value.slice(0, 40);
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
      const { imageId, mimeType, size, chunkSize, totalChunks, previewDataUrl } = message.payload;

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

      return this.validatePreviewDataUrl(previewDataUrl, mimeType);
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

    return previewDataUrl ? { imageId, mimeType, size, chunkSize, totalChunks, previewDataUrl } : { imageId, mimeType, size, chunkSize, totalChunks };
  }

    return message.payload;
  }

  /**
   * 校验图片开始事件里的轻量预览图。
   * @param previewDataUrl 预览图 dataURL；核心分支限制 MIME 与图片一致且体积足够小，避免控制通道重新承载完整图片。
   * @param mimeType 图片 MIME 类型。
   * @returns 校验失败文案，校验通过时返回 null。
   */
  private validatePreviewDataUrl(previewDataUrl: string | undefined, mimeType: string): string | null {
    if (!previewDataUrl) {
      return null;
    }

    const prefix = `data:${mimeType};base64,`;

    if (!previewDataUrl.startsWith(prefix)) {
      return '图片预览格式不合法';
    }

    const base64 = previewDataUrl.slice(prefix.length);

    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
      return '图片预览格式不合法';
    }

    if (Buffer.byteLength(base64, 'base64') > this.maxPreviewBytes) {
      return '图片预览过大';
    }

    return null;
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
      guestSessionId: connection.guestSessionId,
      username: connection.username
    };
  }
}
