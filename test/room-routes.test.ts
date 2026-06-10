import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { AdminService, type AdminRecord, type AdminRepository } from '../src/services/adminService';
import { AuthService } from '../src/services/authService';
import { RoomService, type RoomRecord, type RoomRepository } from '../src/services/roomService';

class MemoryAdminRepository implements AdminRepository {
  private admins: AdminRecord[] = [];

  async countAdmins(): Promise<number> {
    return this.admins.length;
  }

  async findByUsername(username: string): Promise<AdminRecord | null> {
    return this.admins.find((admin) => admin.username === username) ?? null;
  }

  async findById(id: string): Promise<AdminRecord | null> {
    return this.admins.find((admin) => admin.id === id) ?? null;
  }

  async createAdmin(username: string, passwordHash: string): Promise<AdminRecord> {
    const admin = { id: `admin-${this.admins.length + 1}`, username, passwordHash, createdAt: new Date() };
    this.admins.push(admin);
    return admin;
  }

  async updateAdmin(id: string, data: { username?: string; passwordHash?: string }): Promise<AdminRecord> {
    const admin = await this.findById(id);

    if (!admin) {
      throw new Error('管理员不存在');
    }

    Object.assign(admin, data);
    return admin;
  }
}

class MemoryRoomRepository implements RoomRepository {
  private rooms: RoomRecord[] = [];

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

async function createTestServer() {
  const adminService = new AdminService(new MemoryAdminRepository());
  const authService = new AuthService(adminService, { username: 'root', password: 'root123' });
  const roomService = new RoomService(new MemoryRoomRepository(), { protocol: 'https', host: 'example.com' });
  const app = createApp({ adminService, authService, roomService });
  const server = http.createServer(app);

  await adminService.createAdmin('owner', 'secret123');
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('测试服务启动失败');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'secret123' })
  });
  const body = await response.json();
  return body.token;
}

test('未登录不能创建房间', async () => {
  const server = await createTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/rooms`, { method: 'POST' });

    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test('管理员可以创建房间并查询基础信息', async () => {
  const server = await createTestServer();

  try {
    const token = await login(server.baseUrl);
    const createResponse = await fetch(`${server.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    const createBody = await createResponse.json();
    const getResponse = await fetch(`${server.baseUrl}/api/rooms/${createBody.room.id}`);
    const getBody = await getResponse.json();

    assert.equal(createResponse.status, 201);
    assert.match(createBody.shareUrl, /^https:\/\/example\.com\/chat\//);
    assert.equal(getResponse.status, 200);
    assert.equal(getBody.room.id, createBody.room.id);
    assert.equal(Object.hasOwn(getBody.room, 'messages'), false);
  } finally {
    await server.close();
  }
});

test('管理员可以列出自己的房间并关闭房间', async () => {
  const server = await createTestServer();

  try {
    const token = await login(server.baseUrl);
    const createResponse = await fetch(`${server.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    const createBody = await createResponse.json();
    const listResponse = await fetch(`${server.baseUrl}/api/rooms`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const listBody = await listResponse.json();
    const closeResponse = await fetch(`${server.baseUrl}/api/rooms/${createBody.room.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });
    const closeBody = await closeResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.rooms.length, 1);
    assert.equal(listBody.rooms[0].shareUrl, createBody.shareUrl);
    assert.equal(closeResponse.status, 200);
    assert.equal(closeBody.room.status, 'closed');
  } finally {
    await server.close();
  }
});

test('访客分享链接可以查询聊天室基础信息', async () => {
  const server = await createTestServer();

  try {
    const token = await login(server.baseUrl);
    const createResponse = await fetch(`${server.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    const createBody = await createResponse.json();
    const shareResponse = await fetch(`${server.baseUrl}/api/rooms/share/${createBody.room.shareSlug}`);
    const shareBody = await shareResponse.json();

    assert.equal(shareResponse.status, 200);
    assert.equal(shareBody.room.id, createBody.room.id);
    assert.equal(shareBody.room.shareSlug, createBody.room.shareSlug);
  } finally {
    await server.close();
  }
});
