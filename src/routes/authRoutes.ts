import { Router } from 'express';
import type { AuthService } from '../services/authService';
import { createAdminLoginRateLimiter, type LoginRateLimiter } from '../services/loginRateLimiter';
import { createLogger } from '../utils/logger';

export type AdminEntryOptions = {
  adminEntryKey?: string;
};

const logger = createLogger('登录接口');

/**
 * 创建管理员登录路由。
 * @param authService 鉴权服务，用于校验账号密码并生成 token。
 * @param loginRateLimiter 登录频率限制器；核心分支为超过 15 分钟 3 次后直接返回 429。
 * @param options 管理员隐藏入口选项；配置 adminEntryKey 后，登录请求必须携带匹配的 32 位十六进制入口 key。
 * @returns Express 路由实例。
 */
export function createAuthRouter(
  authService: AuthService,
  loginRateLimiter: LoginRateLimiter = createAdminLoginRateLimiter(),
  options: AdminEntryOptions = {}
): Router {
  const router = Router();

  router.post('/login', async (request, response) => {
    if (!isAdminEntryAllowed(request.header('x-admin-entry-key'), options.adminEntryKey)) {
      logger.warn('管理员登录入口不匹配');
      response.status(404).json({ message: '登录入口不存在' });
      return;
    }

    const { username, password } = request.body as { username?: string; password?: string };

    if (!username || !password) {
      response.status(400).json({ message: '用户名和密码不能为空' });
      return;
    }

    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const rateLimitKey = loginRateLimiter.createKey(ip, username);
    const rateLimitResult = loginRateLimiter.consume(rateLimitKey);

    if (!rateLimitResult.allowed) {
      logger.warn(`管理员登录过于频繁：${username} ${ip}`);
      response.status(429).json({ message: '登录过于频繁，请 15 分钟后再试' });
      return;
    }

    try {
      const result = await authService.login(username, password);
      logger.info(`管理员登录成功：${result.admin.username}`);
      response.json(result);
    } catch (error) {
      logger.warn(`管理员登录失败：${username}`);
      response.status(401).json({ message: (error as Error).message });
    }
  });

  return router;
}

/**
 * 校验管理员隐藏入口 key。
 * @param requestKey 前端从隐藏路径提取并放入请求头的 32 位十六进制 key。
 * @param expectedKey 服务端配置的有效入口 key；未配置时保留测试和本地旧行为。
 * @returns 入口可用时返回 true；核心分支为未启用隐藏入口、格式不合法或 key 不匹配。
 */
function isAdminEntryAllowed(requestKey: string | undefined, expectedKey?: string): boolean {
  if (!expectedKey) {
    return true;
  }

  if (!requestKey || !/^[0-9a-f]{32}$/i.test(requestKey)) {
    return false;
  }

  return requestKey.toLowerCase() === expectedKey.toLowerCase();
}
