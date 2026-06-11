/**
 * 前端聊天室共享类型。
 * 职责：集中描述登录、房间、消息和图片草稿结构；关键参数来自后端接口与 WebSocket 事件；核心分支语义由页面组件和组合式逻辑按角色区分。
 */
export type PageName = 'login' | 'rooms' | 'settings' | 'chat' | 'guest-chat';
export type StatusType = 'plain' | 'success' | 'error';
export type MessageFrom = 'guest' | 'admin';

export type AdminInfo = {
  id: string;
  username: string;
};

export type LoginResult = {
  token: string;
  requiresSetup: boolean;
  admin: AdminInfo;
};

export type RoomInfo = {
  id: string;
  adminId: string;
  shareSlug: string;
  status: 'active' | 'closed';
  createdAt: string;
  shareUrl: string;
};

export type RoomResult = {
  room: RoomInfo;
  shareUrl: string;
};

export type ChatMessage = {
  from: MessageFrom;
  text: string;
  time: string;
  imageUrl?: string;
  mimeType?: string;
};

export type RelayRoomUser = {
  connectionId: string;
  roomId: string;
  role: MessageFrom;
  adminId?: string;
  username: string;
};

export type RoomUser = RelayRoomUser & {
  unreadCount: number;
  firstUnreadIndex: number | null;
  lastMessageAt: string;
  lastMessageAtMs: number;
};

export type PendingImage = {
  dataUrl: string;
  mimeType: string;
  name: string;
};

export type PreviewImage = {
  url: string;
  alt: string;
};

export type AccountForm = {
  username: string;
  password: string;
};

export type StatusState = {
  message: string;
  type: StatusType;
};
