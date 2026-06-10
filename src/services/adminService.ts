import bcrypt from 'bcryptjs';

export type AdminRecord = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt?: Date;
};

export type AdminRepository = {
  countAdmins: () => Promise<number>;
  findByUsername: (username: string) => Promise<AdminRecord | null>;
  findById: (id: string) => Promise<AdminRecord | null>;
  createAdmin: (username: string, passwordHash: string) => Promise<AdminRecord>;
  updateAdmin: (id: string, data: { username?: string; passwordHash?: string }) => Promise<AdminRecord>;
};

/**
 * 管理员业务服务。
 * 职责：创建、查询和更新管理员；关键参数为仓储、用户名和密码；核心分支包括重复用户名、密码过短和管理员不存在。
 */
export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  /**
   * 判断数据库是否已经存在管理员。
   * @returns 存在管理员返回 true，否则返回 false。
   */
  async hasAnyAdmin(): Promise<boolean> {
    return (await this.repository.countAdmins()) > 0;
  }

  /**
   * 根据用户名查找管理员。
   * @param username 管理员用户名。
   * @returns 找到时返回管理员记录，否则返回 null。
   */
  async findByUsername(username: string): Promise<AdminRecord | null> {
    return this.repository.findByUsername(username);
  }

  /**
   * 根据 ID 查找管理员。
   * @param id 管理员主键。
   * @returns 找到时返回管理员记录，否则返回 null。
   */
  async findById(id: string): Promise<AdminRecord | null> {
    return this.repository.findById(id);
  }

  /**
   * 创建管理员账号。
   * @param username 新管理员用户名。
   * @param password 新管理员明文密码，仅用于生成摘要，不会保存。
   * @returns 创建后的管理员记录。
   */
  async createAdmin(username: string, password: string): Promise<AdminRecord> {
    this.assertValidUsername(username);
    this.assertValidPassword(password);

    const exists = await this.repository.findByUsername(username);

    if (exists) {
      throw new Error('管理员用户名已存在');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    return this.repository.createAdmin(username, passwordHash);
  }

  /**
   * 更新管理员账号资料。
   * @param id 管理员主键。
   * @param data 可选的新用户名和新密码。
   * @returns 更新后的管理员记录。
   */
  async updateAdmin(id: string, data: { username?: string; password?: string }): Promise<AdminRecord> {
    const admin = await this.repository.findById(id);

    if (!admin) {
      throw new Error('管理员不存在');
    }

    const updateData: { username?: string; passwordHash?: string } = {};

    if (data.username && data.username !== admin.username) {
      this.assertValidUsername(data.username);
      const exists = await this.repository.findByUsername(data.username);

      if (exists && exists.id !== id) {
        throw new Error('管理员用户名已存在');
      }

      updateData.username = data.username;
    }

    if (data.password) {
      this.assertValidPassword(data.password);
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    return this.repository.updateAdmin(id, updateData);
  }

  /**
   * 校验管理员密码。
   * @param admin 管理员记录。
   * @param password 待校验明文密码。
   * @returns 密码匹配返回 true，否则返回 false。
   */
  async verifyPassword(admin: AdminRecord, password: string): Promise<boolean> {
    return bcrypt.compare(password, admin.passwordHash);
  }

  private assertValidUsername(username: string): void {
    if (username.trim().length < 3) {
      throw new Error('管理员用户名至少需要 3 个字符');
    }
  }

  private assertValidPassword(password: string): void {
    if (password.length < 6) {
      throw new Error('管理员密码至少需要 6 个字符');
    }
  }
}
