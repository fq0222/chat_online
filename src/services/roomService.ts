import crypto from 'node:crypto';

export type RoomRecord = {
  id: string;
  adminId: string;
  shareSlug: string;
  remarkName: string;
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
};

export type RoomInfo = {
  id: string;
  adminId: string;
  shareSlug: string;
  remarkName: string;
  status: 'active' | 'closed';
  createdAt: string;
  shareUrl?: string;
};

export type RoomRepository = {
  createRoom: (data: { id: string; adminId: string; shareSlug: string; remarkName: string; status: 'active' }) => Promise<RoomRecord>;
  findById: (id: string) => Promise<RoomRecord | null>;
  findByAdminId: (adminId: string) => Promise<RoomRecord[]>;
  findByShareSlug: (shareSlug: string) => Promise<RoomRecord | null>;
  updateStatus: (id: string, adminId: string, status: 'active' | 'closed') => Promise<RoomRecord | null>;
  deleteRoom: (id: string, adminId: string) => Promise<RoomRecord | null>;
};

export type SiteConfig = {
  protocol: string;
  host: string;
};

/**
 * 房间业务服务。
 * 职责：创建、查询和删除聊天室元数据；关键参数为管理员 ID、站点配置和房间备注；核心分支为房间存在、无权限或不存在。
 */
export class RoomService {
  constructor(
    private readonly repository: RoomRepository,
    private readonly site: SiteConfig
  ) {}

  /**
   * 创建聊天室。
   * @param adminId 创建房间的管理员 ID。
   * @param remarkName 管理员填写的房间备注名称；空值会保存为空字符串。
   * @returns 房间记录和可分享给访客的链接。
   */
  async createRoom(adminId: string, remarkName = ''): Promise<{ room: RoomRecord; shareUrl: string }> {
    const id = crypto.randomUUID();
    const shareSlug = crypto.randomUUID();
    const room = await this.repository.createRoom({
      id,
      adminId,
      shareSlug,
      remarkName: this.normalizeRemarkName(remarkName),
      status: 'active'
    });

    return {
      room,
      shareUrl: this.buildShareUrl(room.shareSlug)
    };
  }

  /**
   * 查询房间基础信息。
   * @param roomId 房间 ID。
   * @returns 房间存在时返回基础信息；不存在时返回 null。
   */
  async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    const room = await this.repository.findById(roomId);

    return room ? this.toRoomInfo(room) : null;
  }

  /**
   * 列出管理员创建的聊天室。
   * @param adminId 管理员 ID。
   * @returns 按仓储顺序返回房间基础信息和访客分享链接；空列表时返回空数组。
   */
  async listAdminRooms(adminId: string): Promise<RoomInfo[]> {
    const rooms = await this.repository.findByAdminId(adminId);

    return rooms.map((room) => this.toRoomInfo(room, true));
  }

  /**
   * 关闭管理员自己的聊天室。
   * @param roomId 房间 ID。
   * @param adminId 管理员 ID。
   * @returns 关闭后的房间信息；房间不存在或不属于该管理员时返回 null。
   */
  async closeRoom(roomId: string, adminId: string): Promise<RoomInfo | null> {
    const room = await this.repository.updateStatus(roomId, adminId, 'closed');

    return room ? this.toRoomInfo(room, true) : null;
  }

  /**
   * 真实删除管理员自己的聊天室。
   * @param roomId 房间 ID。
   * @param adminId 管理员 ID。
   * @returns 被删除的房间信息；房间不存在或不属于该管理员时返回 null。
   */
  async deleteRoom(roomId: string, adminId: string): Promise<RoomInfo | null> {
    const room = await this.repository.deleteRoom(roomId, adminId);

    return room ? this.toRoomInfo(room, true) : null;
  }

  /**
   * 按访客分享标识查询聊天室。
   * @param shareSlug 访客链接中的分享标识。
   * @returns 启用中的房间信息；房间不存在或已关闭时返回 null。
   */
  async getRoomByShareSlug(shareSlug: string): Promise<RoomInfo | null> {
    const room = await this.repository.findByShareSlug(shareSlug);

    if (!room || room.status !== 'active') {
      return null;
    }

    return this.toRoomInfo(room, true);
  }

  private toRoomInfo(room: RoomRecord, includeShareUrl = false): RoomInfo {
    return {
      id: room.id,
      adminId: room.adminId,
      shareSlug: room.shareSlug,
      remarkName: room.remarkName,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      ...(includeShareUrl ? { shareUrl: this.buildShareUrl(room.shareSlug) } : {})
    };
  }

  /**
   * 规范化房间备注名称。
   * @param remarkName 管理员输入的备注名称。
   * @returns 去除首尾空白且最长 120 字符的备注；核心分支为空白输入时返回空字符串。
   */
  private normalizeRemarkName(remarkName: string): string {
    return remarkName.trim().slice(0, 120);
  }

  private buildShareUrl(shareSlug: string): string {
    return `${this.site.protocol}://${this.site.host}/chat/${shareSlug}`;
  }
}
