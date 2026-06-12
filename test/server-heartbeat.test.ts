import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachServerHeartbeat } from '../src/ws/serverHeartbeat';

/**
 * 测试用 WebSocket 替身。
 * 职责：记录服务端 ping 与 terminate 调用；核心分支为不主动回 pong，模拟代理链路吞掉协议层 pong 的场景。
 */
class FakeHeartbeatSocket extends EventEmitter {
  pingCount = 0;
  terminateCount = 0;

  /**
   * 记录服务端协议层 ping。
   * 核心分支：只累加次数，不触发 pong，用来验证应用层消息是否也能保活。
   */
  ping(): void {
    this.pingCount += 1;
  }

  /**
   * 记录服务端终止连接。
   * 核心分支：心跳认为连接失活时调用。
   */
  terminate(): void {
    this.terminateCount += 1;
  }
}

test('服务端心跳会把应用层消息视为连接存活', () => {
  const ticks: Array<() => void> = [];
  const socket = new FakeHeartbeatSocket();
  const heartbeat = attachServerHeartbeat(socket as never, 10, {
    setInterval: (callback) => {
      ticks.push(callback);
      return callback;
    },
    clearInterval: () => undefined
  });

  try {
    ticks[0]();
    assert.equal(socket.pingCount, 1);
    assert.equal(socket.terminateCount, 0);

    heartbeat.markAlive();
    ticks[0]();

    assert.equal(socket.pingCount, 2);
    assert.equal(socket.terminateCount, 0);

    ticks[0]();
    assert.equal(socket.terminateCount, 1);
  } finally {
    heartbeat.stop();
  }
});
