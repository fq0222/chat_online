import type { ImageChunk } from './imageChunkTransfer';

export type MediaSocketHandlers = {
  onChunk: (message: { imageId: string; chunkIndex: number; totalChunks: number; data: string }) => void;
  onError: (message: { imageId?: string; message?: string }) => void;
};

type QueuedChunk = {
  imageId: string;
  chunk: ImageChunk;
};

/**
 * 创建图片媒体 WebSocket 客户端。
 * @param url 媒体 WebSocket 地址。
 * @param handlers 媒体事件处理器；核心分支为接收图片分片和错误事件。
 * @returns 连接控制和分片发送方法。
 */
export function createMediaSocket(url: string, handlers: MediaSocketHandlers) {
  const socket = new WebSocket(url);
  const queue: QueuedChunk[] = [];

  /**
   * 发送已排队的图片分片。
   * 核心分支：仅在 socket 打开后发送，避免图片发送等待媒体连接握手。
   */
  function flushQueue(): void {
    while (socket.readyState === WebSocket.OPEN && queue.length) {
      const item = queue.shift();

      if (!item) {
        return;
      }

      socket.send(JSON.stringify({ type: 'image:chunk', imageId: item.imageId, ...item.chunk }));
    }
  }

  socket.addEventListener('open', flushQueue);
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data) as {
      event: string;
      imageId?: string;
      chunkIndex?: number;
      totalChunks?: number;
      data?: string;
      message?: string;
    };

    if (data.event === 'image:chunk' && data.imageId && typeof data.chunkIndex === 'number' && typeof data.totalChunks === 'number' && data.data) {
      handlers.onChunk({ imageId: data.imageId, chunkIndex: data.chunkIndex, totalChunks: data.totalChunks, data: data.data });
      return;
    }

    if (data.event === 'image:error') {
      handlers.onError({ imageId: data.imageId, message: data.message });
    }
  });

  return {
    socket,
    /**
     * 发送或排队一个图片分片。
     * @param imageId 图片传输 ID。
     * @param chunk 图片分片；核心分支为连接未打开时先排队，避免阻塞文字通道。
     */
    sendChunk(imageId: string, chunk: ImageChunk): void {
      queue.push({ imageId, chunk });
      flushQueue();
    },
    /**
     * 判断媒体连接是否可直接发送。
     * @returns true 表示 WebSocket 已打开。
     */
    isOpen(): boolean {
      return socket.readyState === WebSocket.OPEN;
    },
    /**
     * 主动关闭媒体连接。
     * 核心分支：页面切换或控制通道重连时调用，避免旧媒体连接继续发送分片。
     */
    close(): void {
      queue.length = 0;
      socket.close();
    }
  };
}
