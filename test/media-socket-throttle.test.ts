import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSocket } from '../apps/web/src/utils/mediaSocket';
import { decodeImageChunkFrame } from '../apps/web/src/utils/imageChunkTransfer';

type FakeSocketListener = () => void;

/**
 * 测试用 WebSocket 替身。
 * 职责：模拟浏览器端 WebSocket 的 readyState、bufferedAmount 和事件注册；核心分支为发送后主动抬高 bufferedAmount，验证媒体发送队列会尊重回压。
 */
class BackpressureWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: BackpressureWebSocket[] = [];

  readonly sentMessages: (string | ArrayBuffer)[] = [];
  readonly listeners = new Map<string, FakeSocketListener[]>();
  readyState = BackpressureWebSocket.OPEN;
  bufferedAmount = 0;

  constructor(readonly url: string) {
    BackpressureWebSocket.instances.push(this);
  }

  /**
   * 注册事件监听器。
   * @param event 事件名称；核心分支只记录 open、close、message 这类测试会触发的事件。
   * @param listener 事件回调。
   */
  addEventListener(event: string, listener: FakeSocketListener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  /**
   * 发送一条 WebSocket 消息。
   * @param message WebSocket 消息；核心分支记录消息并增加 bufferedAmount，模拟底层发送缓冲被占用。
   */
  send(message: string | ArrayBuffer): void {
    this.sentMessages.push(message);
    this.bufferedAmount += 128 * 1024;
  }

  /**
   * 主动关闭连接。
   * 核心分支：切换 readyState 并触发 close 监听，验证队列清理逻辑不会继续发送。
   */
  close(): void {
    this.readyState = BackpressureWebSocket.CLOSED;
    this.emit('close');
  }

  /**
   * 触发已注册的事件。
   * @param event 事件名称；核心分支按注册顺序执行监听器。
   */
  emit(event: string): void {
    this.listeners.get(event)?.forEach((listener) => listener());
  }
}

test('媒体 WebSocket 会在发送缓冲过高时暂停分片队列', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let mediaSocket: ReturnType<typeof createMediaSocket> | null = null;
  let sendResults: PromiseSettledResult<void>[] = [];

  BackpressureWebSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: BackpressureWebSocket
  });

  try {
    mediaSocket = createMediaSocket('wss://example.com/ws/media', {
      onChunk: () => undefined,
      onError: () => undefined
    });
    const socket = BackpressureWebSocket.instances[0];

    const sendPromises = Array.from({ length: 20 }, (_, index) =>
      mediaSocket!.sendChunk('image-1', {
        chunkIndex: index,
        totalChunks: 20,
        data: new TextEncoder().encode('abcd').buffer
      })
    );

    assert.ok(socket.sentMessages.length < 20);
    assert.equal(socket.sentMessages.some((message) => message instanceof ArrayBuffer), true);
    mediaSocket.close();
    mediaSocket = null;
    sendResults = await Promise.allSettled(sendPromises);
    assert.equal(sendResults.some((result) => result.status === 'rejected'), true);
  } finally {
    mediaSocket?.close();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket
    });
  }
});

test('媒体 WebSocket 发送图片分片时使用二进制帧承载原始字节', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let mediaSocket: ReturnType<typeof createMediaSocket> | null = null;

  BackpressureWebSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: BackpressureWebSocket
  });

  try {
    mediaSocket = createMediaSocket('wss://example.com/ws/media', {
      onChunk: () => undefined,
      onError: () => undefined
    });
    const socket = BackpressureWebSocket.instances[0];

    await mediaSocket.sendChunk('image-1', {
      chunkIndex: 0,
      totalChunks: 1,
      data: new TextEncoder().encode('abcd').buffer
    });

    const sentFrame = socket.sentMessages.find((message) => message instanceof ArrayBuffer);

    assert.ok(sentFrame instanceof ArrayBuffer);
    assert.equal(socket.sentMessages.some((message) => typeof message === 'string' && message.includes('YWJjZA==')), false);
    assert.equal(new TextDecoder().decode(decodeImageChunkFrame(sentFrame).data), 'abcd');
  } finally {
    mediaSocket?.close();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket
    });
  }
});

test('媒体 WebSocket 关闭时会拒绝尚未真正发送的排队分片', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let mediaSocket: ReturnType<typeof createMediaSocket> | null = null;

  BackpressureWebSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: BackpressureWebSocket
  });

  try {
    mediaSocket = createMediaSocket('wss://example.com/ws/media', {
      onChunk: () => undefined,
      onError: () => undefined
    });
    const socket = BackpressureWebSocket.instances[0];
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        mediaSocket!.sendChunk('image-1', {
          chunkIndex: index,
          totalChunks: 20,
          data: new TextEncoder().encode('abcd').buffer
        })
      ).map((promise, index) => {
        if (index === 4) {
          mediaSocket?.close();
        }

        return promise;
      })
    );

    assert.ok(socket.sentMessages.length < 20);
    assert.equal(results.some((result) => result.status === 'rejected'), true);
  } finally {
    mediaSocket?.close();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket
    });
  }
});
