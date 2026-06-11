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

  router.get('/', async (request, response) => {
    const session = await authService.verifyToken(getBearerToken(request.headers.authorization));

    if (!session || session.isBootstrap) {
      response.status(401).json({ message: '管理员未登录' });
      return;
    }

    const rooms = await roomService.listAdminRooms(session.adminId);
    response.json({ rooms });
  });

  router.get('/share/:shareSlug', async (request, response) => {
    const room = await roomService.getRoomByShareSlug(request.params.shareSlug);

    if (!room) {
      response.status(404).json({ message: '聊天室不存在或已关闭' });
      return;
    }

    response.json({ room });
  });

  router.post('/', async (request, response) => {
    const session = await authService.verifyToken(getBearerToken(request.headers.authorization));

    if (!session || session.isBootstrap) {
      response.status(401).json({ message: '管理员未登录' });
      return;
    }

    const remarkName = typeof request.body?.remarkName === 'string' ? request.body.remarkName : '';
    const result = await roomService.createRoom(session.adminId, remarkName);
    logger.info(`聊天室创建成功：${result.room.id}`);

    response.status(201).json({
      room: {
        id: result.room.id,
        adminId: result.room.adminId,
        shareSlug: result.room.shareSlug,
        remarkName: result.room.remarkName,
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

  router.delete('/:roomId', async (request, response) => {
    const session = await authService.verifyToken(getBearerToken(request.headers.authorization));

    if (!session || session.isBootstrap) {
      response.status(401).json({ message: '管理员未登录' });
      return;
    }

    const room = await roomService.deleteRoom(request.params.roomId, session.adminId);

    if (!room) {
      response.status(404).json({ message: '聊天室不存在' });
      return;
    }

    logger.info(`聊天室已删除：${room.id}`);
    response.json({ room });
  });

  return router;
}
