# 管理端离线用户保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理端左侧用户列表在访客离线后仍保留该访客，并标记离线，管理员可继续查看内存中的历史消息但不能继续发送。

**Architecture:** 保持服务端仅下发当前在线快照，不改消息存储策略；前端新增一个纯函数，把在线快照与已有 `roomUsers` 合并，离线访客改为 `online=false` 保留在本地内存。管理端页面根据 `online` 状态展示离线标签，并在当前会话离线时禁用发送按钮与调整提示文案。

**Tech Stack:** TypeScript、Vue 3 组合式 API、Node.js `node:test`

---

### Task 1: 锁定在线列表合并规则

**Files:**
- Create: `F:\web-project\chat_online\test\room-user-presence.test.ts`
- Create: `F:\web-project\chat_online\apps\web\src\utils\roomUserPresence.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('在线快照刷新后保留已离线访客并标记为离线', () => {
  const nextUsers = mergeRoomUsersByPresence(previousUsers, onlineUsers);
  assert.equal(nextUsers.find((user) => user.guestSessionId === 'guest-1')?.online, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/room-user-presence.test.ts`
Expected: FAIL，提示 `mergeRoomUsersByPresence` 未定义或行为与预期不符

- [ ] **Step 3: 写最小实现**

```ts
export function mergeRoomUsersByPresence(previousUsers: RoomUser[], onlineUsers: RelayRoomUser[]): RoomUser[] {
  return [];
}
```

- [ ] **Step 4: 再跑测试确认通过**

Run: `npm test -- test/room-user-presence.test.ts`
Expected: PASS

### Task 2: 接入管理端离线展示与禁发

**Files:**
- Modify: `F:\web-project\chat_online\apps\web\src\types.ts`
- Modify: `F:\web-project\chat_online\apps\web\src\composables\useChatOnlineApp.ts`
- Modify: `F:\web-project\chat_online\apps\web\src\pages\AdminChatWindowPage.vue`
- Modify: `F:\web-project\chat_online\apps\web\src\styles.css`
- Modify: `F:\web-project\chat_online\test\frontendViteStructure.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
assert.match(frontEndSource, /user\.online \? \(user\.lastMessageAt \|\| '等待消息'\) : '离线'/);
assert.match(frontEndSource, /activeRoomUser\?\.online/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/frontendViteStructure.test.ts`
Expected: FAIL，提示缺少离线展示或离线禁发判断

- [ ] **Step 3: 写最小实现**

```ts
type RoomUser = RelayRoomUser & { online: boolean; unreadCount: number; ... };
const canSendMessage = computed(() => page.value === 'guest-chat'
  ? Boolean(guestRoom.value && hasMessageDraft.value)
  : Boolean(selectedGuestId.value && activeRoomUser.value?.online && hasMessageDraft.value));
```

- [ ] **Step 4: 再跑测试确认通过**

Run: `npm test -- test/frontendViteStructure.test.ts`
Expected: PASS

### Task 3: 做完整验证

**Files:**
- Test: `F:\web-project\chat_online\test\room-user-presence.test.ts`
- Test: `F:\web-project\chat_online\test\frontendViteStructure.test.ts`

- [ ] **Step 1: 运行定向测试**

Run: `npm test -- test/room-user-presence.test.ts test/frontendViteStructure.test.ts`
Expected: PASS，0 failures

- [ ] **Step 2: 运行类型检查**

Run: `npm run check`
Expected: PASS，TypeScript 无报错
