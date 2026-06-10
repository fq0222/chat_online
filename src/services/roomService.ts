import crypto from 'node:crypto';

export type RoomRecord = {
  id: string;
  adminId: string;
  shareSlug: string;
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
};

export type RoomInfo = {
  id: string;
  adminId: string;
  shareSlug: string;
  status: 'active' | 'closed';
  createdAt: string;
};

export type RoomRepository = {
  createRoom: (data: { id: string; adminId: string; shareSlug: string; status: 'active' }) => Promise<RoomRecord>;
  findById: (id: string) => Promise<RoomRecord | null>;
};

export type SiteConfig = {
  protocol: string;
  host: string;
};

/**
 * 房间业务服务。
 * 职责：创建和查询聊天室元数据；关键参数为管理员 ID 和站点配置；核心分支为房间存在或不存在。
 */
export class RoomService {
  constructor(
    private readonly repository: RoomRepository,
    private readonly site: SiteConfig
  ) {}

  /**
   * 创建聊天室。
   * @param adminId 创建房间的管理员 ID。
   * @returns 房间记录和可分享给访客的链接。
   */
  async createRoom(adminId: string): Promise<{ room: RoomRecord; shareUrl: string }> {
    const id = crypto.randomUUID();
    const shareSlug = crypto.randomUUID();
    const room = await this.repository.createRoom({
      id,
      adminId,
      shareSlug,
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

    if (!room) {
      return null;
    }

    return {
      id: room.id,
      adminId: room.adminId,
      shareSlug: room.shareSlug,
      status: room.status,
      createdAt: room.createdAt.toISOString()
    };
  }

  private buildShareUrl(shareSlug: string): string {
    return `${this.site.protocol}://${this.site.host}/chat/${shareSlug}`;
  }
}
