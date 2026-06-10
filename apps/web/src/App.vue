<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

type PageName = 'login' | 'rooms' | 'settings' | 'chat' | 'guest-chat';
type StatusType = 'plain' | 'success' | 'error';
type MessageFrom = 'guest' | 'admin';

type AdminInfo = {
  id: string;
  username: string;
};

type LoginResult = {
  token: string;
  requiresSetup: boolean;
  admin: AdminInfo;
};

type RoomInfo = {
  id: string;
  adminId: string;
  shareSlug: string;
  status: 'active' | 'closed';
  createdAt: string;
  shareUrl: string;
};

type RoomResult = {
  room: RoomInfo;
  shareUrl: string;
};

type ChatMessage = {
  from: MessageFrom;
  text: string;
  time: string;
};

const storageKeys = {
  token: 'chatOnline.adminToken',
  admin: 'chatOnline.admin'
};

const loginForm = reactive({ username: 'admin', password: '' });
const setupForm = reactive({ username: '', password: '' });
const settingsForm = reactive({ username: '', password: '' });
const status = reactive({ message: '', type: 'plain' as StatusType });
const showSetup = ref(false);
const bootstrapToken = ref('');
const rooms = ref<RoomInfo[]>([]);
const guestRoom = ref<RoomInfo | null>(null);
const loadingRooms = ref(false);
const copiedRoomId = ref('');
const messageInput = ref('');
const connectionStatus = ref('等待连接');
const activeGuestId = ref('');
const socketRef = ref<WebSocket | null>(null);
const chatMessages = ref<ChatMessage[]>([
  { from: 'guest', text: '要先给他下单么', time: '2026-06-10 20:12:04' },
  { from: 'admin', text: '我等下一个有缘人', time: '2026-06-10 20:13:22' },
  { from: 'admin', text: '我这号上阁子都是2500起步', time: '2026-06-10 20:13:56' },
  { from: 'guest', text: '好的老板', time: '2026-06-10 20:14:18' }
]);

const page = computed<PageName>(() => {
  const path = window.location.pathname;

  if (path.startsWith('/chat/')) {
    return 'guest-chat';
  }

  if (path.includes('/admin/settings')) {
    return 'settings';
  }

  if (path.includes('/admin/chat')) {
    return 'chat';
  }

  if (path.includes('/admin/rooms')) {
    return 'rooms';
  }

  return 'login';
});

const admin = computed<AdminInfo | null>(() => {
  const raw = localStorage.getItem(storageKeys.admin);

  return raw ? (JSON.parse(raw) as AdminInfo) : null;
});
const activeRoomId = computed(() => new URLSearchParams(window.location.search).get('roomId') ?? '');
const shareSlug = computed(() => window.location.pathname.replace(/^\/chat\//, '').split('/')[0] ?? '');
const activeRoom = computed(() => rooms.value.find((room) => room.id === activeRoomId.value) ?? null);
const activeRoomsCount = computed(() => rooms.value.filter((room) => room.status === 'active').length);

/**
 * 更新页面状态提示。
 * @param message 要展示的文案。
 * @param type 提示类型；核心分支通过 type 控制成功、失败和普通样式。
 */
function setStatus(message: string, type: StatusType = 'plain'): void {
  status.message = message;
  status.type = type;
}

/**
 * 读取管理员登录 token。
 * @returns token 字符串；核心分支为未登录时返回空字符串，调用方据此跳转登录页。
 */
function getToken(): string {
  return localStorage.getItem(storageKeys.token) ?? '';
}

/**
 * 跳转到指定管理端路径。
 * @param path 目标路径；核心分支直接修改 location，交给 Vite 或 OpenResty 的 history fallback 承接。
 */
function navigate(path: string): void {
  window.location.href = path;
}

/**
 * 构造带鉴权的请求头。
 * @returns JSON 请求头和 Bearer token；核心分支为未登录时仍返回空 token，后端会拒绝请求。
 */
function authHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${getToken()}`
  };
}

/**
 * 发送 JSON API 请求。
 * @param url 请求地址。
 * @param options fetch 选项；核心分支负责解析后端错误并抛出可展示消息。
 * @returns 解析后的 JSON 响应。
 */
async function requestJson<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));

  if (response.status === 401 && page.value !== 'login') {
    clearSession();
    navigate('/admin/login?reason=expired');
    throw new Error('登录已失效，请重新登录。');
  }

  if (!response.ok) {
    throw new Error((body as { message?: string }).message ?? '请求失败');
  }

  return body as T;
}

/**
 * 处理管理员登录。
 * 核心分支：首次登录进入初始化表单；普通登录保存 token 并进入聊天室管理页。
 */
async function submitLogin(): Promise<void> {
  setStatus('正在登录...');

  try {
    const result = await requestJson<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm)
    });

    if (result.requiresSetup) {
      bootstrapToken.value = result.token;
      showSetup.value = true;
      setStatus('检测到首次登录，请创建数据库管理员。', 'success');
      return;
    }

    localStorage.setItem(storageKeys.token, result.token);
    localStorage.setItem(storageKeys.admin, JSON.stringify(result.admin));
    navigate('/admin/rooms');
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 创建首次数据库管理员。
 * 核心分支：初始化成功后隐藏表单，并要求使用新账号重新登录。
 */
async function submitSetup(): Promise<void> {
  setStatus('正在创建管理员...');

  try {
    await requestJson('/api/admin/setup', {
      method: 'POST',
      headers: { authorization: `Bearer ${bootstrapToken.value}` },
      body: JSON.stringify(setupForm)
    });
    showSetup.value = false;
    loginForm.password = '';
    setStatus('管理员创建成功，请使用新账号登录。', 'success');
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 加载当前管理员的聊天室列表。
 * 核心分支：未登录跳回登录页；已登录时读取房间列表并刷新管理表格。
 */
async function loadRooms(): Promise<void> {
  if (!getToken()) {
    navigate('/admin/login');
    return;
  }

  loadingRooms.value = true;

  try {
    const result = await requestJson<{ rooms: RoomInfo[] }>('/api/rooms', {
      method: 'GET',
      headers: authHeaders()
    });
    rooms.value = result.rooms;
  } catch (error) {
    setStatus((error as Error).message, 'error');
  } finally {
    loadingRooms.value = false;
  }
}

/**
 * 加载访客分享链接对应的聊天室。
 * 核心分支：分享标识有效时保存真实 roomId，失效或关闭时展示错误状态。
 */
async function loadGuestRoom(): Promise<void> {
  setStatus('正在进入聊天室...');

  try {
    const result = await requestJson<{ room: RoomInfo }>(`/api/rooms/share/${shareSlug.value}`, {
      method: 'GET'
    });
    guestRoom.value = result.room;
    setStatus('聊天室已连接，正在等待客服。', 'success');
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 创建聊天室并刷新列表。
 * 核心分支：创建成功后把新房间置顶展示，不自动进入聊天窗口。
 */
async function createRoom(): Promise<void> {
  setStatus('正在创建聊天室...');

  try {
    const result = await requestJson<RoomResult>('/api/rooms', {
      method: 'POST',
      headers: authHeaders()
    });
    rooms.value = [{ ...result.room, shareUrl: result.shareUrl }, ...rooms.value];
    setStatus('聊天室创建成功。', 'success');
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 关闭聊天室。
 * @param roomId 房间 ID。
 * 核心分支：用户确认后调用删除接口，后端会把状态改为 closed。
 */
async function deleteRoom(roomId: string): Promise<void> {
  if (!window.confirm('确认删除这个聊天室吗？删除后房间会被关闭。')) {
    return;
  }

  try {
    const result = await requestJson<{ room: RoomInfo }>(`/api/rooms/${roomId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    rooms.value = rooms.value.map((room) => (room.id === roomId ? { ...room, ...result.room } : room));
    setStatus('聊天室已删除。', 'success');
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 使用传统文本选择方式复制内容。
 * @param text 要复制的文本。
 * @returns 复制是否成功；核心分支为非安全上下文或剪贴板 API 不可用时兜底。
 */
function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * 复制分享链接。
 * @param room 要复制访客链接的聊天室。
 * 核心分支：优先使用 Clipboard API，失败时回退到 execCommand，并在当前行展示复制结果。
 */
async function copyShareUrl(room: RoomInfo): Promise<void> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(room.shareUrl);
    } else if (!fallbackCopyText(room.shareUrl)) {
      throw new Error('浏览器拒绝复制，请手动选中链接复制。');
    }

    copiedRoomId.value = room.id;
    setStatus('分享链接已复制。', 'success');
    window.setTimeout(() => {
      if (copiedRoomId.value === room.id) {
        copiedRoomId.value = '';
      }
    }, 1800);
  } catch (error) {
    copiedRoomId.value = '';
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 更新管理员资料。
 * 核心分支：后端更新后会撤销旧 token，因此前端清理登录态并返回登录页。
 */
async function submitSettings(): Promise<void> {
  setStatus('正在保存设置...');

  try {
    await requestJson('/api/admin/profile', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        username: settingsForm.username,
        password: settingsForm.password || undefined
      })
    });
    logout();
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * 清理本地登录态。
 * 核心分支：后端返回 401 或用户主动退出时移除旧 token 和管理员信息。
 */
function clearSession(): void {
  localStorage.removeItem(storageKeys.token);
  localStorage.removeItem(storageKeys.admin);
}

/**
 * 清理本地登录态并返回登录页。
 */
function logout(): void {
  clearSession();
  navigate('/admin/login');
}

/**
 * 写入快捷回复。
 * @param text 快捷回复内容。
 */
function useTemplate(text: string): void {
  messageInput.value = text;
}

/**
 * 发送客服消息。
 * 核心分支：本地先展示消息；真实 WebSocket 在线且已有访客时同步发给访客。
 */
function sendMessage(): void {
  const text = messageInput.value.trim();

  if (!text) {
    return;
  }

  chatMessages.value.push({
    from: page.value === 'guest-chat' ? 'guest' : 'admin',
    text,
    time: new Date().toLocaleString('zh-CN', { hour12: false })
  });
  messageInput.value = '';

  if (page.value === 'guest-chat' && socketRef.value?.readyState === WebSocket.OPEN) {
    socketRef.value.send(
      JSON.stringify({
        type: 'text',
        clientMessageId: `guest-${Date.now()}`,
        payload: { text }
      })
    );
    return;
  }

  if (socketRef.value?.readyState === WebSocket.OPEN && activeGuestId.value) {
    socketRef.value.send(
      JSON.stringify({
        type: 'text',
        clientMessageId: `admin-${Date.now()}`,
        targetConnectionId: activeGuestId.value,
        payload: { text }
      })
    );
  }
}

/**
 * 连接真实聊天室 WebSocket。
 * @param roomId 房间 ID；核心分支为缺少 token 或 roomId 时提示从管理页选择房间。
 */
function connectChatSocket(roomId: string): void {
  const token = getToken();

  if (!roomId || !token) {
    connectionStatus.value = '请选择聊天室';
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws/chat?role=admin&roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`
  );
  socketRef.value = socket;
  connectionStatus.value = '正在连接实时服务';

  socket.addEventListener('open', () => {
    connectionStatus.value = '实时服务已连接';
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data) as {
      event: string;
      sentAt: string;
      from: { connectionId: string };
      payload: { text?: string };
    };

    if (data.event !== 'message:new') {
      return;
    }

    activeGuestId.value = data.from.connectionId;
    chatMessages.value.push({
      from: 'guest',
      text: data.payload.text ?? '[图片消息]',
      time: new Date(data.sentAt).toLocaleString('zh-CN', { hour12: false })
    });
  });
  socket.addEventListener('close', () => {
    connectionStatus.value = '实时服务已断开';
  });
}

/**
 * 连接访客聊天室 WebSocket。
 * @param roomId 房间 ID；核心分支为分享链接解析成功后以 guest 身份连接，无需管理员 token。
 */
function connectGuestChatSocket(roomId: string): void {
  if (!roomId) {
    connectionStatus.value = '聊天室不可用';
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/chat?role=guest&roomId=${encodeURIComponent(roomId)}`);
  socketRef.value = socket;
  connectionStatus.value = '正在连接客服';

  socket.addEventListener('open', () => {
    connectionStatus.value = '已进入聊天室';
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data) as {
      event: string;
      sentAt?: string;
      payload?: { text?: string };
      message?: string;
    };

    if (data.event === 'message:error') {
      setStatus(data.message ?? '消息发送失败', 'error');
      return;
    }

    if (data.event !== 'message:new') {
      return;
    }

    chatMessages.value.push({
      from: 'admin',
      text: data.payload?.text ?? '[图片消息]',
      time: data.sentAt ? new Date(data.sentAt).toLocaleString('zh-CN', { hour12: false }) : new Date().toLocaleString('zh-CN', { hour12: false })
    });
  });
  socket.addEventListener('close', () => {
    connectionStatus.value = '连接已断开';
  });
}

onMounted(async () => {
  if (page.value === 'login' && new URLSearchParams(window.location.search).get('reason') === 'expired') {
    setStatus('登录已失效，请重新登录。', 'error');
    return;
  }

  if (page.value === 'guest-chat') {
    await loadGuestRoom();

    if (guestRoom.value) {
      connectGuestChatSocket(guestRoom.value.id);
    }

    return;
  }

  if (page.value !== 'login' && !getToken()) {
    navigate('/admin/login');
    return;
  }

  if (page.value === 'rooms') {
    await loadRooms();
  }

  if (page.value === 'settings') {
    settingsForm.username = admin.value?.username ?? '';
  }

  if (page.value === 'chat') {
    await loadRooms();
    connectChatSocket(activeRoomId.value);
  }
});
</script>

<template>
  <main v-if="page === 'login'" class="auth-shell" data-page="admin-login">
    <section class="auth-layout" aria-labelledby="loginTitle">
      <div class="auth-visual">
        <div class="brand-mark">CO</div>
        <p class="eyebrow">Chat Online 管理端</p>
        <h1 id="loginTitle">把访客会话稳稳接住</h1>
        <p class="auth-copy">登录后可创建聊天室、复制访客入口，并在 PC 工作台集中处理实时消息。</p>
        <div class="auth-stats" aria-label="管理端能力">
          <span>实时转发</span>
          <span>房间分享</span>
          <span>客服工作台</span>
        </div>
      </div>
      <div class="auth-card" aria-label="登录表单">
        <div class="panel-title">
          <p>管理员登录</p>
          <span>PC 管理后台</span>
        </div>
        <form class="form-stack" @submit.prevent="submitLogin">
          <label>
            <span>用户名</span>
            <input v-model="loginForm.username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input v-model="loginForm.password" type="password" autocomplete="current-password" required />
          </label>
          <button class="primary-button" type="submit">登录</button>
        </form>
        <form v-if="showSetup" class="form-stack setup-panel" @submit.prevent="submitSetup">
          <div class="notice">首次登录需要创建数据库管理员。当前临时 token 会自动用于初始化。</div>
          <label>
            <span>新管理员用户名</span>
            <input v-model="setupForm.username" autocomplete="off" required />
          </label>
          <label>
            <span>新管理员密码</span>
            <input v-model="setupForm.password" type="password" minlength="6" required />
          </label>
          <button class="secondary-button" type="submit">创建管理员</button>
        </form>
        <p class="status-text" :class="status.type" role="status">{{ status.message }}</p>
      </div>
    </section>
  </main>

  <main v-else-if="page === 'rooms'" class="admin-page" data-page="room-manager">
    <header class="topbar">
      <a class="brand-link" href="/admin/rooms" aria-label="聊天室管理">
        <span class="brand-mark small">CO</span>
        <strong>Chat Online</strong>
      </a>
      <nav class="top-actions" aria-label="管理端导航">
        <a class="active" href="/admin/rooms">聊天室</a>
        <a href="/admin/settings">设置</a>
        <button class="ghost-button" type="button" @click="logout">退出</button>
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
        <button class="primary-button create-action" type="button" @click="createRoom">新建聊天室</button>
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
            <a class="room-name" :href="`/admin/chat?roomId=${encodeURIComponent(room.id)}`">{{ room.id.slice(0, 8) }}</a>
            <span class="status-pill" :class="room.status">{{ room.status === 'active' ? '启用中' : '已删除' }}</span>
            <span>{{ new Date(room.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
            <code>{{ room.shareUrl }}</code>
            <span class="row-actions">
              <button class="secondary-button" type="button" @click="copyShareUrl(room)">
                {{ copiedRoomId === room.id ? '已复制' : '复制' }}
              </button>
              <button class="danger-button" type="button" :disabled="room.status === 'closed'" @click="deleteRoom(room.id)">删除</button>
            </span>
          </div>
          <div v-if="!rooms.length" class="empty-state">还没有聊天室，先新建一个。</div>
        </div>
      </div>
      <p class="status-text" :class="status.type" role="status">{{ status.message }}</p>
    </section>
  </main>

  <main v-else-if="page === 'settings'" class="admin-page" data-page="admin-settings">
    <header class="topbar">
      <a class="brand-link" href="/admin/rooms" aria-label="聊天室管理">
        <span class="brand-mark small">CO</span>
        <strong>Chat Online</strong>
      </a>
      <nav class="top-actions" aria-label="管理端导航">
        <a href="/admin/rooms">聊天室</a>
        <a class="active" href="/admin/settings">设置</a>
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

  <main v-else-if="page === 'chat'" class="chat-page" data-page="chat-workspace">
    <div class="chat-backdrop" aria-hidden="true"></div>
    <section class="chat-workspace" aria-label="客服聊天室工作台">
      <aside class="room-side" aria-label="当前聊天室信息">
        <div class="workspace-brand">
          <span class="brand-mark small">CO</span>
          <div>
            <strong>聊天室窗口</strong>
            <span>{{ connectionStatus }}</span>
          </div>
        </div>
        <div class="side-room-card">
          <span>当前房间</span>
          <strong>{{ activeRoomId ? activeRoomId.slice(0, 8) : '未选择' }}</strong>
          <p>{{ activeRoom?.shareUrl ?? '请从聊天室管理页选择房间进入。' }}</p>
        </div>
        <a class="secondary-button side-link" href="/admin/rooms">返回聊天室管理</a>
      </aside>
      <section class="chat-panel" aria-label="聊天内容">
        <header class="chat-header">
          <div>
            <strong>在线客服工作台</strong>
            <span>{{ connectionStatus }}</span>
          </div>
          <a class="ghost-button" href="/admin/settings">设置</a>
        </header>
        <div class="message-timeline" aria-live="polite">
          <div v-for="(message, index) in chatMessages" :key="`${message.time}-${index}`" class="message-row" :class="message.from">
            <span v-if="message.from === 'guest'" class="avatar">客</span>
            <div class="message-body">
              <span class="message-time">{{ message.time }}</span>
              <div class="message-bubble">{{ message.text }}</div>
            </div>
            <span v-if="message.from === 'admin'" class="avatar">我</span>
          </div>
        </div>
        <footer class="composer">
          <div class="quick-actions" aria-label="快捷入口">
            <button type="button" @click="useTemplate('我的订单')">我的订单</button>
            <button type="button" @click="useTemplate('咨询商品')">咨询商品</button>
            <button type="button" @click="useTemplate('稍等，我帮您核实一下')">常用回复</button>
          </div>
          <form class="message-form" @submit.prevent="sendMessage">
            <textarea
              v-model="messageInput"
              rows="3"
              placeholder="请输入消息，按 Enter 键或点击发送按钮发送"
              @keydown.enter.exact.prevent="sendMessage"
            ></textarea>
            <button class="primary-button send-button" type="submit">发送</button>
          </form>
        </footer>
      </section>
    </section>
  </main>

  <main v-else class="guest-chat-page" data-page="guest-chat">
    <section class="guest-chat-shell" aria-label="访客聊天室">
      <header class="guest-header">
        <div>
          <span class="brand-mark small">CO</span>
          <strong>在线客服</strong>
        </div>
        <span>{{ connectionStatus }}</span>
      </header>
      <div class="guest-room-info">
        <span>聊天室</span>
        <strong>{{ guestRoom?.id.slice(0, 8) ?? '加载中' }}</strong>
        <p>请在这里发送消息，客服在线时会实时回复。</p>
      </div>
      <div class="message-timeline guest-timeline" aria-live="polite">
        <div v-for="(message, index) in chatMessages" :key="`${message.time}-${index}`" class="message-row" :class="message.from">
          <span v-if="message.from === 'admin'" class="avatar">客</span>
          <div class="message-body">
            <span class="message-time">{{ message.time }}</span>
            <div class="message-bubble">{{ message.text }}</div>
          </div>
          <span v-if="message.from === 'guest'" class="avatar">我</span>
        </div>
      </div>
      <footer class="composer">
        <form class="message-form" @submit.prevent="sendMessage">
          <textarea
            v-model="messageInput"
            rows="3"
            placeholder="请输入消息，按 Enter 键发送"
            @keydown.enter.exact.prevent="sendMessage"
          ></textarea>
          <button class="primary-button send-button" type="submit" :disabled="!guestRoom">发送</button>
        </form>
        <p class="status-text" :class="status.type" role="status">{{ status.message }}</p>
      </footer>
    </section>
  </main>
</template>
