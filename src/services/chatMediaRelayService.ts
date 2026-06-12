export type MediaRole = 'admin' | 'guest';

export type MediaConnection = {
  connectionId: string;
  roomId: string;
  role: MediaRole;
};

export type MediaSender = {
  send: (message: string) => void;
};

export type ImageChunkMessage = {
  type: 'image:chunk';
  imageId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type ImageTransferSession = {
  imageId: string;
  roomId: string;
  fromConnectionId: string;
  toConnectionId: string;
  totalChunks: number;
  chunkSize: number;
  size: number;
};

type InternalMediaConnection = MediaConnection & {
  sender: MediaSender;
};

type InternalImageTransferSession = ImageTransferSession & {
  receivedChunks: Set<number>;
  receivedBytesByChunk: Map<number, number>;
  pendingChunks: Map<number, ImageChunkMessage>;
  updatedAt: number;
};

type ChatMediaRelayOptions = {
  now?: () => number;
  maxSessionIdleMs?: number;
};

export type ChunkResult =
  | { ok: true; complete: boolean; receivedChunks: number; totalChunks: number }
  | { ok: false; message: string };

/**
 * 聊天图片媒体分片转发服务。
 * 职责：维护媒体 WebSocket 连接和短暂图片传输会话；关键参数为 imageId、连接 ID 和分片序号；核心分支为直接转发、完成清理和失败拒绝。
 */
export class ChatMediaRelayService {
  private readonly connections = new Map<string, InternalMediaConnection>();
  private readonly transfers = new Map<string, InternalImageTransferSession>();
  private readonly now: () => number;
  private readonly maxSessionIdleMs: number;

  constructor(options: ChatMediaRelayOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxSessionIdleMs = options.maxSessionIdleMs ?? 2 * 60 * 1000;
  }

  /**
   * 注册媒体连接。
   * @param connection 媒体连接摘要，connectionId 必须与控制通道连接 ID 一致。
   * @param sender 消息发送器，生产环境为 WebSocket。
   * @returns 注册后的连接摘要。
   */
  connectMedia(connection: MediaConnection, sender: MediaSender): MediaConnection {
    this.connections.set(connection.connectionId, { ...connection, sender });
    this.flushPendingChunksForConnection(connection.connectionId);
    return connection;
  }

  /**
   * 移除媒体连接。
   * @param connectionId 媒体连接 ID；核心分支只移除连接，保留短暂传输会话等待同一控制连接重建媒体通道。
   */
  disconnectMedia(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * 开始一张图片的短暂传输会话。
   * @param session 传输元数据；核心分支只保存分片路由和进度信息，不保存图片正文。
   */
  startTransfer(session: ImageTransferSession): void {
    this.cleanupExpiredTransfers();
    this.transfers.set(session.imageId, {
      ...session,
      receivedChunks: new Set<number>(),
      receivedBytesByChunk: new Map<number, number>(),
      pendingChunks: new Map<number, ImageChunkMessage>(),
      updatedAt: this.now()
    });
  }

  /**
   * 处理并转发图片分片。
   * @param senderConnectionId 发送分片的媒体连接 ID。
   * @param message 图片分片消息；核心分支校验 imageId、发送方、分片序号和目标连接。
   * @returns 分片处理结果。
   */
  handleChunk(senderConnectionId: string, message: ImageChunkMessage): ChunkResult {
    this.cleanupExpiredTransfers();
    const transfer = this.transfers.get(message.imageId);

    if (!transfer) {
      return { ok: false, message: '图片传输不存在' };
    }

    if (transfer.fromConnectionId !== senderConnectionId) {
      return { ok: false, message: '图片发送方不匹配' };
    }

    if (message.totalChunks !== transfer.totalChunks || message.chunkIndex < 0 || message.chunkIndex >= transfer.totalChunks) {
      return { ok: false, message: '图片分片序号无效' };
    }

    if (!message.data.trim()) {
      return { ok: false, message: '图片分片正文不能为空' };
    }

    const chunkBytes = this.getBase64ByteLength(message.data);

    if (chunkBytes === null) {
      return { ok: false, message: '图片分片正文格式错误' };
    }

    if (chunkBytes > transfer.chunkSize) {
      return { ok: false, message: '图片分片大小超过限制' };
    }

    const receivedBytes = [...transfer.receivedBytesByChunk.entries()]
      .filter(([chunkIndex]) => chunkIndex !== message.chunkIndex)
      .reduce((total, [, bytes]) => total + bytes, 0);

    if (receivedBytes + chunkBytes > transfer.size) {
      return { ok: false, message: '图片累计大小超过限制' };
    }

    const isNewChunk = !transfer.receivedChunks.has(message.chunkIndex);

    if (isNewChunk) {
      transfer.receivedChunks.add(message.chunkIndex);
      transfer.receivedBytesByChunk.set(message.chunkIndex, chunkBytes);
    }

    transfer.updatedAt = this.now();

    if (isNewChunk) {
      const target = this.connections.get(transfer.toConnectionId);

      if (target) {
        this.sendChunkToTarget(target, message);
      } else {
        transfer.pendingChunks.set(message.chunkIndex, message);
      }
    }

    const complete = transfer.receivedChunks.size === transfer.totalChunks;

    if (complete && transfer.pendingChunks.size === 0) {
      this.transfers.delete(message.imageId);
    }

    return {
      ok: true,
      complete,
      receivedChunks: transfer.receivedChunks.size,
      totalChunks: transfer.totalChunks
    };
  }

  /**
   * 向接收方媒体连接发送图片分片。
   * @param target 接收方媒体连接；核心分支只发送单个已校验分片，不修改传输会话状态。
   * @param message 已通过校验的图片分片消息。
   */
  private sendChunkToTarget(target: InternalMediaConnection, message: ImageChunkMessage): void {
    target.sender.send(
      JSON.stringify({
        event: 'image:chunk',
        imageId: message.imageId,
        chunkIndex: message.chunkIndex,
        totalChunks: message.totalChunks,
        data: message.data
      })
    );
  }

  /**
   * 补发指定接收方媒体连接建立前暂存的图片分片。
   * @param connectionId 刚建立的媒体连接 ID；核心分支只处理以该连接为接收方的传输会话，补发完成且收齐后清理会话。
   */
  private flushPendingChunksForConnection(connectionId: string): void {
    const target = this.connections.get(connectionId);

    if (!target) {
      return;
    }

    [...this.transfers.entries()].forEach(([imageId, transfer]) => {
      if (transfer.toConnectionId !== connectionId || !transfer.pendingChunks.size) {
        return;
      }

      [...transfer.pendingChunks.values()]
        .sort((left, right) => left.chunkIndex - right.chunkIndex)
        .forEach((message) => this.sendChunkToTarget(target, message));
      transfer.pendingChunks.clear();
      transfer.updatedAt = this.now();

      if (transfer.receivedChunks.size === transfer.totalChunks) {
        this.transfers.delete(imageId);
      }
    });
  }

  /**
   * 计算 base64 正文解码后的字节数。
   * @param data base64 分片正文；核心分支先校验字符和填充，再计算实际字节数。
   * @returns 合法时返回字节数，否则返回 null。
   */
  private getBase64ByteLength(data: string): number | null {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
      return null;
    }

    return Buffer.byteLength(data, 'base64');
  }

  /**
   * 清理闲置过久的传输会话。
   * 核心分支：每次开始传输或处理分片前触发，避免未完成图片长期占用内存元数据。
   */
  private cleanupExpiredTransfers(): void {
    const now = this.now();

    [...this.transfers.entries()].forEach(([imageId, transfer]) => {
      if (now - transfer.updatedAt > this.maxSessionIdleMs) {
        this.transfers.delete(imageId);
      }
    });
  }
}
