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
