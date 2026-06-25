<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { ChatMessage, PendingImage, RoomInfo, RoomUser, StatusType } from '../types';

/**
 * 管理端聊天窗口页。
 * 职责：展示房间用户列表、当前访客会话和客服输入区；关键参数为当前房间、在线用户、会话消息和图片草稿；核心分支按是否选中访客决定发送按钮与空状态。
 */
defineProps<{
  activeRoomId: string;
  activeRoom: RoomInfo | null;
  copiedRoomId: string;
  connectionStatus: string;
  status: { message: string; type: StatusType };
  soundReminderEnabled: boolean;
  roomUserList: RoomUser[];
  activeGuestId: string;
  activeRoomUser: RoomUser | null;
  activeConversationMessages: ChatMessage[];
  pendingImages: PendingImage[];
  messageInput: string;
  canSendMessage: boolean;
  selectedGuestId: string;
  setMessageTimelineElement: (element: Element | ComponentPublicInstance | null) => void;
  setImageInputElement: (element: Element | ComponentPublicInstance | null) => void;
  getRoomUserAvatar: (user: RoomUser) => string;
  getRoomUserName: (user: RoomUser) => string;
}>();

const emit = defineEmits<{
  (event: 'toggle-sound-reminder'): void;
  (event: 'copy-share-url', room: RoomInfo): void;
  (event: 'select-room-user', user: RoomUser): void;
  (event: 'open-image-preview', message: ChatMessage): void;
  (event: 'remove-pending-image', index: number): void;
  (event: 'open-image-picker'): void;
  (event: 'image-select', value: Event): void;
  (event: 'composer-paste', value: ClipboardEvent): void;
  (event: 'message-media-loaded'): void;
  (event: 'send-message'): void;
  (event: 'update:messageInput', value: string): void;
}>();

/**
 * 把 textarea 输入事件转换为消息草稿文本。
 * @param event 输入事件；核心分支为仅从 textarea 读取 value，避免其他元素误触发。
 */
function updateMessageInput(event: Event): void {
  const target = event.target;

  if (target instanceof HTMLTextAreaElement) {
    emit('update:messageInput', target.value);
  }
}

/**
 * 获取管理端用户列表的稳定选中键。
 * @param user 房间用户；核心分支为访客优先使用浏览器会话 ID，旧连接或管理员回退到连接 ID。
 * @returns 可用于列表 key 和 active 判断的稳定标识。
 */
function getRoomUserActiveKey(user: RoomUser): string {
  return user.role === 'guest' ? user.guestSessionId ?? user.connectionId : user.connectionId;
}
</script>

<template>
<main class="chat-page" data-page="chat-workspace">
    <div class="chat-backdrop" aria-hidden="true"></div>
    <section class="chat-workspace" aria-label="客服聊天室工作台">
      <aside class="room-side" aria-label="当前聊天室信息">
        <div class="workspace-brand">
          <img class="brand-mark small" src="/favicon.svg" alt="" aria-hidden="true" />
          <div>
            <strong class="room-title-remark">房间 {{ activeRoom?.remarkName || (activeRoomId ? activeRoomId.slice(0, 8) : '未选择') }}</strong>
            <span>{{ connectionStatus }}</span>
          </div>
        </div>
        <div class="side-room-card">
          <span>当前房间</span>
          <div class="room-code-row">
            <span class="room-code-main">
              <strong>{{ activeRoom?.remarkName || (activeRoomId ? activeRoomId.slice(0, 8) : '未选择') }}</strong>
              <small v-if="activeRoomId">{{ activeRoomId.slice(0, 8) }}</small>
            </span>
            <button v-if="activeRoom" class="copy-room-button" type="button" @click="emit('copy-share-url', activeRoom)">
              {{ copiedRoomId === activeRoom.id ? '已复制' : '复制链接' }}
            </button>
          </div>
        </div>
        <div class="room-user-section">
          <div class="side-section-title">
            <span>房间用户</span>
            <strong>{{ roomUserList.length }}</strong>
          </div>
          <div class="room-user-list" aria-label="当前房间用户">
            <button
              v-for="user in roomUserList"
              :key="getRoomUserActiveKey(user)"
              class="room-user-card"
              :class="{ active: getRoomUserActiveKey(user) === activeGuestId, self: user.role === 'admin' }"
              type="button"
              @click="emit('select-room-user', user)"
            >
              <span class="avatar" :class="{ admin: user.role === 'admin' }">{{ getRoomUserAvatar(user) }}</span>
              <span class="room-user-main">
                <strong>{{ getRoomUserName(user) }}</strong>
                <small>{{ user.role === 'admin' ? '管理员' : user.lastMessageAt || '等待消息' }}</small>
              </span>
              <span v-if="user.unreadCount" class="unread-badge">{{ user.unreadCount }}</span>
            </button>
            <div v-if="!roomUserList.length" class="empty-state compact">暂无在线用户。</div>
          </div>
        </div>
        <a class="secondary-button side-link" href="/admin/rooms">返回聊天室管理</a>
      </aside>
      <section class="chat-panel" aria-label="聊天内容">
        <header class="chat-header">
          <div>
            <strong>{{ activeRoomUser ? getRoomUserName(activeRoomUser) : '在线客服工作台' }}</strong>
            <span>{{ activeRoomUser ? '当前会话已读' : connectionStatus }}</span>
          </div>
          <div class="chat-header-actions">
            <label class="sound-reminder-toggle">
              <input type="checkbox" :checked="soundReminderEnabled" @change="emit('toggle-sound-reminder')" />
              <span>声音提醒</span>
            </label>
            <a class="ghost-button" href="/admin/settings">设置</a>
          </div>
        </header>
        <div :ref="setMessageTimelineElement" class="message-timeline" aria-live="polite">
          <div
            v-for="(message, index) in activeConversationMessages"
            :key="`${message.time}-${index}`"
            class="message-row"
            :class="message.from"
            :data-message-index="index"
          >
            <span v-if="message.from === 'guest'" class="avatar">客</span>
            <div class="message-body">
              <span class="message-time">{{ message.time }}</span>
              <div class="message-bubble" :class="{ image: message.imageUrl || message.imageStatus }">
                <button v-if="message.imageUrl" class="message-image-button" type="button" @click="emit('open-image-preview', message)">
                  <img class="message-image" :src="message.imageUrl" :alt="message.text" @load="emit('message-media-loaded')" />
                </button>
                <div v-else-if="message.imageStatus === 'loading'" class="message-image-placeholder">
                  <img v-if="message.previewUrl" class="message-image preview" :src="message.previewUrl" :alt="message.text" @load="emit('message-media-loaded')" />
                  <span class="image-progress">图片加载中 {{ message.imageProgress ?? 0 }}%</span>
                </div>
                <div v-else-if="message.imageStatus === 'failed'" class="message-image-placeholder failed">
                  <span>图片加载失败</span>
                </div>
                <template v-else>{{ message.text }}</template>
              </div>
            </div>
            <span v-if="message.from === 'admin'" class="avatar">我</span>
          </div>
          <div v-if="activeGuestId && !activeConversationMessages.length" class="empty-chat-state">还没有消息，发送一条回复开始沟通。</div>
          <div v-if="!activeGuestId" class="empty-chat-state">请选择左侧访客查看聊天内容。</div>
        </div>
        <footer class="composer">
          <p v-if="status.message" class="status-text chat-status" :class="status.type" role="status">{{ status.message }}</p>
          <form class="message-form" @submit.prevent="emit('send-message')">
            <div class="composer-input-wrap">
              <div v-if="pendingImages.length" class="image-preview-list">
                <div v-for="(image, index) in pendingImages" :key="`${image.name}-${index}`" class="image-preview">
                  <img :src="image.dataUrl" :alt="image.name" />
                  <button class="image-preview-remove" type="button" aria-label="删除图片" @click="emit('remove-pending-image', index)">×</button>
                </div>
              </div>
              <textarea
                :value="messageInput"
                @input="updateMessageInput"
                rows="3"
                placeholder="请输入消息，按 Enter 键或点击发送按钮发送"
                @keydown.enter.exact.prevent="emit('send-message')"
                @paste="emit('composer-paste', $event)"
              ></textarea>
            </div>
            <input :ref="setImageInputElement" class="image-input" type="file" accept="image/*" @change="emit('image-select', $event)" />
            <div class="composer-action-stack">
              <button class="composer-upload-button" type="button" aria-label="选择图片" @click="emit('open-image-picker')">+</button>
              <button class="primary-button send-button" type="submit" :disabled="!canSendMessage">发送</button>
            </div>
          </form>
        </footer>
      </section>
    </section>
  </main>
</template>
