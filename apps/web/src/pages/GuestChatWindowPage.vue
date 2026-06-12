<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { ChatMessage, PendingImage, StatusType } from '../types';

/**
 * 用户端聊天窗口页。
 * 职责：展示访客实时聊天内容和输入区；关键参数为连接状态、消息列表、图片草稿和发送能力；核心分支按访客/管理员消息方向决定气泡位置。
 */
defineProps<{
  connectionStatus: string;
  status: { message: string; type: StatusType };
  soundReminderEnabled: boolean;
  chatHistoryEnabled: boolean;
  chatMessages: ChatMessage[];
  pendingImages: PendingImage[];
  messageInput: string;
  canSendMessage: boolean;
  setMessageTimelineElement: (element: Element | ComponentPublicInstance | null) => void;
  setImageInputElement: (element: Element | ComponentPublicInstance | null) => void;
}>();

const emit = defineEmits<{
  (event: 'toggle-sound-reminder'): void;
  (event: 'toggle-chat-history-storage'): void;
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
</script>

<template>
<main class="guest-chat-page" data-page="guest-chat">
    <section class="guest-chat-shell" aria-label="访客聊天室">
      <header class="guest-header">
        <div>
          <span class="brand-mark small">CO</span>
          <strong>在线客服</strong>
        </div>
        <p class="guest-refresh-warning">
          {{ chatHistoryEnabled ? '已开启浏览器缓存保存，服务器仍不保存聊天记录。' : '请勿刷新网页，刷新后聊天记录会被清空，服务器不保存。' }}
        </p>
        <div class="guest-header-actions">
          <label class="sound-reminder-toggle">
            <input type="checkbox" :checked="soundReminderEnabled" @change="emit('toggle-sound-reminder')" />
            <span>声音提醒</span>
          </label>
          <label class="chat-history-toggle">
            <input type="checkbox" :checked="chatHistoryEnabled" @change="emit('toggle-chat-history-storage')" />
            <span>保存记录</span>
          </label>
          <span>{{ connectionStatus }}</span>
        </div>
      </header>
      <div :ref="setMessageTimelineElement" class="message-timeline guest-timeline" aria-live="polite">
        <div v-for="(message, index) in chatMessages" :key="`${message.time}-${index}`" class="message-row" :class="message.from">
          <span v-if="message.from === 'admin'" class="avatar">管</span>
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
          <span v-if="message.from === 'guest'" class="avatar">我</span>
        </div>
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
          <input :ref="setImageInputElement" class="image-input" type="file" accept="image/*" multiple @change="emit('image-select', $event)" />
          <div class="composer-action-stack">
            <button class="composer-upload-button" type="button" aria-label="选择图片" @click="emit('open-image-picker')">+</button>
            <button class="primary-button send-button" type="submit" :disabled="!canSendMessage">发送</button>
          </div>
        </form>
      </footer>
    </section>
  </main>
</template>
