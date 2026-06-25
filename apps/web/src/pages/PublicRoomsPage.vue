<script setup lang="ts">
import type { RoomInfo, StatusState } from '../types';

/**
 * 公开聊天室主页。
 * 职责：展示管理员标记为显示在主页的聊天室；关键参数为公开房间列表、加载状态和全局状态；核心分支为加载中、空列表和可进入房间。
 */
defineProps<{
  rooms: RoomInfo[];
  loading: boolean;
  status: StatusState;
}>();
</script>

<template>
  <main class="public-rooms-page" data-page="public-rooms">
    <section class="public-rooms-shell" aria-labelledby="publicRoomsTitle">
      <header class="public-rooms-header">
        <div>
          <p class="eyebrow">Chat Online</p>
          <h1 id="publicRoomsTitle">公开聊天室</h1>
        </div>
        <span class="public-room-count">{{ loading ? '加载中' : `${rooms.length} 个房间` }}</span>
      </header>

      <div v-if="rooms.length" class="public-room-list">
        <article
          v-for="room in rooms"
          :key="room.id"
          class="public-room-item"
        >
          <span>
            <strong>{{ room.remarkName || '未命名聊天室' }}</strong>
          </span>
          <a
            class="public-room-enter-button"
            :href="room.shareUrl"
            :aria-label="`进入 ${room.remarkName || '未命名聊天室'}`"
          >
            进入
          </a>
        </article>
      </div>

      <div v-else class="public-room-empty">
        {{ loading ? '正在加载聊天室...' : '暂无公开聊天室' }}
      </div>

      <p v-if="status.message" class="status-text" :class="status.type" role="status">{{ status.message }}</p>
    </section>
  </main>
</template>
