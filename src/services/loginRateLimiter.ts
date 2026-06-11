export type LoginRateLimitOptions = {
  windowMs: number;
  maxAttempts: number;
  now?: () => Date;
};

export type LoginRateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

type LoginAttemptBucket = {
  count: number;
  resetAtMs: number;
};

/**
 * 登录频率限制器。
 * 职责：按调用方传入的限频 key 统计固定窗口内的登录尝试；关键参数为窗口时长、最大次数和可注入时间；核心分支为窗口过期重建、次数耗尽拒绝和正常放行。
 */
export class LoginRateLimiter {
  private readonly buckets = new Map<string, LoginAttemptBucket>();
  private readonly options: LoginRateLimitOptions;

  constructor(options?: Partial<LoginRateLimitOptions>) {
    this.options = {
      windowMs: 15 * 60 * 1000,
      maxAttempts: 3,
      ...options
    };
  }

  /**
   * 记录一次登录尝试并返回是否允许继续认证。
   * @param key 限频维度，通常由客户端 IP 和登录用户名组合而成。
   * @returns allowed 为 false 时表示本次已经超过频率限制，retryAfterMs 为剩余等待时间。
   */
  consume(key: string): LoginRateLimitResult {
    const nowMs = this.getNowMs();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAtMs <= nowMs) {
      this.buckets.set(key, {
        count: 1,
        resetAtMs: nowMs + this.options.windowMs
      });
      return { allowed: true, retryAfterMs: this.options.windowMs };
    }

    if (bucket.count >= this.options.maxAttempts) {
      return { allowed: false, retryAfterMs: bucket.resetAtMs - nowMs };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterMs: bucket.resetAtMs - nowMs };
  }

  /**
   * 生成管理员登录接口默认使用的限频 key。
   * @param ip 客户端 IP，缺失时由调用方传入 unknown。
   * @param username 登录用户名，大小写和首尾空格不应绕过限频。
   * @returns 规范化后的组合 key。
   */
  createKey(ip: string, username: string): string {
    return `${ip}:${username.trim().toLowerCase()}`;
  }

  private getNowMs(): number {
    return (this.options.now?.() ?? new Date()).getTime();
  }
}

/**
 * 创建管理员登录默认限频器。
 * @returns 15 分钟最多 3 次尝试的 LoginRateLimiter 实例。
 */
export function createAdminLoginRateLimiter(): LoginRateLimiter {
  return new LoginRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxAttempts: 3
  });
}
