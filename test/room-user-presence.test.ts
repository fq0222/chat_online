import test from 'node:test';
import assert from 'node:assert/strict';
import type { RelayRoomUser, RoomUser } from '../apps/web/src/types';
import { mergeRoomUsersByPresence } from '../apps/web/src/utils/roomUserPresence';

/**
 * 创建测试用房间用户。
 * @param overrides 覆盖默认字段；核心分支通过 guestSessionId 固定同一访客会话，模拟重连后 connectionId 变化。
 * @returns 可直接参与在线状态合并的房间用户。
 */
function createRoomUser(overrides: Partial<RoomUser> = {}): RoomUser {
  return {
    connectionId: overrides.connectionId ?? 'conn-1',
    roomId: overrides.roomId ?? 'room-1',
    role: overrides.role ?? 'guest',
    adminId: overrides.adminId,
    guestSessionId: overrides.guestSessionId ?? 'guest-1',
    username: overrides.username ?? '用户-01',
    online: overrides.online ?? true,
    unreadCount: overrides.unreadCount ?? 0,
    firstUnreadIndex: overrides.firstUnreadIndex ?? null,
    lastMessageAt: overrides.lastMessageAt ?? '',
    lastMessageAtMs: overrides.lastMessageAtMs ?? 0
  };
}

/**
 * 创建测试用在线快照用户。
 * @param overrides 覆盖默认字段；核心分支允许只替换 connectionId，验证同一 guestSessionId 会合并到旧会话。
 * @returns 服务端 presence 快照中的在线用户。
 */
function createRelayRoomUser(overrides: Partial<RelayRoomUser> = {}): RelayRoomUser {
  return {
    connectionId: overrides.connectionId ?? 'conn-online-1',
    roomId: overrides.roomId ?? 'room-1',
    role: overrides.role ?? 'guest',
    adminId: overrides.adminId,
    guestSessionId: overrides.guestSessionId ?? 'guest-1',
    username: overrides.username ?? '用户-01'
  };
}

test('在线快照刷新后保留已离线访客并标记离线', () => {
  const previousUsers = [
    createRoomUser({
      connectionId: 'guest-conn-1',
      guestSessionId: 'guest-1',
      lastMessageAt: '2026/06/30 10:00:00',
      lastMessageAtMs: 1000
    }),
    createRoomUser({
      connectionId: 'admin-conn-1',
      role: 'admin',
      guestSessionId: undefined,
      username: '管理员'
    })
  ];

  const nextUsers = mergeRoomUsersByPresence(previousUsers, [
    createRelayRoomUser({
      connectionId: 'admin-conn-2',
      role: 'admin',
      guestSessionId: undefined,
      username: '管理员'
    })
  ]);

  assert.equal(nextUsers.length, 2);
  assert.equal(nextUsers.find((user) => user.role === 'guest')?.online, false);
  assert.equal(nextUsers.find((user) => user.role === 'guest')?.lastMessageAt, '2026/06/30 10:00:00');
  assert.equal(nextUsers.filter((user) => user.role === 'admin').length, 1);
  assert.equal(nextUsers.find((user) => user.role === 'admin')?.connectionId, 'admin-conn-2');
});

test('同一访客重连后按 guestSessionId 合并并保留未读状态', () => {
  const previousUsers = [
    createRoomUser({
      connectionId: 'guest-conn-1',
      guestSessionId: 'guest-2',
      unreadCount: 3,
      firstUnreadIndex: 5,
      lastMessageAt: '2026/06/30 10:01:00',
      lastMessageAtMs: 2000
    })
  ];

  const nextUsers = mergeRoomUsersByPresence(previousUsers, [
    createRelayRoomUser({
      connectionId: 'guest-conn-2',
      guestSessionId: 'guest-2',
      username: '用户-02'
    })
  ]);

  assert.equal(nextUsers.length, 1);
  assert.equal(nextUsers[0].connectionId, 'guest-conn-2');
  assert.equal(nextUsers[0].online, true);
  assert.equal(nextUsers[0].unreadCount, 3);
  assert.equal(nextUsers[0].firstUnreadIndex, 5);
  assert.equal(nextUsers[0].lastMessageAtMs, 2000);
});
