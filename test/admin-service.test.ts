import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminService, type AdminRecord, type AdminRepository } from '../src/services/adminService';

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
    const admin = {
      id: `admin-${this.admins.length + 1}`,
      username,
      passwordHash,
      createdAt: new Date()
    };
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

test('管理员服务识别数据库中是否已有管理员', async () => {
  const service = new AdminService(new MemoryAdminRepository());

  assert.equal(await service.hasAnyAdmin(), false);

  await service.createAdmin('admin', 'secret123');

  assert.equal(await service.hasAnyAdmin(), true);
});

test('创建管理员时保存密码摘要且不保存明文', async () => {
  const repository = new MemoryAdminRepository();
  const service = new AdminService(repository);

  const admin = await service.createAdmin('admin', 'secret123');

  assert.equal(admin.username, 'admin');
  assert.notEqual(admin.passwordHash, 'secret123');
  assert.equal(await service.verifyPassword(admin, 'secret123'), true);
});

test('创建重复用户名会返回明确错误', async () => {
  const service = new AdminService(new MemoryAdminRepository());

  await service.createAdmin('admin', 'secret123');

  await assert.rejects(() => service.createAdmin('admin', 'another123'), /管理员用户名已存在/);
});

test('更新管理员账号密码后旧密码失效', async () => {
  const service = new AdminService(new MemoryAdminRepository());
  const admin = await service.createAdmin('admin', 'secret123');

  const updated = await service.updateAdmin(admin.id, {
    username: 'owner',
    password: 'newpass123'
  });

  assert.equal(updated.username, 'owner');
  assert.equal(await service.verifyPassword(updated, 'secret123'), false);
  assert.equal(await service.verifyPassword(updated, 'newpass123'), true);
});
