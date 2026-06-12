import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSocket } from '../apps/web/src/utils/mediaSocket';

type FakeSocketListener = () => void;

/**
 * 测试用 WebSocket 替身。
 * 职责：模拟浏览器端 WebSocket 的 readyState、bufferedAmount 和事件注册；核心分支为发送后主动抬高 bufferedAmount，验证媒体发送队列会尊重回压。
 */
class BackpressureWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: BackpressureWebSocket[] = [];

  readonly sentMessages: string[] = [];
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
   * @param message JSON 字符串；核心分支记录消息并增加 bufferedAmount，模拟底层发送缓冲被占用。
   */
  send(message: string): void {
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

test('媒体 WebSocket 会在发送缓冲过高时暂停分片队列', () => {
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

    for (let index = 0; index < 20; index += 1) {
      mediaSocket.sendChunk('image-1', {
        chunkIndex: index,
        totalChunks: 20,
        data: 'YWJjZA=='
      });
    }

    assert.ok(socket.sentMessages.length < 20);
  } finally {
    mediaSocket?.close();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket
    });
  }
});
