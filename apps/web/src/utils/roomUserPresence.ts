import type { RelayRoomUser, RoomUser } from '../types';

/**
 * 生成管理端会话聚合键。
 * @param user 房间用户摘要；核心分支为访客优先使用稳定的 guestSessionId，让重连后仍能命中同一条会话。
 * @returns 可用于消息缓存、选中态和在线状态合并的稳定键。
 */
export function getRoomUserConversationKey(user: Pick<RelayRoomUser, 'connectionId' | 'role' | 'guestSessionId'>): string {
  return user.role === 'guest' ? user.guestSessionId ?? user.connectionId : user.connectionId;
}

/**
 * 合并服务端在线快照与管理端本地会话列表。
 * @param previousUsers 管理端当前内存中的房间用户；核心分支保留离线访客的未读数和最近消息时间。
 * @param onlineUsers 服务端最新下发的在线快照；核心分支为在线用户强制标记 online=true，离线访客保留但标记为 false。
 * @returns 供管理端左侧列表继续展示的完整用户集合。
 */
export function mergeRoomUsersByPresence(previousUsers: RoomUser[], onlineUsers: RelayRoomUser[]): RoomUser[] {
  const previousMap = new Map(previousUsers.map((user) => [getRoomUserConversationKey(user), user]));
  const mergedUsers = onlineUsers.map((user) => {
    const current = previousMap.get(getRoomUserConversationKey(user));

    return {
      ...user,
      online: true,
      unreadCount: current?.unreadCount ?? 0,
      firstUnreadIndex: current?.firstUnreadIndex ?? null,
      lastMessageAt: current?.lastMessageAt ?? '',
      lastMessageAtMs: current?.lastMessageAtMs ?? 0
    };
  });
  const nextKeySet = new Set(mergedUsers.map((user) => getRoomUserConversationKey(user)));
  const offlineGuests = previousUsers
    .filter((user) => user.role === 'guest' && !nextKeySet.has(getRoomUserConversationKey(user)))
    .map((user) => ({
      ...user,
      online: false
    }));

  return [...mergedUsers, ...offlineGuests];
}
