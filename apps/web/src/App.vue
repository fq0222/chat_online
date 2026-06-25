<script setup lang="ts">
import AdminChatWindowPage from './pages/AdminChatWindowPage.vue';
import AdminLoginPage from './pages/AdminLoginPage.vue';
import GuestChatWindowPage from './pages/GuestChatWindowPage.vue';
import PublicRoomsPage from './pages/PublicRoomsPage.vue';
import RoomManagerPage from './pages/RoomManagerPage.vue';
import { useChatOnlineApp } from './composables/useChatOnlineApp';

const {
  loginForm,
  setupForm,
  settingsForm,
  roomForm,
  roomEditDialog,
  status,
  toast,
  showSetup,
  rooms,
  publicRooms,
  loadingRooms,
  loadingPublicRooms,
  copiedRoomId,
  messageInput,
  connectionStatus,
  soundReminderEnabled,
  chatHistoryEnabled,
  activeGuestId,
  pendingImages,
  previewImage,
  page,
  activeRoomId,
  activeRoom,
  activeRoomsCount,
  roomUserList,
  activeRoomUser,
  selectedGuestId,
  activeConversationMessages,
  canSendMessage,
  setMessageTimelineElement,
  setImageInputElement,
  getRoomUserName,
  getRoomUserAvatar,
  buildAdminPath,
  openRoomEditor,
  closeRoomEditor,
  updateRoomEditField,
  toggleSoundReminder,
  toggleChatHistoryStorage,
  selectRoomUser,
  submitLogin,
  submitSetup,
  submitSettings,
  logout,
  createRoom,
  saveRoomSettings,
  copyShareUrl,
  deleteRoom,
  sendMessage,
  removePendingImage,
  openImagePreview,
  closeImagePreview,
  openImagePicker,
  handleImageSelect,
  handleComposerPaste,
  handleMessageMediaLoaded
} = useChatOnlineApp();
</script>

<template>
  <PublicRoomsPage
    v-if="page === 'home'"
    :rooms="publicRooms"
    :loading="loadingPublicRooms"
    :status="status"
  />

  <AdminLoginPage
    v-else-if="page === 'login'"
    :login-form="loginForm"
    :setup-form="setupForm"
    :status="status"
    :show-setup="showSetup"
    @submit-login="submitLogin"
    @submit-setup="submitSetup"
  />

  <RoomManagerPage
    v-else-if="page === 'rooms'"
    :rooms="rooms"
    :room-form="roomForm"
    :room-edit-dialog="roomEditDialog"
    :loading-rooms="loadingRooms"
    :copied-room-id="copiedRoomId"
    :active-rooms-count="activeRoomsCount"
    :status="status"
    :build-admin-path="buildAdminPath"
    @logout="logout"
    @create-room="createRoom"
    @open-room-editor="openRoomEditor"
    @close-room-editor="closeRoomEditor"
    @update-room-edit-field="updateRoomEditField"
    @save-room-settings="saveRoomSettings"
    @copy-share-url="copyShareUrl"
    @delete-room="deleteRoom"
  />

<main v-else-if="page === 'settings'" class="admin-page" data-page="admin-settings">
    <header class="topbar">
      <a class="brand-link" :href="buildAdminPath('rooms')" aria-label="聊天室管理">
        <span class="brand-mark small">CO</span>
        <strong>Chat Online</strong>
      </a>
      <nav class="top-actions" aria-label="管理端导航">
        <a :href="buildAdminPath('rooms')">聊天室</a>
        <a class="active" :href="buildAdminPath('settings')">设置</a>
        <button class="ghost-button" type="button" @click="logout">退出</button>
      </nav>
    </header>
    <section class="settings-layout">
      <div class="page-heading">
        <p class="eyebrow">管理员设置</p>
        <h1>修改用户名和密码</h1>
        <p>保存后旧 token 会立即失效，需要使用新账号重新登录。</p>
      </div>
      <form class="settings-card form-stack" @submit.prevent="submitSettings">
        <label>
          <span>用户名</span>
          <input v-model="settingsForm.username" autocomplete="username" required />
        </label>
        <label>
          <span>新密码</span>
          <input v-model="settingsForm.password" type="password" minlength="6" autocomplete="new-password" placeholder="不修改可留空" />
        </label>
        <button class="primary-button" type="submit">保存设置</button>
        <p class="status-text" :class="status.type" role="status">{{ status.message }}</p>
      </form>
    </section>
  </main>

  <AdminChatWindowPage
    v-else-if="page === 'chat'"
    v-model:message-input="messageInput"
    :active-room-id="activeRoomId"
    :active-room="activeRoom"
    :copied-room-id="copiedRoomId"
    :connection-status="connectionStatus"
    :status="status"
    :sound-reminder-enabled="soundReminderEnabled"
    :room-user-list="roomUserList"
    :active-guest-id="activeGuestId"
    :active-room-user="activeRoomUser"
    :active-conversation-messages="activeConversationMessages"
    :pending-images="pendingImages"
    :can-send-message="canSendMessage"
    :selected-guest-id="selectedGuestId"
    :set-message-timeline-element="setMessageTimelineElement"
    :set-image-input-element="setImageInputElement"
    :get-room-user-avatar="getRoomUserAvatar"
    :get-room-user-name="getRoomUserName"
    @toggle-sound-reminder="toggleSoundReminder"
    @copy-share-url="copyShareUrl"
    @select-room-user="selectRoomUser"
    @open-image-preview="openImagePreview"
    @remove-pending-image="removePendingImage"
    @open-image-picker="openImagePicker"
    @image-select="handleImageSelect"
    @composer-paste="handleComposerPaste"
    @message-media-loaded="handleMessageMediaLoaded"
    @send-message="sendMessage"
  />

  <GuestChatWindowPage
    v-else
    v-model:message-input="messageInput"
    :connection-status="connectionStatus"
    :status="status"
    :sound-reminder-enabled="soundReminderEnabled"
    :chat-history-enabled="chatHistoryEnabled"
    :chat-messages="activeConversationMessages"
    :pending-images="pendingImages"
    :can-send-message="canSendMessage"
    :set-message-timeline-element="setMessageTimelineElement"
    :set-image-input-element="setImageInputElement"
    @toggle-sound-reminder="toggleSoundReminder"
    @toggle-chat-history-storage="toggleChatHistoryStorage"
    @open-image-preview="openImagePreview"
    @remove-pending-image="removePendingImage"
    @open-image-picker="openImagePicker"
    @image-select="handleImageSelect"
    @composer-paste="handleComposerPaste"
    @message-media-loaded="handleMessageMediaLoaded"
    @send-message="sendMessage"
  />

  <Teleport to="body">
    <div v-if="toast.message" class="toast-message" :class="toast.type" role="alert">{{ toast.message }}</div>
    <div v-if="previewImage" class="image-viewer" role="dialog" aria-modal="true" @click.self="closeImagePreview">
      <button class="image-viewer-close" type="button" aria-label="关闭图片预览" @click="closeImagePreview">×</button>
      <img class="image-viewer-image" :src="previewImage.url" :alt="previewImage.alt" />
    </div>
  </Teleport>
</template>
