import { Router } from 'express';
import type { AuthService } from '../services/authService';
import { createAdminLoginRateLimiter, type LoginRateLimiter } from '../services/loginRateLimiter';
import { createLogger } from '../utils/logger';

const logger = createLogger('登录接口');

/**
 * 创建管理员登录路由。
 * @param authService 鉴权服务，用于校验账号密码并生成 token。
 * @param loginRateLimiter 登录频率限制器；核心分支为超过 15 分钟 3 次后直接返回 429。
 * @returns Express 路由实例。
 */
export function createAuthRouter(
  authService: AuthService,
  loginRateLimiter: LoginRateLimiter = createAdminLoginRateLimiter()
): Router {
  const router = Router();

  router.post('/login', async (request, response) => {
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
