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

async function withServer(handler: (baseUrl: string) => Promise<void>): Promise<void> {
  const adminService = new AdminService(new MemoryAdminRepository());
  const authService = new AuthService(adminService, { username: 'root', password: 'root123' });
  const app = createApp({ adminService, authService });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('测试服务启动失败');
    }

    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('登录接口返回管理员 token 和初始化标记', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root123' })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.requiresSetup, true);
    assert.equal(body.admin.username, 'root');
    assert.equal(typeof body.token, 'string');
  });
});

test('登录接口在密码错误时返回 401', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'bad-pass' })
    });

    assert.equal(response.status, 401);
  });
});
