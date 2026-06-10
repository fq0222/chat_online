import type { Pool } from 'pg';
import type { AdminRecord, AdminRepository } from '../services/adminService';

type AdminRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
};

/**
 * PostgreSQL 管理员仓储。
 * 职责：读写 admins 表；关键参数为 pg 连接池；核心分支为查无记录和唯一约束冲突。
 */
export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * 统计管理员数量。
   * @returns admins 表中的管理员总数。
   */
  async countAdmins(): Promise<number> {
    const result = await this.pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM admins');
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * 按用户名查询管理员。
   * @param username 管理员用户名。
   * @returns 找到时返回管理员记录，否则返回 null。
   */
  async findByUsername(username: string): Promise<AdminRecord | null> {
    const result = await this.pool.query<AdminRow>('SELECT * FROM admins WHERE username = $1 LIMIT 1', [username]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * 按 ID 查询管理员。
   * @param id 管理员 ID。
   * @returns 找到时返回管理员记录，否则返回 null。
   */
  async findById(id: string): Promise<AdminRecord | null> {
    const result = await this.pool.query<AdminRow>('SELECT * FROM admins WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * 创建管理员。
   * @param username 管理员用户名。
   * @param passwordHash 密码摘要。
   * @returns 新创建的管理员记录。
   */
  async createAdmin(username: string, passwordHash: string): Promise<AdminRecord> {
    const result = await this.pool.query<AdminRow>(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING *',
      [username, passwordHash]
    );
    return this.mapRow(result.rows[0]);
  }

  /**
   * 更新管理员资料。
   * @param id 管理员 ID。
   * @param data 可选用户名和密码摘要。
   * @returns 更新后的管理员记录。
   */
  async updateAdmin(id: string, data: { username?: string; passwordHash?: string }): Promise<AdminRecord> {
    const current = await this.findById(id);

    if (!current) {
      throw new Error('管理员不存在');
    }

    const result = await this.pool.query<AdminRow>(
      `UPDATE admins
       SET username = $2,
           password_hash = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, data.username ?? current.username, data.passwordHash ?? current.passwordHash]
    );

    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: AdminRow): AdminRecord {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
