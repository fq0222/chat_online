import type { Pool } from 'pg';
import type { RoomRecord, RoomRepository } from '../services/roomService';

type RoomRow = {
  id: string;
  admin_id: string;
  share_slug: string;
  status: 'active' | 'closed';
  created_at: Date;
  updated_at: Date;
};

/**
 * PostgreSQL 房间仓储。
 * 职责：读写 rooms 表；关键参数为 pg 连接池；核心分支为创建房间和查无房间。
 */
export class PostgresRoomRepository implements RoomRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * 创建房间元数据。
   * @param data 房间 ID、管理员 ID、分享标识和状态。
   * @returns 创建后的房间记录。
   */
  async createRoom(data: { id: string; adminId: string; shareSlug: string; status: 'active' }): Promise<RoomRecord> {
    const result = await this.pool.query<RoomRow>(
      `INSERT INTO rooms (id, admin_id, share_slug, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.id, data.adminId, data.shareSlug, data.status]
    );
    return this.mapRow(result.rows[0]);
  }

  /**
   * 按房间 ID 查询房间。
   * @param id 房间 ID。
   * @returns 找到时返回房间记录，否则返回 null。
   */
  async findById(id: string): Promise<RoomRecord | null> {
    const result = await this.pool.query<RoomRow>('SELECT * FROM rooms WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: RoomRow): RoomRecord {
    return {
      id: row.id,
      adminId: row.admin_id,
      shareSlug: row.share_slug,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
