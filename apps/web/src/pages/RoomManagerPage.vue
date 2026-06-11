<script setup lang="ts">
import type { RoomInfo, StatusState } from '../types';

/**
 * 聊天室管理页。
 * 职责：展示房间统计、房间列表和房间操作；关键参数为房间集合、加载状态、复制状态和全局提示；核心分支按房间 active/closed 状态控制入口和删除按钮。
 */
defineProps<{
  rooms: RoomInfo[];
  loadingRooms: boolean;
  copiedRoomId: string;
  activeRoomsCount: number;
  status: StatusState;
}>();

const emit = defineEmits<{
  (event: 'logout'): void;
  (event: 'create-room'): void;
  (event: 'copy-share-url', room: RoomInfo): void;
  (event: 'delete-room', roomId: string): void;
}>();
</script>

<template>
<main class="admin-page" data-page="room-manager">
    <header class="topbar">
      <a class="brand-link" href="/admin/rooms" aria-label="聊天室管理">
        <span class="brand-mark small">CO</span>
        <strong>Chat Online</strong>
      </a>
      <nav class="top-actions" aria-label="管理端导航">
        <a class="active" href="/admin/rooms">聊天室</a>
        <a href="/admin/settings">设置</a>
        <button class="ghost-button" type="button" @click="emit('logout')">退出</button>
      </nav>
    </header>
    <section class="dashboard-layout">
      <div class="page-heading">
        <p class="eyebrow">聊天室管理</p>
        <h1>管理所有访客聊天室</h1>
        <p>在这里新建房间、复制分享链接、删除房间。点击房间名称后进入独立聊天窗口。</p>
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span>总房间</span>
          <strong>{{ rooms.length }}</strong>
        </div>
        <div class="metric-card">
          <span>可用房间</span>
          <strong>{{ activeRoomsCount }}</strong>
        </div>
        <button class="primary-button create-action" type="button" @click="emit('create-room')">新建聊天室</button>
      </div>
      <div class="table-panel">
        <div class="panel-title">
          <p>聊天室列表</p>
          <span>{{ loadingRooms ? '正在加载' : '实时接口数据' }}</span>
        </div>
        <div class="room-table">
          <div class="room-row room-head">
            <span>房间</span>
            <span>状态</span>
            <span>创建时间</span>
            <span>访客链接</span>
            <span>操作</span>
          </div>
          <div v-for="room in rooms" :key="room.id" class="room-row">
            <a
              class="room-name"
              :href="`/admin/chat?roomId=${encodeURIComponent(room.id)}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ room.id.slice(0, 8) }}
            </a>
            <span class="status-pill" :class="room.status">{{ room.status === 'active' ? '启用中' : '已删除' }}</span>
            <span>{{ new Date(room.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
            <code>{{ room.shareUrl }}</code>
            <span class="row-actions">
              <button class="secondary-button" type="button" @click="emit('copy-share-url', room)">
                {{ copiedRoomId === room.id ? '已复制' : '复制' }}
              </button>
              <button class="danger-button" type="button" :disabled="room.status === 'closed'" @click="emit('delete-room', room.id)">删除</button>
            </span>
          </div>
          <div v-if="!rooms.length" class="empty-state">还没有聊天室，先新建一个。</div>
        </div>
      </div>
      <p class="status-text" :class="status.type" role="status">{{ status.message }}</p>
    </section>
  </main>
</template>
