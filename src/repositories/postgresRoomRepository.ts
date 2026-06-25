import type { Pool } from 'pg';
import type { RoomRecord, RoomRepository } from '../services/roomService';

type RoomRow = {
  id: string;
  admin_id: string;
  share_slug: string;
  remark_name: string;
  welcome_message: string;
  is_public: boolean;
  status: 'active' | 'closed';
  created_at: Date;
  updated_at: Date;
};

/**
 * PostgreSQL 房间仓储。
 * 职责：读写 rooms 表；关键参数为 pg 连接池；核心分支为创建房间、查询命中、无权限删除或未命中。
 */
export class PostgresRoomRepository implements RoomRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * 创建房间元数据。
   * @param data 房间 ID、管理员 ID、分享标识、备注名称和状态。
   * @returns 创建后的房间记录。
   */
  async createRoom(data: { id: string; adminId: string; shareSlug: string; remarkName: string; welcomeMessage: string; isPublic: boolean; status: 'active' }): Promise<RoomRecord> {
    const result = await this.pool.query<RoomRow>(
      `INSERT INTO rooms (id, admin_id, share_slug, remark_name, welcome_message, is_public, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [data.id, data.adminId, data.shareSlug, data.remarkName, data.welcomeMessage, data.isPublic, data.status]
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

  /**
   * 按管理员 ID 查询房间列表。
   * @param adminId 管理员 ID。
   * @returns 该管理员创建的房间；核心分支按创建时间倒序返回，未命中时返回空数组。
   */
  async findByAdminId(adminId: string): Promise<RoomRecord[]> {
    const result = await this.pool.query<RoomRow>(
      'SELECT * FROM rooms WHERE admin_id = $1 ORDER BY created_at DESC',
      [adminId]
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * 查询主页可展示的公开聊天室。
   * @returns 已启用且公开标记为 true 的房间；核心分支按创建时间倒序，避免关闭或内部房间出现在主页。
   */
  async findPublicRooms(): Promise<RoomRecord[]> {
    const result = await this.pool.query<RoomRow>(
      `SELECT * FROM rooms
       WHERE is_public = true AND status = 'active'
       ORDER BY created_at DESC`
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * 按访客分享标识查询房间。
   * @param shareSlug 分享链接中的唯一标识。
   * @returns 命中的房间记录；未命中时返回 null。
   */
  async findByShareSlug(shareSlug: string): Promise<RoomRecord | null> {
    const result = await this.pool.query<RoomRow>('SELECT * FROM rooms WHERE share_slug = $1 LIMIT 1', [shareSlug]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * 更新管理员自己的房间配置。
   * @param id 房间 ID。
   * @param adminId 管理员 ID；核心分支限制只更新自己创建的房间。
   * @param data 可更新配置；remarkName 和 welcomeMessage 都可独立保存为空字符串。
   * @returns 更新后的房间记录；房间不存在或不属于该管理员时返回 null。
   */
  async updateRoom(id: string, adminId: string, data: { remarkName?: string; welcomeMessage?: string; isPublic?: boolean }): Promise<RoomRecord | null> {
    const result = await this.pool.query<RoomRow>(
      `UPDATE rooms
       SET remark_name = COALESCE($3, remark_name),
           welcome_message = COALESCE($4, welcome_message),
           is_public = COALESCE($5, is_public),
           updated_at = NOW()
       WHERE id = $1 AND admin_id = $2
       RETURNING *`,
      [id, adminId, data.remarkName, data.welcomeMessage, data.isPublic]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * 更新管理员自己房间的状态。
   * @param id 房间 ID。
   * @param adminId 管理员 ID，用于限制只能修改自己的房间。
   * @param status 目标状态；核心分支为房间不存在或不属于管理员时返回 null。
   */
  async updateStatus(id: string, adminId: string, status: 'active' | 'closed'): Promise<RoomRecord | null> {
    const result = await this.pool.query<RoomRow>(
      `UPDATE rooms
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND admin_id = $2
       RETURNING *`,
      [id, adminId, status]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * 真实删除管理员自己的房间。
   * @param id 房间 ID。
   * @param adminId 管理员 ID，用于限制只能删除自己的房间。
   * @returns 被删除的房间记录；核心分支为房间不存在或不属于管理员时返回 null。
   */
  async deleteRoom(id: string, adminId: string): Promise<RoomRecord | null> {
    const result = await this.pool.query<RoomRow>(
      `DELETE FROM rooms
       WHERE id = $1 AND admin_id = $2
       RETURNING *`,
      [id, adminId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: RoomRow): RoomRecord {
    return {
      id: row.id,
      adminId: row.admin_id,
      shareSlug: row.share_slug,
      remarkName: row.remark_name,
      welcomeMessage: row.welcome_message,
      isPublic: row.is_public,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
