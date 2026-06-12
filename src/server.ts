import http from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { PostgresAdminRepository } from './repositories/postgresAdminRepository';
import { PostgresRoomRepository } from './repositories/postgresRoomRepository';
import { AdminService } from './services/adminService';
import { AuthService } from './services/authService';
import { ChatMediaRelayService } from './services/chatMediaRelayService';
import { ChatRelayService } from './services/chatRelayService';
import { RoomService } from './services/roomService';
import { createLogger } from './utils/logger';
import { attachChatServer } from './ws/chatServer';
import { attachMediaServer } from './ws/mediaServer';

const logger = createLogger('服务启动');

/**
 * 启动 HTTP 和 WebSocket 服务。
 * 职责：装配配置、数据库仓储和业务服务；核心分支为启动成功或端口监听失败。
 */
export function startServer(): http.Server {
  const config = loadConfig();
  const pool = createPool();
  const adminService = new AdminService(new PostgresAdminRepository(pool));
  const authService = new AuthService(adminService, config.bootstrapAdmin, config.auth);
  const roomService = new RoomService(new PostgresRoomRepository(pool), config.site);
  const chatMediaRelayService = new ChatMediaRelayService();
  const chatRelayService = new ChatRelayService({
    onImageStart: (session) => chatMediaRelayService.startTransfer(session)
  });
  const app = createApp({ adminService, authService, roomService });
  const server = http.createServer(app);

  attachChatServer(server, { roomService, authService, chatRelayService });
  attachMediaServer(server, { roomService, authService, chatRelayService, chatMediaRelayService });
  server.listen(config.server.port, () => {
    logger.info(`服务已启动：http://localhost:${config.server.port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}
