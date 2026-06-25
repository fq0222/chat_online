import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService, type RoomRecord, type RoomRepository } from '../src/services/roomService';

class MemoryRoomRepository implements RoomRepository {
  readonly rooms: RoomRecord[] = [];

  async createRoom(data: { id: string; adminId: string; shareSlug: string; status: 'active'; remarkName?: string; welcomeMessage?: string; isPublic?: boolean }): Promise<RoomRecord> {
    const room = { ...data, remarkName: data.remarkName ?? '', welcomeMessage: data.welcomeMessage ?? '', isPublic: data.isPublic ?? false, createdAt: new Date(), updatedAt: new Date() };
    this.rooms.push(room);
    return room;
  }

  async findById(id: string): Promise<RoomRecord | null> {
    return this.rooms.find((room) => room.id === id) ?? null;
  }

  async findByAdminId(adminId: string): Promise<RoomRecord[]> {
    return this.rooms.filter((room) => room.adminId === adminId);
  }

  async findByShareSlug(shareSlug: string): Promise<RoomRecord | null> {
    return this.rooms.find((room) => room.shareSlug === shareSlug) ?? null;
  }

  async findPublicRooms(): Promise<RoomRecord[]> {
    return this.rooms.filter((room) => (room as RoomRecord & { isPublic: boolean }).isPublic && room.status === 'active');
  }

  async updateStatus(id: string, adminId: string, status: 'active' | 'closed'): Promise<RoomRecord | null> {
    const room = this.rooms.find((item) => item.id === id && item.adminId === adminId);

    if (!room) {
      return null;
    }

    room.status = status;
    room.updatedAt = new Date();
    return room;
  }

  async updateRoom(id: string, adminId: string, data: { remarkName?: string; welcomeMessage?: string; isPublic?: boolean }): Promise<RoomRecord | null> {
    const room = this.rooms.find((item) => item.id === id && item.adminId === adminId);

    if (!room) {
      return null;
    }

    if (data.remarkName !== undefined) {
      room.remarkName = data.remarkName;
    }

    if (data.welcomeMessage !== undefined) {
      room.welcomeMessage = data.welcomeMessage;
    }

    if (data.isPublic !== undefined) {
      (room as RoomRecord & { isPublic: boolean }).isPublic = data.isPublic;
    }

    room.updatedAt = new Date();
    return room;
  }

  async deleteRoom(id: string, adminId: string): Promise<RoomRecord | null> {
    const roomIndex = this.rooms.findIndex((item) => item.id === id && item.adminId === adminId);

    if (roomIndex === -1) {
      return null;
    }

    const [room] = this.rooms.splice(roomIndex, 1);
    return room;
  }
}

test('管理员创建房间时写入备注名称并生成分享链接', async () => {
  const repository = new MemoryRoomRepository();
  const service = new RoomService(repository, { protocol: 'https', host: 'example.com' });

  const result = await service.createRoom('admin-1', '售前咨询');

  assert.equal(repository.rooms.length, 1);
  assert.equal(result.room.adminId, 'admin-1');
  assert.equal(result.room.remarkName, '售前咨询');
  assert.match(result.shareUrl, /^https:\/\/example\.com\/chat\//);
});

test('管理员可以在编辑弹窗中同时保存房间备注和首次进入欢迎语', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1', '售前咨询', '  欢迎咨询  ');

  assert.equal(created.room.welcomeMessage, '欢迎咨询');

  const updated = await service.updateRoomSettings(created.room.id, 'admin-1', {
    remarkName: '  售后支持  ',
    welcomeMessage: '  请留下您的问题，我们会尽快回复。  '
  });
  const denied = await service.updateRoomSettings(created.room.id, 'admin-2', {
    remarkName: '不应修改',
    welcomeMessage: '不应修改'
  });

  assert.equal(updated?.remarkName, '售后支持');
  assert.equal(updated?.welcomeMessage, '请留下您的问题，我们会尽快回复。');
  assert.equal(denied, null);
});

test('查询房间基础信息不包含聊天记录字段', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1');

  const roomInfo = await service.getRoomInfo(created.room.id);

  assert.equal(roomInfo?.id, created.room.id);
  assert.equal(Object.hasOwn(roomInfo ?? {}, 'messages'), false);
  assert.equal(Object.hasOwn(roomInfo ?? {}, 'chatRecords'), false);
});

test('管理员可以列出房间并真实删除自己的房间', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1', '订单售后');

  const rooms = await service.listAdminRooms('admin-1');
  const deleted = await service.deleteRoom(created.room.id, 'admin-1');
  const roomsAfterDelete = await service.listAdminRooms('admin-1');

  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].remarkName, '订单售后');
  assert.equal(rooms[0].shareUrl, created.shareUrl);
  assert.equal(deleted?.id, created.room.id);
  assert.equal(roomsAfterDelete.length, 0);
});

test('访客可以通过分享标识查询启用中的聊天室', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1');

  const roomInfo = await service.getRoomByShareSlug(created.room.shareSlug);

  assert.equal(roomInfo?.id, created.room.id);
  assert.equal(roomInfo?.shareSlug, created.room.shareSlug);
});

test('主页只列出管理员标记为公开且启用中的聊天室', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const publicRoom = await (service.createRoom as unknown as (
    adminId: string,
    remarkName?: string,
    welcomeMessage?: string,
    isPublic?: boolean
  ) => Promise<{ room: RoomRecord & { isPublic: boolean }; shareUrl: string }>).call(service, 'admin-1', '公开咨询', '', true);
  await (service.createRoom as unknown as (
    adminId: string,
    remarkName?: string,
    welcomeMessage?: string,
    isPublic?: boolean
  ) => Promise<{ room: RoomRecord & { isPublic: boolean }; shareUrl: string }>).call(service, 'admin-1', '内部客服', '', false);
  const updated = await service.updateRoomSettings(publicRoom.room.id, 'admin-1', { isPublic: true } as { isPublic: boolean });
  const publicRooms = await (service as unknown as { listPublicRooms: () => Promise<Array<RoomRecord & { isPublic: boolean; shareUrl?: string }>> }).listPublicRooms();

  assert.equal((updated as unknown as { isPublic?: boolean } | null)?.isPublic, true);
  assert.equal(publicRooms.length, 1);
  assert.equal(publicRooms[0].id, publicRoom.room.id);
  assert.equal(publicRooms[0].shareUrl, publicRoom.shareUrl);
});
