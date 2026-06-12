import type { WebSocket } from 'ws';

export type ServerHeartbeatController = {
  markAlive: () => void;
  stop: () => void;
};

export type ServerHeartbeatScheduler = {
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (timer: unknown) => void;
};

const defaultHeartbeatMs = 25 * 1000;
const defaultScheduler: ServerHeartbeatScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>)
};

/**
 * 挂载服务端 WebSocket 心跳。
 * @param socket WebSocket 连接；核心分支为协议层 pong 或应用层消息都可刷新存活状态，避免代理链路吞掉 pong 后误杀连接。
 * @param intervalMs 心跳间隔毫秒数；测试可传入较小值，生产默认 25 秒。
 * @param scheduler 定时器调度器；核心分支为生产使用真实定时器，测试使用手动 tick，避免污染全局时钟。
 * @returns 心跳控制器，用于消息处理时标记存活以及连接关闭时清理定时器。
 */
export function attachServerHeartbeat(
  socket: WebSocket,
  intervalMs = defaultHeartbeatMs,
  scheduler = defaultScheduler
): ServerHeartbeatController {
  let isAlive = true;

  const markAlive = () => {
    isAlive = true;
  };

  const heartbeatTimer = scheduler.setInterval(() => {
    if (!isAlive) {
      socket.terminate();
      return;
    }

    isAlive = false;
    socket.ping();
  }, intervalMs);

  socket.on('pong', markAlive);

  return {
    markAlive,
    stop: () => {
      scheduler.clearInterval(heartbeatTimer);
      socket.off('pong', markAlive);
    }
  };
}
