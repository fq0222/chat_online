export type ReconnectPolicyOptions = {
  maxAttempts: number;
  delayMs: number;
};

export type ReconnectDecision = {
  shouldReconnect: boolean;
  attempt: number;
  delayMs: number;
};

/**
 * 创建 WebSocket 断线重连策略。
 * @param options 重连配置；核心分支为 maxAttempts 控制最多重连次数，delayMs 控制每次重连间隔。
 * @returns 可递增和重置重连次数的策略对象。
 */
export function createReconnectPolicy(options: ReconnectPolicyOptions) {
  let attempts = 0;

  return {
    next(): ReconnectDecision {
      if (attempts >= options.maxAttempts) {
        return {
          shouldReconnect: false,
          attempt: attempts,
          delayMs: options.delayMs
        };
      }

      attempts += 1;

      return {
        shouldReconnect: true,
        attempt: attempts,
        delayMs: options.delayMs
      };
    },
    reset(): void {
      attempts = 0;
    }
  };
}
