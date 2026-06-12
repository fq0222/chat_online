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
  updatedAt: number;
};

type ChatMediaRelayOptions = {
  now?: () => number;
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

  constructor(options: ChatMediaRelayOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 注册媒体连接。
   * @param connection 媒体连接摘要，connectionId 必须与控制通道连接 ID 一致。
   * @param sender 消息发送器，生产环境为 WebSocket。
   * @returns 注册后的连接摘要。
   */
  connectMedia(connection: MediaConnection, sender: MediaSender): MediaConnection {
    this.connections.set(connection.connectionId, { ...connection, sender });
    return connection;
  }

  /**
   * 移除媒体连接。
   * @param connectionId 媒体连接 ID；核心分支只移除连接，不影响文字控制通道。
   */
  disconnectMedia(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * 开始一张图片的短暂传输会话。
   * @param session 传输元数据；核心分支只保存分片路由和进度信息，不保存图片正文。
   */
  startTransfer(session: ImageTransferSession): void {
    this.transfers.set(session.imageId, {
      ...session,
      receivedChunks: new Set<number>(),
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

    const target = this.connections.get(transfer.toConnectionId);

    if (!target) {
      this.transfers.delete(message.imageId);
      return { ok: false, message: '图片接收方已离线' };
    }

    transfer.receivedChunks.add(message.chunkIndex);
    transfer.updatedAt = this.now();
    target.sender.send(
      JSON.stringify({
        event: 'image:chunk',
        imageId: message.imageId,
        chunkIndex: message.chunkIndex,
        totalChunks: message.totalChunks,
        data: message.data
      })
    );

    const complete = transfer.receivedChunks.size === transfer.totalChunks;

    if (complete) {
      this.transfers.delete(message.imageId);
    }

    return {
      ok: true,
      complete,
      receivedChunks: transfer.receivedChunks.size,
      totalChunks: transfer.totalChunks
    };
  }
}
