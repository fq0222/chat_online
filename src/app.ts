import express from 'express';
import cors from 'cors';
import type { AdminService } from './services/adminService';
import type { AuthService } from './services/authService';
import type { RoomService } from './services/roomService';
import { createAuthRouter } from './routes/authRoutes';
import { createAdminRouter } from './routes/adminRoutes';
import { createRoomRouter } from './routes/roomRoutes';

export type AppDependencies = {
  adminService: AdminService;
  authService: AuthService;
  roomService?: RoomService;
};

/**
 * 创建 Express 应用。
 * @param dependencies 业务服务依赖，测试和生产启动可注入不同实现。
 * @returns 配置好 JSON、跨域和 REST 路由的 Express 应用。
 */
export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });
  app.use('/api/auth', createAuthRouter(dependencies.authService));
  app.use('/api/admin', createAdminRouter(dependencies.adminService, dependencies.authService));
  if (dependencies.roomService) {
    app.use('/api/rooms', createRoomRouter(dependencies.roomService, dependencies.authService));
  }

  return app;
}
