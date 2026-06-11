<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';

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
  imageUrl?: string;
  mimeType?: string;
};

type RelayRoomUser = {
  connectionId: string;
  roomId: string;
  role: MessageFrom;
  adminId?: string;
  username: string;
};

type RoomUser = RelayRoomUser & {
  unreadCount: number;
  firstUnreadIndex: number | null;
  lastMessageAt: string;
  lastMessageAtMs: number;
};

type PendingImage = {
  dataUrl: string;
  mimeType: string;
  name: string;
};

type PreviewImage = {
  url: string;
  alt: string;
};

const storageKeys = {
  token: 'chatOnline.adminToken',
  admin: 'chatOnline.admin'
};
const supportedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
const maxImageBytes = 1024 * 1024 * 5;
const maxPendingImages = 5;

const loginForm = reactive({ username: '', password: '' });
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
const messageTimelineRef = ref<HTMLElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);
const pendingUnreadScrollIndex = ref<number | null>(null);
const pendingImages = ref<PendingImage[]>([]);
const previewImage = ref<PreviewImage | null>(null);
const roomUsers = ref<RoomUser[]>([]);
const roomConversations = ref<Record<string, ChatMessage[]>>({});
const chatMessages = ref<ChatMessage[]>([]);

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
const roomUserList = computed(() =>
  [...roomUsers.value].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === 'admin' ? -1 : 1;
    }

    return right.lastMessageAtMs - left.lastMessageAtMs;
  })
);
const activeRoomUser = computed(() => roomUsers.value.find((user) => user.connectionId === activeGuestId.value) ?? null);
const selectedGuestId = computed(() => (activeRoomUser.value?.role === 'guest' ? activeGuestId.value : ''));
const activeConversationMessages = computed(() =>
  page.value === 'chat' && activeGuestId.value ? roomConversations.value[activeGuestId.value] ?? [] : chatMessages.value
);
const hasMessageDraft = computed(() => Boolean(messageInput.value.trim() || pendingImages.value.length));
const canSendMessage = computed(() =>
  page.value === 'guest-chat' ? Boolean(guestRoom.value && hasMessageDraft.value) : Boolean(selectedGuestId.value && hasMessageDraft.value)
);

/**
 * 格式化消息时间。
 * @param date 原始时间；核心分支为未传入时使用当前时间，保持本地展示一致。
 * @returns 中文本地时间字符串。
 */
function formatMessageTime(date = new Date()): string {
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 获取房间用户展示名。
 * @param user 房间用户；核心分支为管理员优先使用本地登录用户名，访客使用实时服务下发用户名。
 * @returns 展示在用户卡片上的名称。
 */
function getRoomUserName(user: RoomUser): string {
  return user.role === 'admin' ? admin.value?.username ?? user.username : user.username;
}

/**
 * 生成房间用户头像文字。
 * @param user 房间用户；核心分支为管理员显示“管”，访客显示用户名末尾编号。
 * @returns 单字或短编号头像文案。
 */
function getRoomUserAvatar(user: RoomUser): string {
  if (user.role === 'admin') {
    return '管';
  }

  return user.username.replace(/^用户-/, '').slice(-2) || '客';
}

/**
 * 写入或更新房间用户。
 * @param user 实时服务下发的用户摘要；核心分支会保留已有未读数和最近消息时间。
 */
function upsertRoomUser(user: RelayRoomUser): void {
  const current = roomUsers.value.find((item) => item.connectionId === user.connectionId);
  const next: RoomUser = {
    ...user,
    unreadCount: current?.unreadCount ?? 0,
    firstUnreadIndex: current?.firstUnreadIndex ?? null,
    lastMessageAt: current?.lastMessageAt ?? '',
    lastMessageAtMs: current?.lastMessageAtMs ?? 0
  };

  roomUsers.value = current
    ? roomUsers.value.map((item) => (item.connectionId === user.connectionId ? next : item))
    : [...roomUsers.value, next];
}

/**
 * 用在线用户快照刷新左侧用户列表。
 * @param users 后端 presence 事件下发的在线用户；核心分支保留未读状态并移除已离线用户。
 */
function syncRoomUsers(users: RelayRoomUser[]): void {
  const previous = new Map(roomUsers.value.map((user) => [user.connectionId, user]));
  roomUsers.value = users.map((user) => {
    const current = previous.get(user.connectionId);

    return {
      ...user,
      unreadCount: current?.unreadCount ?? 0,
      firstUnreadIndex: current?.firstUnreadIndex ?? null,
      lastMessageAt: current?.lastMessageAt ?? '',
      lastMessageAtMs: current?.lastMessageAtMs ?? 0
    };
  });

  if (activeGuestId.value && !roomUsers.value.some((user) => user.connectionId === activeGuestId.value)) {
    activeGuestId.value = '';
  }
}

/**
 * 更新用户最近消息信息。
 * @param connectionId 用户连接 ID。
 * @param timeText 展示时间；核心分支同步排序时间戳，驱动用户列表按新消息排序。
 * @param timeMs 排序时间戳。
 */
function touchRoomUserMessage(connectionId: string, timeText: string, timeMs: number): void {
  roomUsers.value = roomUsers.value.map((user) =>
    user.connectionId === connectionId ? { ...user, lastMessageAt: timeText, lastMessageAtMs: timeMs } : user
  );
}

/**
 * 把聊天区滚动到最新消息。
 * 核心分支：当前聚焦会话默认已读，因此新消息或主动发送后定位到最新已读位置。
 */
function scrollToLatestReadMessage(): void {
  void nextTick(() => {
    if (messageTimelineRef.value) {
      messageTimelineRef.value.scrollTop = messageTimelineRef.value.scrollHeight;
    }
  });
}

/**
 * 把聊天区滚动到第一条未读消息。
 * 核心分支：切换到未展开会话时优先定位未读起点，找不到锚点时回到最新消息。
 */
function scrollToFirstUnreadMessage(): void {
  void nextTick(() => {
    if (pendingUnreadScrollIndex.value === null || !messageTimelineRef.value) {
      scrollToLatestReadMessage();
      return;
    }

    const target = messageTimelineRef.value.querySelector<HTMLElement>(
      `[data-message-index="${pendingUnreadScrollIndex.value}"]`
    );
    pendingUnreadScrollIndex.value = null;

    if (target) {
      target.scrollIntoView({ block: 'start' });
      return;
    }

    scrollToLatestReadMessage();
  });
}

/**
 * 选择左侧房间用户。
 * @param user 房间用户；核心分支为访客会话清空未读红圈，管理员本人不打开自聊窗口。
 */
function selectRoomUser(user: RoomUser): void {
  if (user.role === 'admin') {
    activeGuestId.value = '';
    return;
  }

  activeGuestId.value = user.connectionId;
  pendingUnreadScrollIndex.value = user.firstUnreadIndex;
  roomUsers.value = roomUsers.value.map((item) =>
    item.connectionId === user.connectionId ? { ...item, unreadCount: 0, firstUnreadIndex: null } : item
  );
  scrollToFirstUnreadMessage();
}

/**
 * 写入管理端访客会话消息。
 * @param guest 访客连接摘要。
 * @param message 消息内容。
 * @param sentAt 原始发送时间；核心分支根据是否当前聚焦决定红圈未读数和滚动位置。
 */
function appendAdminConversationMessage(guest: RelayRoomUser, message: ChatMessage, sentAt: Date): void {
  upsertRoomUser(guest);

  const messages = roomConversations.value[guest.connectionId] ?? [];
  const nextMessages = [...messages, message];
  const shouldFocus = !activeGuestId.value || activeGuestId.value === guest.connectionId;

  roomConversations.value = {
    ...roomConversations.value,
    [guest.connectionId]: nextMessages
  };
  touchRoomUserMessage(guest.connectionId, message.time, sentAt.getTime());

  if (!activeGuestId.value) {
    activeGuestId.value = guest.connectionId;
  }

  if (shouldFocus) {
    roomUsers.value = roomUsers.value.map((user) =>
      user.connectionId === guest.connectionId ? { ...user, unreadCount: 0, firstUnreadIndex: null } : user
    );
    scrollToLatestReadMessage();
    return;
  }

  roomUsers.value = roomUsers.value.map((user) => {
    if (user.connectionId !== guest.connectionId) {
      return user;
    }

    return {
      ...user,
      unreadCount: user.unreadCount + 1,
      firstUnreadIndex: user.firstUnreadIndex ?? messages.length
    };
  });
}

/**
 * 写入当前客服主动发送的消息。
 * @param text 消息文本；核心分支仅在选中访客时写入对应会话。
 * @returns 是否成功写入。
 */
function appendCurrentAdminMessage(text: string): boolean {
  const targetGuestId = selectedGuestId.value;

  if (!targetGuestId) {
    setStatus('请先在左侧选择一位访客。', 'error');
    return false;
  }

  const now = new Date();
  const time = formatMessageTime(now);
  const messages = roomConversations.value[targetGuestId] ?? [];
  roomConversations.value = {
    ...roomConversations.value,
    [targetGuestId]: [...messages, { from: 'admin', text, time }]
  };
  touchRoomUserMessage(targetGuestId, time, now.getTime());
  scrollToLatestReadMessage();

  return true;
}

/**
 * 写入当前客服主动发送的图片消息。
 * @param dataUrl 图片 dataURL。
 * @param mimeType 图片 MIME 类型；核心分支会同步写入当前访客会话和最近消息排序。
 * @returns 是否成功写入。
 */
function appendCurrentAdminImage(dataUrl: string, mimeType: string): boolean {
  const targetGuestId = selectedGuestId.value;

  if (!targetGuestId) {
    setStatus('请先在左侧选择一位访客。', 'error');
    return false;
  }

  const now = new Date();
  const time = formatMessageTime(now);
  const messages = roomConversations.value[targetGuestId] ?? [];
  roomConversations.value = {
    ...roomConversations.value,
    [targetGuestId]: [...messages, { from: 'admin', text: '[图片消息]', time, imageUrl: dataUrl, mimeType }]
  };
  touchRoomUserMessage(targetGuestId, time, now.getTime());
  scrollToLatestReadMessage();

  return true;
}

/**
 * 读取图片文件为 dataURL。
 * @param file 本地图片文件；核心分支为 FileReader 成功时返回 dataURL，读取失败时抛出错误。
 * @returns 可直接展示和转发的 dataURL 字符串。
 */
function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('图片读取失败，请重新选择。'));
    });
    reader.addEventListener('error', () => {
      reject(new Error('图片读取失败，请重新选择。'));
    });
    reader.readAsDataURL(file);
  });
}

/**
 * 校验本地图片文件。
 * @param file 本地文件；核心分支限制图片格式和大小，与后端图片转发校验保持一致。
 * @returns 校验失败文案，校验通过时返回空字符串。
 */
function getImageFileError(file: File): string {
  if (!supportedImageMimeTypes.includes(file.type)) {
    return '仅支持 PNG、JPG、WEBP 图片。';
  }

  if (file.size > maxImageBytes) {
    return '图片大小不能超过 5MB。';
  }

  return '';
}

/**
 * 准备待发送图片。
 * @param file 本地图片文件；核心分支为校验通过后生成输入区缩略图，等待用户点击发送。
 */
async function prepareImageFile(file: File): Promise<void> {
  if (pendingImages.value.length >= maxPendingImages) {
    setStatus(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
    return;
  }

  const error = getImageFileError(file);

  if (error) {
    setStatus(error, 'error');
    return;
  }

  try {
    const dataUrl = await readImageFileAsDataUrl(file);
    if (pendingImages.value.length >= maxPendingImages) {
      setStatus(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
      return;
    }

    pendingImages.value = [...pendingImages.value, { dataUrl, mimeType: file.type, name: file.name || '待发送图片' }];
  } catch (readError) {
    setStatus((readError as Error).message, 'error');
  }
}

/**
 * 清除待发送图片缩略图。
 * @param index 图片草稿下标；核心分支：用户点击缩略图右上角关闭按钮时移除对应图片，不影响文字输入和其他图片。
 */
function removePendingImage(index: number): void {
  pendingImages.value = pendingImages.value.filter((_, itemIndex) => itemIndex !== index);
}

/**
 * 打开聊天图片原图预览。
 * @param message 聊天消息；核心分支仅处理带图片地址的消息，文本消息不会打开预览。
 */
function openImagePreview(message: ChatMessage): void {
  if (!message.imageUrl) {
    return;
  }

  previewImage.value = {
    url: message.imageUrl,
    alt: message.text
  };
}

/**
 * 关闭聊天图片原图预览。
 * 核心分支：清空预览状态，让遮罩和原图从页面移除。
 */
function closeImagePreview(): void {
  previewImage.value = null;
}

/**
 * 处理图片预览键盘关闭。
 * @param event 键盘事件；核心分支为预览打开且用户按下 Escape 时关闭预览。
 */
function handleImagePreviewKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && previewImage.value) {
    closeImagePreview();
  }
}

/**
 * 发送待发送图片。
 * @param image 图片草稿；核心分支为访客发给管理员，管理员发给当前选中的访客。
 */
function sendPendingImage(image: PendingImage): void {
    if (page.value === 'guest-chat') {
      chatMessages.value.push({
        from: 'guest',
        text: '[图片消息]',
        time: formatMessageTime(),
        imageUrl: image.dataUrl,
        mimeType: image.mimeType
      });
      scrollToLatestReadMessage();

      if (socketRef.value?.readyState === WebSocket.OPEN) {
      socketRef.value.send(
        JSON.stringify({
          type: 'image',
          clientMessageId: `guest-image-${Date.now()}`,
          payload: { mimeType: image.mimeType, dataUrl: image.dataUrl }
        })
      );
    }

    return;
  }

  if (!appendCurrentAdminImage(image.dataUrl, image.mimeType)) {
    return;
  }

  const targetGuestId = selectedGuestId.value;

  if (socketRef.value?.readyState === WebSocket.OPEN && targetGuestId) {
    socketRef.value.send(
      JSON.stringify({
        type: 'image',
        clientMessageId: `admin-image-${Date.now()}`,
        targetConnectionId: targetGuestId,
        payload: { mimeType: image.mimeType, dataUrl: image.dataUrl }
      })
    );
  }
}

/**
 * 打开本地图片选择器。
 * 核心分支：通过隐藏 input 触发系统文件选择窗口。
 */
function openImagePicker(): void {
  imageInputRef.value?.click();
}

/**
 * 处理本地图片选择。
 * @param event 文件输入事件；核心分支追加用户选择的图片，超出 5 张时只保留可追加数量并提示。
 */
function handleImageSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  const remainCount = Math.max(0, maxPendingImages - pendingImages.value.length);

  if (files.length > remainCount) {
    setStatus(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
  }

  files.slice(0, remainCount).forEach((file) => {
    void prepareImageFile(file);
  });

  input.value = '';
}

/**
 * 处理输入框粘贴图片。
 * @param event 粘贴事件；核心分支为剪贴板含图片时阻止默认文本粘贴并追加最多 5 张缩略图。
 */
function handleComposerPaste(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (!files.length) {
    return;
  }

  event.preventDefault();
  const remainCount = Math.max(0, maxPendingImages - pendingImages.value.length);

  if (files.length > remainCount) {
    setStatus(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
  }

  files.slice(0, remainCount).forEach((file) => {
    void prepareImageFile(file);
  });
}

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
 * 发送客服消息。
 * 核心分支：文字和待发送图片都统一由发送按钮提交；没有草稿或没有目标会话时不发送。
 */
function sendMessage(): void {
  const text = messageInput.value.trim();
  const images = [...pendingImages.value];

  if (!canSendMessage.value) {
    return;
  }

  if (text) {
    if (page.value === 'guest-chat') {
      chatMessages.value.push({
        from: 'guest',
        text,
        time: formatMessageTime()
      });
      scrollToLatestReadMessage();

      if (socketRef.value?.readyState === WebSocket.OPEN) {
        socketRef.value.send(
          JSON.stringify({
            type: 'text',
            clientMessageId: `guest-${Date.now()}`,
            payload: { text }
          })
        );
      }
    } else {
      if (!appendCurrentAdminMessage(text)) {
        return;
      }

      const targetGuestId = selectedGuestId.value;

      if (socketRef.value?.readyState === WebSocket.OPEN && targetGuestId) {
        socketRef.value.send(
          JSON.stringify({
            type: 'text',
            clientMessageId: `admin-${Date.now()}`,
            targetConnectionId: targetGuestId,
            payload: { text }
          })
        );
      }
    }
  }

  messageInput.value = '';

  if (images.length) {
    images.forEach((image) => {
      sendPendingImage(image);
    });
    pendingImages.value = [];
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
      type?: 'text' | 'image';
      sentAt?: string;
      from?: RelayRoomUser;
      users?: RelayRoomUser[];
      payload?: { text?: string; mimeType?: string; dataUrl?: string };
      message?: string;
    };

    if (data.event === 'room:users' && data.users) {
      syncRoomUsers(data.users);
      return;
    }

    if (data.event === 'message:error') {
      setStatus(data.message ?? '消息发送失败', 'error');
      return;
    }

    if (data.event !== 'message:new' || !data.from) {
      return;
    }

    const sentAt = data.sentAt ? new Date(data.sentAt) : new Date();
    appendAdminConversationMessage(data.from, {
      from: 'guest',
      text: data.payload?.text ?? '[图片消息]',
      time: formatMessageTime(sentAt),
      imageUrl: data.type === 'image' ? data.payload?.dataUrl : undefined,
      mimeType: data.type === 'image' ? data.payload?.mimeType : undefined
    }, sentAt);
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
      type?: 'text' | 'image';
      sentAt?: string;
      payload?: { text?: string; mimeType?: string; dataUrl?: string };
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
      time: data.sentAt ? new Date(data.sentAt).toLocaleString('zh-CN', { hour12: false }) : new Date().toLocaleString('zh-CN', { hour12: false }),
      imageUrl: data.type === 'image' ? data.payload?.dataUrl : undefined,
      mimeType: data.type === 'image' ? data.payload?.mimeType : undefined
    });
    scrollToLatestReadMessage();
  });
  socket.addEventListener('close', () => {
    connectionStatus.value = '连接已断开';
  });
}

onMounted(async () => {
  window.addEventListener('keydown', handleImagePreviewKeydown);

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

onUnmounted(() => {
  window.removeEventListener('keydown', handleImagePreviewKeydown);
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
            <strong>房间 {{ activeRoomId ? activeRoomId.slice(0, 8) : '未选择' }}</strong>
            <span>{{ connectionStatus }}</span>
          </div>
        </div>
        <div class="side-room-card">
          <span>当前房间</span>
          <div class="room-code-row">
            <strong>{{ activeRoomId ? activeRoomId.slice(0, 8) : '未选择' }}</strong>
            <button v-if="activeRoom" class="copy-room-button" type="button" @click="copyShareUrl(activeRoom)">
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
              :key="user.connectionId"
              class="room-user-card"
              :class="{ active: user.connectionId === activeGuestId, self: user.role === 'admin' }"
              type="button"
              @click="selectRoomUser(user)"
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
          <a class="ghost-button" href="/admin/settings">设置</a>
        </header>
        <div ref="messageTimelineRef" class="message-timeline" aria-live="polite">
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
              <div class="message-bubble" :class="{ image: message.imageUrl }">
                <button v-if="message.imageUrl" class="message-image-button" type="button" @click="openImagePreview(message)">
                  <img class="message-image" :src="message.imageUrl" :alt="message.text" />
                </button>
                <template v-else>{{ message.text }}</template>
              </div>
            </div>
            <span v-if="message.from === 'admin'" class="avatar">我</span>
          </div>
          <div v-if="activeGuestId && !activeConversationMessages.length" class="empty-chat-state">还没有消息，发送一条回复开始沟通。</div>
          <div v-if="!activeGuestId" class="empty-chat-state">请选择左侧访客查看聊天内容。</div>
        </div>
        <footer class="composer">
          <form class="message-form" @submit.prevent="sendMessage">
            <div class="composer-input-wrap">
              <div v-if="pendingImages.length" class="image-preview-list">
                <div v-for="(image, index) in pendingImages" :key="`${image.name}-${index}`" class="image-preview">
                  <img :src="image.dataUrl" :alt="image.name" />
                  <button class="image-preview-remove" type="button" aria-label="删除图片" @click="removePendingImage(index)">×</button>
                </div>
              </div>
              <textarea
                v-model="messageInput"
                rows="3"
                placeholder="请输入消息，按 Enter 键或点击发送按钮发送"
                @keydown.enter.exact.prevent="sendMessage"
                @paste="handleComposerPaste"
              ></textarea>
            </div>
            <input ref="imageInputRef" class="image-input" type="file" accept="image/*" multiple @change="handleImageSelect" />
            <div class="composer-action-stack">
              <button class="composer-upload-button" type="button" aria-label="选择图片" @click="openImagePicker">+</button>
              <button class="primary-button send-button" type="submit" :disabled="!canSendMessage">发送</button>
            </div>
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
      <div ref="messageTimelineRef" class="message-timeline guest-timeline" aria-live="polite">
        <div v-for="(message, index) in chatMessages" :key="`${message.time}-${index}`" class="message-row" :class="message.from">
          <span v-if="message.from === 'admin'" class="avatar">管</span>
          <div class="message-body">
            <span class="message-time">{{ message.time }}</span>
            <div class="message-bubble" :class="{ image: message.imageUrl }">
              <button v-if="message.imageUrl" class="message-image-button" type="button" @click="openImagePreview(message)">
                <img class="message-image" :src="message.imageUrl" :alt="message.text" />
              </button>
              <template v-else>{{ message.text }}</template>
            </div>
          </div>
          <span v-if="message.from === 'guest'" class="avatar">我</span>
        </div>
      </div>
      <footer class="composer">
        <form class="message-form" @submit.prevent="sendMessage">
          <div class="composer-input-wrap">
            <div v-if="pendingImages.length" class="image-preview-list">
              <div v-for="(image, index) in pendingImages" :key="`${image.name}-${index}`" class="image-preview">
                <img :src="image.dataUrl" :alt="image.name" />
                <button class="image-preview-remove" type="button" aria-label="删除图片" @click="removePendingImage(index)">×</button>
              </div>
            </div>
            <textarea
              v-model="messageInput"
              rows="3"
              placeholder="请输入消息，按 Enter 键或点击发送按钮发送"
              @keydown.enter.exact.prevent="sendMessage"
              @paste="handleComposerPaste"
            ></textarea>
          </div>
          <input ref="imageInputRef" class="image-input" type="file" accept="image/*" multiple @change="handleImageSelect" />
          <div class="composer-action-stack">
            <button class="composer-upload-button" type="button" aria-label="选择图片" @click="openImagePicker">+</button>
            <button class="primary-button send-button" type="submit" :disabled="!canSendMessage">发送</button>
          </div>
        </form>
      </footer>
    </section>
  </main>

  <Teleport to="body">
    <div v-if="previewImage" class="image-viewer" role="dialog" aria-modal="true" @click.self="closeImagePreview">
      <button class="image-viewer-close" type="button" aria-label="关闭图片预览" @click="closeImagePreview">×</button>
      <img class="image-viewer-image" :src="previewImage.url" :alt="previewImage.alt" />
    </div>
  </Teleport>
</template>
