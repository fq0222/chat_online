import test from 'node:test';
import assert from 'node:assert/strict';
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

const bootstrapAdmin = {
  username: 'root',
  password: 'root123'
};

test('数据库无管理员时允许使用配置中的首次管理员登录', async () => {
  const adminService = new AdminService(new MemoryAdminRepository());
  const authService = new AuthService(adminService, bootstrapAdmin);

  const result = await authService.login('root', 'root123');

  assert.equal(result.ok, true);
  assert.equal(result.requiresSetup, true);
  assert.equal(result.admin.username, 'root');
  assert.equal(authService.verifyToken(result.token)?.isBootstrap, true);
});

test('数据库已有管理员时优先使用数据库账号登录', async () => {
  const adminService = new AdminService(new MemoryAdminRepository());
  const admin = await adminService.createAdmin('owner', 'secret123');
  const authService = new AuthService(adminService, bootstrapAdmin);

  const result = await authService.login('owner', 'secret123');

  assert.equal(result.ok, true);
  assert.equal(result.requiresSetup, false);
  assert.equal(result.admin.id, admin.id);
  assert.equal(authService.verifyToken(result.token)?.adminId, admin.id);
});

test('错误密码不能登录', async () => {
  const adminService = new AdminService(new MemoryAdminRepository());
  await adminService.createAdmin('owner', 'secret123');
  const authService = new AuthService(adminService, bootstrapAdmin);

  await assert.rejects(() => authService.login('owner', 'bad-pass'), /管理员账号或密码错误/);
});

test('撤销管理员 token 后校验失败', async () => {
  const adminService = new AdminService(new MemoryAdminRepository());
  const admin = await adminService.createAdmin('owner', 'secret123');
  const authService = new AuthService(adminService, bootstrapAdmin);
  const result = await authService.login('owner', 'secret123');

  authService.revokeAdminTokens(admin.id);

  assert.equal(authService.verifyToken(result.token), null);
});
