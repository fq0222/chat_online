import { decodeImageChunkFrame, encodeImageChunkFrame, type ImageChunk } from './imageChunkTransfer';

export type MediaSocketHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onChunk: (message: { imageId: string; chunkIndex: number; totalChunks: number; data: ArrayBuffer }) => void;
  onError: (message: { imageId?: string; message?: string }) => void;
};

type QueuedChunk = {
  imageId: string;
  chunk: ImageChunk;
  resolve: () => void;
  reject: (error: Error) => void;
};

const mediaHeartbeatMs = 25 * 1000;
const mediaSendHighWatermarkBytes = 512 * 1024;
const mediaSendLowWatermarkBytes = 256 * 1024;
const mediaSendBatchSize = 4;
const mediaSendPumpDelayMs = 16;

/**
 * 创建图片媒体 WebSocket 客户端。
 * @param url 媒体 WebSocket 地址。
 * @param handlers 媒体事件处理器；核心分支为接收图片分片和错误事件。
 * @returns 连接控制和分片发送方法。
 */
export function createMediaSocket(url: string, handlers: MediaSocketHandlers) {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const queue: QueuedChunk[] = [];
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByClient = false;

  /**
   * 清理媒体分片发送定时器。
   * 核心分支：连接关闭或主动重建时停止发送泵，避免旧连接继续消费队列。
   */
  function clearSendTimer(): void {
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
  }

  /**
   * 判断当前媒体连接是否需要等待底层发送缓冲释放。
   * @returns true 表示 bufferedAmount 已超过高水位，需要暂停发送。
   */
  function shouldPauseForBackpressure(): boolean {
    return socket.bufferedAmount >= mediaSendHighWatermarkBytes;
  }

  /**
   * 安排下一轮媒体分片发送。
   * @param delayMs 延迟毫秒数；核心分支为缓冲过高时短暂轮询，连接可写时继续推进队列。
   */
  function scheduleFlushQueue(delayMs = 0): void {
    if (sendTimer || socket.readyState !== WebSocket.OPEN || !queue.length) {
      return;
    }

    sendTimer = setTimeout(() => {
      sendTimer = null;
      flushQueue();
    }, delayMs);
  }

  /**
   * 发送已排队的图片分片。
   * 核心分支：每轮只发送少量分片，并在 bufferedAmount 过高时暂停，避免公网代理和浏览器缓冲被瞬间打满。
   */
  function flushQueue(): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (queue.length && socket.bufferedAmount > mediaSendLowWatermarkBytes && shouldPauseForBackpressure()) {
      scheduleFlushQueue(mediaSendPumpDelayMs);
      return;
    }

    let sentCount = 0;

    while (queue.length && sentCount < mediaSendBatchSize && !shouldPauseForBackpressure()) {
      const item = queue.shift();

      if (!item) {
        return;
      }

      socket.send(encodeImageChunkFrame(item.imageId, item.chunk));
      item.resolve();
      sentCount += 1;
    }

    if (queue.length) {
      scheduleFlushQueue(mediaSendPumpDelayMs);
    }
  }

  /**
   * 启动媒体通道应用层心跳。
   * 核心分支：主动发送小 JSON 包，避免 Cloudflare Tunnel/OpenResty 回收空闲 WebSocket。
   */
  function startMediaHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    const sendPing = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    };

    sendPing();
    heartbeatTimer = setInterval(sendPing, mediaHeartbeatMs);
  }

  /**
   * 停止媒体通道心跳。
   * 核心分支：连接关闭或主动关闭时释放定时器。
   */
  function stopMediaHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /**
   * 将浏览器收到的二进制消息转为 ArrayBuffer。
   * @param value WebSocket message 事件正文；核心分支优先处理 arraybuffer，Blob 作为兼容兜底。
   * @returns 可交给图片分片解码器的二进制帧。
   */
  async function normalizeBinaryMessage(value: unknown): Promise<ArrayBuffer> {
    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (value instanceof Blob) {
      return value.arrayBuffer();
    }

    throw new Error('图片分片格式错误');
  }

  /**
   * 处理媒体 WebSocket 消息。
   * @param event 浏览器 WebSocket 消息事件；核心分支为 JSON 控制消息和二进制图片分片。
   */
  async function handleSocketMessage(event: MessageEvent): Promise<void> {
    try {
      if (typeof event.data !== 'string') {
        handlers.onChunk(decodeImageChunkFrame(await normalizeBinaryMessage(event.data)));
        return;
      }

      const data = JSON.parse(event.data) as {
        event: string;
        imageId?: string;
        message?: string;
      };

      if (data.event === 'pong') {
        return;
      }

      if (data.event === 'image:error') {
        handlers.onError({ imageId: data.imageId, message: data.message });
      }
    } catch (error) {
      handlers.onError({ message: (error as Error).message });
    }
  }

  socket.addEventListener('open', () => {
    flushQueue();
    startMediaHeartbeat();
    handlers.onOpen?.();
  });
  socket.addEventListener('close', () => {
    stopMediaHeartbeat();
    clearSendTimer();
    const pendingError = new Error('媒体通道已断开，图片分片等待重连后继续发送');

    while (queue.length) {
      queue.shift()?.reject(pendingError);
    }

    if (!closedByClient) {
      handlers.onClose?.();
    }
  });
  socket.addEventListener('message', (event) => {
    void handleSocketMessage(event);
  });

  return {
    socket,
    /**
     * 发送或排队一个图片分片。
     * @param imageId 图片传输 ID。
     * @param chunk 图片分片；核心分支为连接未打开时先排队，避免阻塞文字通道。
     */
    sendChunk(imageId: string, chunk: ImageChunk): Promise<void> {
      return new Promise((resolve, reject) => {
        queue.push({ imageId, chunk, resolve, reject });
        flushQueue();
      });
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
      closedByClient = true;
      clearSendTimer();
      stopMediaHeartbeat();
      socket.close();
    }
  };
}
