import { Router } from 'express';
import type { AuthService } from '../services/authService';
import type { RoomService } from '../services/roomService';
import { getBearerToken } from './adminRoutes';
import { createLogger } from '../utils/logger';

const logger = createLogger('房间接口');

/**
 * 创建房间路由。
 * @param roomService 房间服务，负责房间元数据读写。
 * @param authService 鉴权服务，负责管理员 token 校验。
 * @returns Express 路由实例。
 */
export function createRoomRouter(roomService: RoomService, authService: AuthService): Router {
  const router = Router();

  router.post('/', async (request, response) => {
    const session = authService.verifyToken(getBearerToken(request.headers.authorization));

    if (!session || session.isBootstrap) {
      response.status(401).json({ message: '管理员未登录' });
      return;
    }

    const result = await roomService.createRoom(session.adminId);
    logger.info(`聊天室创建成功：${result.room.id}`);

    response.status(201).json({
      room: {
        id: result.room.id,
        adminId: result.room.adminId,
        shareSlug: result.room.shareSlug,
        status: result.room.status,
        createdAt: result.room.createdAt.toISOString()
      },
      shareUrl: result.shareUrl
    });
  });

  router.get('/:roomId', async (request, response) => {
    const room = await roomService.getRoomInfo(request.params.roomId);

    if (!room) {
      response.status(404).json({ message: '聊天室不存在' });
      return;
    }

    response.json({ room });
  });

  return router;
}
