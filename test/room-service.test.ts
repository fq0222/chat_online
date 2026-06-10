import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService, type RoomRecord, type RoomRepository } from '../src/services/roomService';

class MemoryRoomRepository implements RoomRepository {
  readonly rooms: RoomRecord[] = [];

  async createRoom(data: { id: string; adminId: string; shareSlug: string; status: 'active' }): Promise<RoomRecord> {
    const room = { ...data, createdAt: new Date(), updatedAt: new Date() };
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

  async updateStatus(id: string, adminId: string, status: 'active' | 'closed'): Promise<RoomRecord | null> {
    const room = this.rooms.find((item) => item.id === id && item.adminId === adminId);

    if (!room) {
      return null;
    }

    room.status = status;
    room.updatedAt = new Date();
    return room;
  }
}

test('管理员创建房间时写入仓储并生成分享链接', async () => {
  const repository = new MemoryRoomRepository();
  const service = new RoomService(repository, { protocol: 'https', host: 'example.com' });

  const result = await service.createRoom('admin-1');

  assert.equal(repository.rooms.length, 1);
  assert.equal(result.room.adminId, 'admin-1');
  assert.match(result.shareUrl, /^https:\/\/example\.com\/chat\//);
});

test('查询房间基础信息不包含聊天记录字段', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1');

  const roomInfo = await service.getRoomInfo(created.room.id);

  assert.equal(roomInfo?.id, created.room.id);
  assert.equal(Object.hasOwn(roomInfo ?? {}, 'messages'), false);
  assert.equal(Object.hasOwn(roomInfo ?? {}, 'chatRecords'), false);
});

test('管理员可以列出房间并关闭自己的房间', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1');

  const rooms = await service.listAdminRooms('admin-1');
  const closed = await service.closeRoom(created.room.id, 'admin-1');

  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].shareUrl, created.shareUrl);
  assert.equal(closed?.status, 'closed');
});

test('访客可以通过分享标识查询启用中的聊天室', async () => {
  const service = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const created = await service.createRoom('admin-1');

  const roomInfo = await service.getRoomByShareSlug(created.room.shareSlug);

  assert.equal(roomInfo?.id, created.room.id);
  assert.equal(roomInfo?.shareSlug, created.room.shareSlug);
});
