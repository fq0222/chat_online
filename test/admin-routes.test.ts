import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { AdminService, type AdminRecord, type AdminRepository } from '../src/services/adminService';
import { AuthService } from '../src/services/authService';

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

async function createTestServer() {
  const adminService = new AdminService(new MemoryAdminRepository());
  const authService = new AuthService(adminService, { username: 'root', password: 'root123' });
  const app = createApp({ adminService, authService });
  const server = http.createServer(app);

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

test('首次登录 token 可以创建数据库管理员', async () => {
  const server = await createTestServer();

  try {
    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root123' })
    });
    const loginBody = await loginResponse.json();
    const setupResponse = await fetch(`${server.baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`
      },
      body: JSON.stringify({ username: 'owner', password: 'secret123' })
    });
    const setupBody = await setupResponse.json();

    assert.equal(setupResponse.status, 201);
    assert.equal(setupBody.admin.username, 'owner');
  } finally {
    await server.close();
  }
});

test('已有管理员时不能再次执行首次初始化', async () => {
  const server = await createTestServer();

  try {
    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root123' })
    });
    const loginBody = await loginResponse.json();

    await fetch(`${server.baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`
      },
      body: JSON.stringify({ username: 'owner', password: 'secret123' })
    });

    const secondResponse = await fetch(`${server.baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`
      },
      body: JSON.stringify({ username: 'other', password: 'secret123' })
    });

    assert.equal(secondResponse.status, 409);
  } finally {
    await server.close();
  }
});

test('管理员更新资料后旧 token 失效', async () => {
  const server = await createTestServer();

  try {
    const bootstrapLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root123' })
    });
    const bootstrapBody = await bootstrapLogin.json();

    await fetch(`${server.baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bootstrapBody.token}`
      },
      body: JSON.stringify({ username: 'owner', password: 'secret123' })
    });

    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'secret123' })
    });
    const loginBody = await loginResponse.json();
    const updateResponse = await fetch(`${server.baseUrl}/api/admin/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`
      },
      body: JSON.stringify({ username: 'owner2', password: 'newpass123' })
    });
    const secondUpdateResponse = await fetch(`${server.baseUrl}/api/admin/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`
      },
      body: JSON.stringify({ username: 'owner3' })
    });

    assert.equal(updateResponse.status, 200);
    assert.equal(secondUpdateResponse.status, 401);
  } finally {
    await server.close();
  }
});
