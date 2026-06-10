import { Router } from 'express';
import type { AdminService } from '../services/adminService';
import type { AuthService } from '../services/authService';
import { createLogger } from '../utils/logger';

const logger = createLogger('管理员接口');

/**
 * 从 Authorization 请求头中提取 Bearer token。
 * @param authorization 请求头原始值。
 * @returns 存在 Bearer token 时返回 token，否则返回 undefined。
 */
export function getBearerToken(authorization?: string): string | undefined {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }

  return authorization.slice('Bearer '.length);
}

/**
 * 创建管理员管理路由。
 * @param adminService 管理员服务，负责数据库管理员资料。
 * @param authService 鉴权服务，负责 token 校验和撤销。
 * @returns Express 路由实例。
 */
export function createAdminRouter(adminService: AdminService, authService: AuthService): Router {
  const router = Router();

  router.post('/setup', async (request, response) => {
    const session = authService.verifyToken(getBearerToken(request.headers.authorization));

    if (!session?.isBootstrap) {
      response.status(401).json({ message: '无效的首次登录 token' });
      return;
    }

    if (await adminService.hasAnyAdmin()) {
      response.status(409).json({ message: '管理员已初始化' });
      return;
    }

    const { username, password } = request.body as { username?: string; password?: string };

    if (!username || !password) {
      response.status(400).json({ message: '用户名和密码不能为空' });
      return;
    }

    try {
      const admin = await adminService.createAdmin(username, password);
      logger.info(`首次管理员创建成功：${admin.username}`);
      response.status(201).json({ admin: { id: admin.id, username: admin.username } });
    } catch (error) {
      response.status(400).json({ message: (error as Error).message });
    }
  });

  router.put('/profile', async (request, response) => {
    const session = authService.verifyToken(getBearerToken(request.headers.authorization));

    if (!session || session.isBootstrap) {
      response.status(401).json({ message: '管理员未登录' });
      return;
    }

    const { username, password } = request.body as { username?: string; password?: string };

    try {
      const admin = await adminService.updateAdmin(session.adminId, { username, password });
      authService.revokeAdminTokens(admin.id);
      logger.info(`管理员资料更新成功：${admin.username}`);
      response.json({ admin: { id: admin.id, username: admin.username } });
    } catch (error) {
      response.status(400).json({ message: (error as Error).message });
    }
  });

  return router;
}
