import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { createDraftSendQueue } from '../utils/chatDraftOrder';
import { createChatHistoryStorage } from '../utils/chatHistoryStorage';
import { createFrontendLogger } from '../utils/frontendLogger';
import { assembleImageChunks, createImageChunks, dataUrlToBlob, type ImageChunk } from '../utils/imageChunkTransfer';
import { compressImageFileForChat, readBlobAsDataUrl } from '../utils/imageCompression';
import { createMediaSocket } from '../utils/mediaSocket';
import { getPageTitle } from '../utils/pageTitle';
import { isPageActive, playIncomingMessageSound, shouldPlayIncomingMessageSound } from '../utils/messageSound';
import { createReconnectPolicy } from '../utils/websocketReconnect';
import type {
  AdminInfo,
  ChatMessage,
  LoginResult,
  MessageFrom,
  PageName,
  PendingImage,
  PreviewImage,
  RelayRoomUser,
  RoomInfo,
  RoomResult,
  RoomUser,
  StatusType
} from '../types';

/**
 * 创建 Chat Online 前端运行时状态。
 * @returns 页面组件需要的状态、派生数据和事件处理器；核心分支按登录、房间管理、管理端聊天和访客聊天区分。
 */
export function useChatOnlineApp() {
  const imageLogger = createFrontendLogger('图片发送');
  const storageKeys = {
    token: 'chatOnline.adminToken',
    admin: 'chatOnline.admin',
    soundReminder: 'chatOnline.soundReminderEnabled',
    guestChatHistoryEnabled: 'chatOnline.guestChatHistoryEnabled',
    guestChatHistoryPrefix: 'chatOnline.guestChatHistory'
  };
  const supportedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
  const maxImageBytes = 1024 * 1024 * 5;
  const maxImagePreviewBytes = 1024 * 64;
  const imageChunkSize = 1024 * 32;
  const maxPendingImages = 5;
  const socketHeartbeatMs = 25 * 1000;

  const loginForm = reactive({ username: '', password: '' });
  const setupForm = reactive({ username: '', password: '' });
  const settingsForm = reactive({ username: '', password: '' });
  const roomForm = reactive({ remarkName: '' });
  const status = reactive({ message: '', type: 'plain' as StatusType });
  const showSetup = ref(false);
  const bootstrapToken = ref('');
  const rooms = ref<RoomInfo[]>([]);
  const guestRoom = ref<RoomInfo | null>(null);
  const loadingRooms = ref(false);
  const copiedRoomId = ref('');
  const messageInput = ref('');
  const connectionStatus = ref('等待连接');
  const soundReminderEnabled = ref(localStorage.getItem(storageKeys.soundReminder) !== 'off');
  const chatHistoryEnabled = ref(localStorage.getItem(storageKeys.guestChatHistoryEnabled) === 'on');
  const activeGuestId = ref('');
  const socketRef = ref<WebSocket | null>(null);
  const mediaSocketRef = ref<ReturnType<typeof createMediaSocket> | null>(null);
  const controlConnectionId = ref('');
  const reconnectPolicy = createReconnectPolicy({ maxAttempts: Number.POSITIVE_INFINITY, delayMs: 5000 });
  const reconnectTimerRef = ref<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = ref<number | null>(null);
  const reconnectGeneration = ref(0);
  const shouldReconnectSocket = ref(true);
  const messageTimelineRef = ref<HTMLElement | null>(null);
  const imageInputRef = ref<HTMLInputElement | null>(null);
  const pendingUnreadScrollIndex = ref<number | null>(null);
  const pendingImages = ref<PendingImage[]>([]);
  const previewImage = ref<PreviewImage | null>(null);
  const roomUsers = ref<RoomUser[]>([]);
  const roomConversations = ref<Record<string, ChatMessage[]>>({});
  const chatMessages = ref<ChatMessage[]>([]);
  const toast = reactive({ message: '', type: 'plain' as StatusType });
  const outgoingImageBatches = new Map<
    string,
    { imageId: string; chunks: ImageChunk[]; localDataUrl: string; localMessageId: string }
  >();
  const incomingImageTransfers = new Map<string, { mimeType: string; totalChunks: number; chunks: ImageChunk[] }>();

  /**
   * 接收聊天消息滚动容器 DOM 引用。
   * @param element 组件模板传入的 DOM 节点；核心分支为空时清理引用，非 HTMLElement 时忽略。
   */
  function setMessageTimelineElement(element: Element | ComponentPublicInstance | null): void {
    messageTimelineRef.value = element instanceof HTMLElement ? element : null;
  }

  /**
   * 接收图片选择器 DOM 引用。
   * @param element 组件模板传入的 DOM 节点；核心分支只保存真实 input，其他节点会清空引用。
   */
  function setImageInputElement(element: Element | ComponentPublicInstance | null): void {
    imageInputRef.value = element instanceof HTMLInputElement ? element : null;
  }

  /**
   * 同步当前页面的浏览器标签标题。
   * 核心分支：按 URL 解析出的页面名称设置标题，避免用户端聊天页继续显示管理端标题。
   */
  function syncPageTitle(): void {
    document.title = getPageTitle(page.value);
  }

  /**
   * 清理尚未执行的 WebSocket 重连定时器。
   * 核心分支：存在定时器时取消并清空引用，避免页面卸载或新连接后重复重连。
   */
  function clearReconnectTimer(): void {
    if (reconnectTimerRef.value) {
      clearTimeout(reconnectTimerRef.value);
      reconnectTimerRef.value = null;
    }
  }

  /**
   * 清理尚未执行的 toast 自动关闭定时器。
   * 核心分支：新的 toast 出现或页面卸载时取消旧定时器，避免旧回调清掉新提示。
   */
  function clearToastTimer(): void {
    if (toastTimerRef.value) {
      window.clearTimeout(toastTimerRef.value);
      toastTimerRef.value = null;
    }
  }

  /**
   * 记录即将创建新 WebSocket 连接。
   * 核心分支：递增连接代际并取消旧定时器，让旧 socket 的 close 事件不能覆盖新连接状态。
   */
  function beginSocketConnection(): number {
    clearReconnectTimer();
    reconnectGeneration.value += 1;
    shouldReconnectSocket.value = true;

    return reconnectGeneration.value;
  }

  /**
   * 安排 WebSocket 断线重连。
   * @param generation 当前连接代际；核心分支为仅当前连接的异常断开会触发最多 3 次、每 5 秒一次的重连。
   * @param reconnect 重连回调；核心分支为 timer 触发时再次校验代际，避免旧连接误重连。
   * @param reconnectingText 重连等待状态文案。
   * @param stoppedText 重连耗尽后的状态文案。
   */
  function scheduleSocketReconnect(
    generation: number,
    reconnect: () => void,
    reconnectingText: (attempt: number) => string,
    stoppedText: string
  ): void {
    if (!shouldReconnectSocket.value || generation !== reconnectGeneration.value) {
      return;
    }

    const decision = reconnectPolicy.next();

    if (!decision.shouldReconnect) {
      connectionStatus.value = stoppedText;
      return;
    }

    connectionStatus.value = reconnectingText(decision.attempt);
    reconnectTimerRef.value = setTimeout(() => {
      if (!shouldReconnectSocket.value || generation !== reconnectGeneration.value) {
        return;
      }

      reconnect();
    }, decision.delayMs);
  }

  /**
   * 停止当前 WebSocket 和重连任务。
   * 核心分支：页面卸载时标记为主动关闭，避免 close 事件继续调度重连。
   */
  function stopSocketReconnect(): void {
    shouldReconnectSocket.value = false;
    reconnectGeneration.value += 1;
    clearReconnectTimer();
    mediaSocketRef.value?.close();
    mediaSocketRef.value = null;
    controlConnectionId.value = '';
    socketRef.value?.close();
    socketRef.value = null;
  }

  /**
   * 启动聊天控制通道应用层心跳。
   * @param socket 当前聊天 WebSocket；核心分支为定时发送小 ping 包，避免 Cloudflare Tunnel 回收空闲连接。
   * @returns 停止心跳的函数。
   */
  function startSocketHeartbeat(socket: WebSocket): () => void {
    const sendPing = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    };
    const heartbeatTimer = setInterval(sendPing, socketHeartbeatMs);

    sendPing();

    return () => {
      clearInterval(heartbeatTimer);
    };
  }

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
   * 即时把聊天区滚动到最新消息。
   * @param timeline 聊天滚动容器；核心分支会临时关闭平滑滚动，避免图片撑高时停在旧的 scrollHeight。
   */
  function scrollMessageTimelineToBottom(timeline: HTMLElement): void {
    const previousScrollBehavior = timeline.style.scrollBehavior;
    timeline.style.scrollBehavior = 'auto';
    timeline.scrollTop = timeline.scrollHeight;
    timeline.style.scrollBehavior = previousScrollBehavior;
  }

  /**
   * 安排聊天区滚动到底部。
   * @param extraFrames 额外校正帧数；核心分支用于覆盖图片加载后布局连续变化的场景。
   */
  function scheduleMessageTimelineBottomScroll(extraFrames = 1): void {
    const timeline = messageTimelineRef.value;

    if (!timeline) {
      return;
    }

    scrollMessageTimelineToBottom(timeline);

    if (extraFrames <= 0) {
      return;
    }

    requestAnimationFrame(() => scheduleMessageTimelineBottomScroll(extraFrames - 1));
  }

  /**
   * 把聊天区滚动到最新消息。
   * 核心分支：当前聚焦会话默认已读，因此新消息或主动发送后定位到最新已读位置。
   */
  function scrollToLatestReadMessage(extraFrames = 1): void {
    void nextTick(() => {
      scheduleMessageTimelineBottomScroll(extraFrames);
    });
  }

  /**
   * 处理消息图片或预览图完成加载。
   * 核心分支：图片加载会让消息高度二次增长，需要再次滚动到底，避免发送端和接收端停在图片中间。
   */
  function handleMessageMediaLoaded(): void {
    scrollToLatestReadMessage(3);
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
   * 切换新消息声音提醒开关。
   * 核心分支：开启和关闭都会写入本地存储，让管理员端和访客端刷新后延续用户选择。
   */
  function toggleSoundReminder(): void {
    soundReminderEnabled.value = !soundReminderEnabled.value;
    localStorage.setItem(storageKeys.soundReminder, soundReminderEnabled.value ? 'on' : 'off');
  }

  /**
   * 生成访客聊天记录缓存键。
   * @param roomId 房间 ID；核心分支为不同聊天室隔离记录，避免分享链接之间串消息。
   * @returns 当前访客聊天室对应的 localStorage 键。
   */
  function getGuestChatHistoryKey(roomId: string): string {
    return `${storageKeys.guestChatHistoryPrefix}.${roomId}`;
  }

  /**
   * 创建当前访客聊天室的缓存读写器。
   * @param roomId 房间 ID；核心分支为使用同一个开关键，但按房间保存聊天记录。
   * @returns 访客聊天记录缓存读写器。
   */
  function createGuestChatHistoryStorage(roomId: string) {
    return createChatHistoryStorage({
      storage: localStorage,
      enabledKey: storageKeys.guestChatHistoryEnabled,
      historyKey: getGuestChatHistoryKey(roomId)
    });
  }

  /**
   * 从浏览器缓存恢复访客聊天记录。
   * @param roomId 房间 ID；核心分支为开关开启时才读取，关闭时保持内存消息为空。
   */
  function loadGuestChatHistory(roomId: string): void {
    if (!chatHistoryEnabled.value) {
      return;
    }

    chatMessages.value = createGuestChatHistoryStorage(roomId).read();
    scrollToLatestReadMessage();
  }

  /**
   * 持久化当前访客聊天记录。
   * @param roomId 房间 ID；核心分支为缺少房间或开关关闭时不写入浏览器缓存。
   */
  function persistGuestChatHistory(roomId: string): void {
    if (!roomId) {
      return;
    }

    createGuestChatHistoryStorage(roomId).write(chatMessages.value);
  }

  /**
   * 切换访客聊天记录缓存开关。
   * 核心分支：开启时立即把当前窗口已经存在的聊天记录写入浏览器缓存，满足后开关也补存旧记录。
   */
  function toggleChatHistoryStorage(): void {
    chatHistoryEnabled.value = !chatHistoryEnabled.value;

    const roomId = guestRoom.value?.id;
    localStorage.setItem(storageKeys.guestChatHistoryEnabled, chatHistoryEnabled.value ? 'on' : 'off');

    if (roomId) {
      createGuestChatHistoryStorage(roomId).setEnabled(chatHistoryEnabled.value, chatMessages.value);
    }
  }

  /**
   * 根据页面聚焦和会话匹配状态播放新消息提示音。
   * @param activeConversation 新消息是否属于当前正在查看的会话；核心分支用于管理员区分左侧选中的访客。
   */
  function notifyIncomingMessage(activeConversation: boolean): void {
    if (!shouldPlayIncomingMessageSound({
      soundReminderEnabled: soundReminderEnabled.value,
      pageIsActive: isPageActive(),
      activeConversation
    })) {
      return;
    }

    playIncomingMessageSound();
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
   * 写入当前客服主动发送的图片占位消息。
   * @param image 图片占位消息；核心分支会同步写入当前访客会话和最近消息排序。
   * @returns 写入成功时返回目标访客连接 ID，否则返回空字符串。
   */
  function appendCurrentAdminImage(image: ChatMessage): string {
    const targetGuestId = selectedGuestId.value;

    if (!targetGuestId) {
      setStatus('请先在左侧选择一位访客。', 'error');
      return '';
    }

    const now = new Date();
    const time = image.time || formatMessageTime(now);
    const messages = roomConversations.value[targetGuestId] ?? [];
    roomConversations.value = {
      ...roomConversations.value,
      [targetGuestId]: [...messages, { ...image, time }]
    };
    touchRoomUserMessage(targetGuestId, time, now.getTime());
    scrollToLatestReadMessage();

    return targetGuestId;
  }

  /**
   * 更新指定图片消息的状态。
   * @param imageId 图片传输 ID。
   * @param patch 要合并到消息上的状态字段；核心分支同时扫描访客端消息和管理端各会话。
   */
  function updateImageMessage(imageId: string, patch: Partial<ChatMessage>): void {
    chatMessages.value = chatMessages.value.map((message) => (message.imageId === imageId ? { ...message, ...patch } : message));
    roomConversations.value = Object.fromEntries(
      Object.entries(roomConversations.value).map(([guestId, messages]) => [
        guestId,
        messages.map((message) => (message.imageId === imageId ? { ...message, ...patch } : message))
      ])
    );
  }

  /**
   * 写入远端图片占位消息。
   * @param message 图片消息；核心分支按当前页面角色写入访客时间线或管理端对应访客会话。
   * @param from 发送方连接摘要，管理端用于定位访客会话。
   * @param sentAt 服务端发送时间。
   */
  function appendIncomingImagePlaceholder(message: ChatMessage, from: RelayRoomUser | null, sentAt: Date): void {
    if (page.value === 'guest-chat') {
      chatMessages.value.push(message);
      persistGuestChatHistory(guestRoom.value?.id ?? '');
      scrollToLatestReadMessage();
      return;
    }

    if (from) {
      appendAdminConversationMessage(from, message, sentAt);
    }
  }

  /**
   * 生成控制通道使用的轻量图片预览。
   * @param image 待发送图片；核心分支优先复用小图，大图会降采样到较小画布，避免控制通道发送完整正文。
   * @returns 体积符合后端限制的 preview dataURL。
   */
  async function createImageStartPreviewDataUrl(image: PendingImage): Promise<string> {
    const originalBlob = dataUrlToBlob(image.dataUrl);

    if (originalBlob.size <= maxImagePreviewBytes) {
      return image.dataUrl;
    }

    const bitmap = await createImageBitmap(originalBlob);
    const maxPreviewSide = 160;
    const scale = Math.min(1, maxPreviewSide / bitmap.width, maxPreviewSide / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');

    if (!context) {
      bitmap.close?.();
      throw new Error('图片预览生成失败');
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const previewBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error('图片预览生成失败'));
        },
        image.mimeType,
        0.52
      );
    });
    const previewDataUrl = await readBlobAsDataUrl(previewBlob);

    if (!previewDataUrl.startsWith(`data:${image.mimeType};base64,`)) {
      throw new Error('图片预览格式不支持，请换一张图片');
    }

    if (new Blob([previewDataUrl]).size > maxImagePreviewBytes) {
      throw new Error('图片预览仍然过大，请换一张图片');
    }

    return previewDataUrl;
  }

  /**
   * 校验本地图片文件。
   * @param file 本地文件；核心分支限制图片格式和大小，与后端图片转发校验保持一致。
   * @returns 校验失败文案，校验通过时返回空字符串。
   */
  function getImageFileError(file: File): string {
    const fileName = file.name || '这张图片';

    if (!supportedImageMimeTypes.includes(file.type)) {
      return `${fileName} 格式不支持，仅支持 PNG、JPG、WEBP 图片。`;
    }

    if (file.size > maxImageBytes) {
      return `${fileName} 不能超过 5MB，请换一张更小的图片。`;
    }

    return '';
  }

  /**
   * 格式化图片体积，便于日志排查压缩收益。
   * @param bytes 字节数；核心分支为超过 1MB 时输出 MB，否则输出 KB。
   * @returns 面向日志的体积文本。
   */
  function formatByteSize(bytes: number): string {
    if (bytes <= 0) {
      return '0KB';
    }

    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
    }

    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }

  /**
   * 计算字符串的 UTF-8 字节数。
   * @param value 待发送字符串；核心分支优先使用 Blob 精确计算浏览器发送载荷大小。
   * @returns UTF-8 字节数。
   */
  function getUtf8ByteLength(value: string): number {
    return new Blob([value]).size;
  }

  /**
   * 准备待发送图片。
   * @param file 本地图片文件；核心分支为校验通过后生成输入区缩略图，等待用户点击发送。
   */
  async function prepareImageFile(file: File): Promise<void> {
    if (pendingImages.value.length >= maxPendingImages) {
      showToast(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
      return;
    }

    const error = getImageFileError(file);

    if (error) {
      showToast(error, 'error');
      return;
    }

    try {
      let image: PendingImage;

      try {
        const compressedImage = await compressImageFileForChat(file);

        if (compressedImage.compressedBytes > maxImageBytes) {
          showToast('图片压缩后仍超过 5MB，请换一张更小的图片。', 'error');
          imageLogger.warn(
            `图片压缩后仍超过限制：${file.name || '未命名'} ${formatByteSize(file.size)} -> ${formatByteSize(compressedImage.compressedBytes)}`
          );
          return;
        }

        image = {
          dataUrl: compressedImage.dataUrl,
          mimeType: compressedImage.mimeType,
          name: file.name || '待发送图片',
          originalBytes: compressedImage.originalBytes,
          compressedBytes: compressedImage.compressedBytes,
          width: compressedImage.width,
          height: compressedImage.height,
          compressionDurationMs: compressedImage.durationMs
        };
        imageLogger.info(
          `图片压缩完成：${image.name} ${formatByteSize(compressedImage.originalBytes)} -> ${formatByteSize(compressedImage.compressedBytes)} ` +
            `${compressedImage.width}x${compressedImage.height} ${compressedImage.durationMs}ms`
        );
      } catch (compressionError) {
        imageLogger.warn(`图片压缩失败，回退原图发送：${file.name || '未命名'} ${(compressionError as Error).message}`);
        image = {
          dataUrl: await readBlobAsDataUrl(file),
          mimeType: file.type,
          name: file.name || '待发送图片',
          originalBytes: file.size,
          compressedBytes: file.size
        };
      }

      if (pendingImages.value.length >= maxPendingImages) {
        showToast(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
        return;
      }

      pendingImages.value = [...pendingImages.value, image];
    } catch (readError) {
      showToast((readError as Error).message, 'error');
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
   * @param image 图片草稿；核心分支为先走控制通道发送 image:start，服务端 ack 后再通过媒体通道发送分片。
   */
  function sendPendingImage(image: PendingImage): void {
    void sendPendingImageChunks(image);
  }

  /**
   * 准备并发送图片分片。
   * @param image 图片草稿；核心分支会避免完整 dataURL 进入控制通道。
   */
  async function sendPendingImageChunks(image: PendingImage): Promise<void> {
    if (socketRef.value?.readyState !== WebSocket.OPEN || !mediaSocketRef.value) {
      setStatus('实时服务尚未连接，图片发送失败。', 'error');
      return;
    }

    try {
      const imageBlob = dataUrlToBlob(image.dataUrl);
      const preparedChunks = await createImageChunks(imageBlob, imageChunkSize);
      let previewDataUrl = '';

      try {
        previewDataUrl = await createImageStartPreviewDataUrl(image);
      } catch (previewError) {
        imageLogger.warn(`图片预览生成失败，改用空占位继续发送：${image.name} ${(previewError as Error).message}`);
      }
      const clientMessageId = `${page.value === 'guest-chat' ? 'guest' : 'admin'}-image-${Date.now()}-${preparedChunks.imageId}`;
      const placeholder: ChatMessage = {
        from: page.value === 'guest-chat' ? 'guest' : 'admin',
        text: '[图片消息]',
        time: formatMessageTime(),
        mimeType: preparedChunks.mimeType,
        imageId: preparedChunks.imageId,
        imageStatus: 'loading',
        imageProgress: 0,
        previewUrl: image.dataUrl
      };
      let targetGuestId = '';

      if (page.value === 'guest-chat') {
        chatMessages.value.push(placeholder);
        persistGuestChatHistory(guestRoom.value?.id ?? '');
        scrollToLatestReadMessage();
      } else {
        targetGuestId = appendCurrentAdminImage(placeholder);

        if (!targetGuestId) {
          return;
        }
      }

      outgoingImageBatches.set(clientMessageId, {
        imageId: preparedChunks.imageId,
        chunks: preparedChunks.chunks,
        localDataUrl: image.dataUrl,
        localMessageId: clientMessageId
      });

      const payload = JSON.stringify({
        type: 'image:start',
        clientMessageId,
        ...(targetGuestId ? { targetConnectionId: targetGuestId } : {}),
        payload: {
          imageId: preparedChunks.imageId,
          mimeType: preparedChunks.mimeType,
          size: preparedChunks.size,
          chunkSize: preparedChunks.chunkSize,
          totalChunks: preparedChunks.totalChunks,
          ...(previewDataUrl ? { previewDataUrl } : {})
        }
      });
      imageLogger.info(
        `图片开始发送：${image.name} 控制载荷 ${formatByteSize(getUtf8ByteLength(payload))} 分片 ${preparedChunks.totalChunks} ` +
          `原始 ${formatByteSize(image.originalBytes ?? 0)} 压缩 ${formatByteSize(image.compressedBytes ?? imageBlob.size)}`
      );
      socketRef.value.send(payload);
    } catch (error) {
      setStatus((error as Error).message, 'error');
      imageLogger.warn(`图片发送准备失败：${image.name} ${(error as Error).message}`);
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
      showToast(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
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
      showToast(`每次最多发送 ${maxPendingImages} 张图片。`, 'error');
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
   * 展示一次性 toast 提示。
   * @param message 提示文案；核心分支为空时立即清空当前 toast。
   * @param type 提示类型；错误提示会使用醒目的 toast 样式。
   */
  function showToast(message: string, type: StatusType = 'plain'): void {
    clearToastTimer();
    toast.message = message;
    toast.type = type;

    if (!message) {
      return;
    }

    toastTimerRef.value = window.setTimeout(() => {
      toast.message = '';
      toast.type = 'plain';
      toastTimerRef.value = null;
    }, 2600);
  }

  /**
   * 读取管理员登录 token。
   * @returns token 字符串；核心分支为未登录时返回空字符串，调用方据此跳转登录页。
   */
  function getToken(): string {
    return localStorage.getItem(storageKeys.token) ?? '';
  }

  /**
   * 创建媒体通道地址。
   * @param roomId 房间 ID。
   * @param role 当前连接角色；核心分支为管理员携带 token，访客不携带 token。
   * @param connectionId 控制通道连接 ID，用于服务端校验媒体连接归属。
   * @returns 媒体 WebSocket 地址。
   */
  function buildMediaSocketUrl(roomId: string, role: MessageFrom, connectionId: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ role, roomId, connectionId });

    if (role === 'admin') {
      params.set('token', getToken());
    }

    return `${protocol}//${window.location.host}/ws/media?${params.toString()}`;
  }

  /**
   * 连接图片媒体 WebSocket。
   * @param roomId 房间 ID。
   * @param role 当前连接角色。
   * @param connectionId 控制通道连接 ID；核心分支让媒体通道和控制通道绑定同一连接身份。
   */
  function connectMediaSocket(roomId: string, role: MessageFrom, connectionId: string): void {
    mediaSocketRef.value?.close();
    mediaSocketRef.value = createMediaSocket(buildMediaSocketUrl(roomId, role, connectionId), {
      onChunk: (message) => {
        void handleMediaChunk(message);
      },
      onError: (message) => {
        if (message.imageId) {
          updateImageMessage(message.imageId, { imageStatus: 'failed' });
        }

        imageLogger.warn(`媒体通道错误：${message.message ?? '未知错误'}`);
      }
    });
  }

  /**
   * 登记即将接收的远端图片分片。
   * @param imageId 图片传输 ID。
   * @param mimeType 图片 MIME 类型。
   * @param totalChunks 总分片数；核心分支为后续分片合成保存轻量元数据。
   */
  function registerIncomingImageTransfer(imageId: string, mimeType: string, totalChunks: number): void {
    incomingImageTransfers.set(imageId, { mimeType, totalChunks, chunks: [] });
  }

  /**
   * 处理媒体通道收到的图片分片。
   * @param message 图片分片消息；核心分支为去重、更新进度，并在收齐后合成 blob URL。
   */
  async function handleMediaChunk(message: { imageId: string; chunkIndex: number; totalChunks: number; data: string }): Promise<void> {
    const transfer = incomingImageTransfers.get(message.imageId);

    if (!transfer) {
      return;
    }

    if (!transfer.chunks.some((chunk) => chunk.chunkIndex === message.chunkIndex)) {
      transfer.chunks.push({ chunkIndex: message.chunkIndex, totalChunks: message.totalChunks, data: message.data });
    }

    const progress = Math.min(99, Math.round((transfer.chunks.length / transfer.totalChunks) * 100));
    updateImageMessage(message.imageId, { imageProgress: progress });

    if (transfer.chunks.length !== transfer.totalChunks) {
      return;
    }

    const blob = await assembleImageChunks(transfer.chunks, transfer.mimeType);
    incomingImageTransfers.delete(message.imageId);
    updateImageMessage(message.imageId, {
      imageUrl: URL.createObjectURL(blob),
      imageStatus: 'ready',
      imageProgress: 100
    });
  }

  /**
   * 在服务端确认 image:start 后发送对应图片分片。
   * @param clientMessageId 客户端消息 ID；核心分支保证媒体分片晚于控制通道传输会话创建。
   */
  function flushPendingImageChunks(clientMessageId: string): void {
    const batch = outgoingImageBatches.get(clientMessageId);

    if (!batch) {
      return;
    }

    batch.chunks.forEach((chunk, index) => {
      mediaSocketRef.value?.sendChunk(batch.imageId, chunk);
      updateImageMessage(batch.imageId, {
        imageProgress: Math.round(((index + 1) / batch.chunks.length) * 100)
      });
    });
    updateImageMessage(batch.imageId, {
      imageUrl: batch.localDataUrl,
      imageStatus: 'ready',
      imageProgress: 100
    });
    outgoingImageBatches.delete(clientMessageId);
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
      setStatus('');
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
        headers: authHeaders(),
        body: JSON.stringify({
          remarkName: roomForm.remarkName
        })
      });
      rooms.value = [{ ...result.room, shareUrl: result.shareUrl }, ...rooms.value];
      roomForm.remarkName = '';
      setStatus('聊天室创建成功。', 'success');
    } catch (error) {
      setStatus((error as Error).message, 'error');
    }
  }

  /**
   * 删除聊天室。
   * @param roomId 房间 ID。
   * 核心分支：用户确认后调用删除接口，后端会真实删除数据，前端从列表移除对应房间。
   */
  async function deleteRoom(roomId: string): Promise<void> {
    if (!window.confirm('确认删除这个聊天室吗？删除后数据会直接移除。')) {
      return;
    }

    try {
      await requestJson<{ room: RoomInfo }>(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      rooms.value = rooms.value.filter((room) => room.id !== roomId);
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
   * 核心分支：文字和待发送图片都统一由发送按钮提交；文字走控制通道，图片走控制通道加媒体分片通道。
   */
  function sendMessage(): void {
    const queue = createDraftSendQueue(messageInput.value, [...pendingImages.value]);

    if (!canSendMessage.value) {
      return;
    }

    queue.forEach((task) => {
      if (task.type === 'image') {
        sendPendingImage(task.image);
        return;
      }

      if (page.value === 'guest-chat') {
        chatMessages.value.push({
          from: 'guest',
          text: task.text,
          time: formatMessageTime()
        });
        persistGuestChatHistory(guestRoom.value?.id ?? '');
        scrollToLatestReadMessage();

        if (socketRef.value?.readyState === WebSocket.OPEN) {
          socketRef.value.send(
            JSON.stringify({
              type: 'text',
              clientMessageId: `guest-${Date.now()}`,
              payload: { text: task.text }
            })
          );
        }

        return;
      }

      if (!appendCurrentAdminMessage(task.text)) {
        return;
      }

      const targetGuestId = selectedGuestId.value;

      if (socketRef.value?.readyState === WebSocket.OPEN && targetGuestId) {
        socketRef.value.send(
          JSON.stringify({
            type: 'text',
            clientMessageId: `admin-${Date.now()}`,
            targetConnectionId: targetGuestId,
            payload: { text: task.text }
          })
        );
      }
    });

    messageInput.value = '';
    pendingImages.value = [];
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

    const generation = beginSocketConnection();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/chat?role=admin&roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`
    );
    socketRef.value = socket;
    connectionStatus.value = '正在连接实时服务';
    let stopHeartbeat: (() => void) | null = null;

    socket.addEventListener('open', () => {
      reconnectPolicy.reset();
      connectionStatus.value = '实时服务已连接';
      stopHeartbeat?.();
      stopHeartbeat = startSocketHeartbeat(socket);
    });
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data) as {
        event: string;
        type?: 'text' | 'image' | 'image:start';
        sentAt?: string;
        from?: RelayRoomUser;
        connection?: RelayRoomUser;
        users?: RelayRoomUser[];
        payload?: {
          text?: string;
          mimeType?: string;
          dataUrl?: string;
          imageId?: string;
          previewDataUrl?: string;
          totalChunks?: number;
        };
        message?: string;
        clientMessageId?: string;
      };

      if (data.event === 'pong') {
        return;
      }

      if (data.event === 'connection:ready' && data.connection) {
        controlConnectionId.value = data.connection.connectionId;
        connectMediaSocket(roomId, 'admin', data.connection.connectionId);
        return;
      }

      if (data.event === 'room:users' && data.users) {
        syncRoomUsers(data.users);
        return;
      }

      if (data.event === 'message:error') {
        setStatus(data.message ?? '消息发送失败', 'error');
        return;
      }

      if (data.event === 'message:ack') {
        imageLogger.info(`服务端已确认消息：${data.clientMessageId ?? '未提供客户端消息 ID'}`);
        if (data.clientMessageId) {
          flushPendingImageChunks(data.clientMessageId);
        }
        return;
      }

      if (data.event !== 'message:new' || !data.from) {
        return;
      }

      const sentAt = data.sentAt ? new Date(data.sentAt) : new Date();
      if (data.type === 'image') {
        imageLogger.info(
          `客服端收到访客图片：${data.payload?.mimeType ?? '未知类型'} ${formatByteSize(getUtf8ByteLength(data.payload?.dataUrl ?? ''))}`
        );
      }
      notifyIncomingMessage(activeGuestId.value === data.from.connectionId);
      if (data.type === 'image:start' && data.payload?.imageId && data.payload.mimeType && data.payload.totalChunks) {
        registerIncomingImageTransfer(data.payload.imageId, data.payload.mimeType, data.payload.totalChunks);
        appendIncomingImagePlaceholder(
          {
            from: 'guest',
            text: '[图片消息]',
            time: formatMessageTime(sentAt),
            mimeType: data.payload.mimeType,
            imageId: data.payload.imageId,
            imageStatus: 'loading',
            imageProgress: 0,
            previewUrl: data.payload.previewDataUrl
          },
          data.from,
          sentAt
        );
        return;
      }
      appendAdminConversationMessage(data.from, {
        from: 'guest',
        text: data.payload?.text ?? '[图片消息]',
        time: formatMessageTime(sentAt),
        imageUrl: data.type === 'image' ? data.payload?.dataUrl : undefined,
        mimeType: data.type === 'image' ? data.payload?.mimeType : undefined
      }, sentAt);
    });
    socket.addEventListener('close', () => {
      stopHeartbeat?.();
      mediaSocketRef.value?.close();
      mediaSocketRef.value = null;
      scheduleSocketReconnect(
        generation,
        () => connectChatSocket(roomId),
        (attempt) => `实时服务已断开，5 秒后第 ${attempt} 次重连`,
        '实时服务已断开，等待下次重连'
      );
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

    const generation = beginSocketConnection();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/chat?role=guest&roomId=${encodeURIComponent(roomId)}`);
    socketRef.value = socket;
    connectionStatus.value = '正在连接客服';
    let stopHeartbeat: (() => void) | null = null;

    socket.addEventListener('open', () => {
      reconnectPolicy.reset();
      connectionStatus.value = '已进入聊天室';
      stopHeartbeat?.();
      stopHeartbeat = startSocketHeartbeat(socket);
    });
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data) as {
        event: string;
        type?: 'text' | 'image' | 'image:start';
        sentAt?: string;
        connection?: RelayRoomUser;
        payload?: {
          text?: string;
          mimeType?: string;
          dataUrl?: string;
          imageId?: string;
          previewDataUrl?: string;
          totalChunks?: number;
        };
        message?: string;
        clientMessageId?: string;
      };

      if (data.event === 'pong') {
        return;
      }

      if (data.event === 'connection:ready' && data.connection) {
        controlConnectionId.value = data.connection.connectionId;
        connectMediaSocket(roomId, 'guest', data.connection.connectionId);
        return;
      }

      if (data.event === 'message:error') {
        setStatus(data.message ?? '消息发送失败', 'error');
        return;
      }

      if (data.event === 'message:ack') {
        imageLogger.info(`服务端已确认消息：${data.clientMessageId ?? '未提供客户端消息 ID'}`);
        if (data.clientMessageId) {
          flushPendingImageChunks(data.clientMessageId);
        }
        return;
      }

      if (data.event !== 'message:new') {
        return;
      }

      if (data.type === 'image') {
        imageLogger.info(
          `访客端收到客服图片：${data.payload?.mimeType ?? '未知类型'} ${formatByteSize(getUtf8ByteLength(data.payload?.dataUrl ?? ''))}`
        );
      }
      if (data.type === 'image:start' && data.payload?.imageId && data.payload.mimeType && data.payload.totalChunks) {
        const sentAt = data.sentAt ? new Date(data.sentAt) : new Date();
        registerIncomingImageTransfer(data.payload.imageId, data.payload.mimeType, data.payload.totalChunks);
        appendIncomingImagePlaceholder(
          {
            from: 'admin',
            text: '[图片消息]',
            time: formatMessageTime(sentAt),
            mimeType: data.payload.mimeType,
            imageId: data.payload.imageId,
            imageStatus: 'loading',
            imageProgress: 0,
            previewUrl: data.payload.previewDataUrl
          },
          null,
          sentAt
        );
        persistGuestChatHistory(guestRoom.value?.id ?? roomId);
        notifyIncomingMessage(true);
        return;
      }
      chatMessages.value.push({
        from: 'admin',
        text: data.payload?.text ?? '[图片消息]',
        time: data.sentAt ? new Date(data.sentAt).toLocaleString('zh-CN', { hour12: false }) : new Date().toLocaleString('zh-CN', { hour12: false }),
        imageUrl: data.type === 'image' ? data.payload?.dataUrl : undefined,
        mimeType: data.type === 'image' ? data.payload?.mimeType : undefined
      });
      persistGuestChatHistory(guestRoom.value?.id ?? roomId);
      notifyIncomingMessage(true);
      scrollToLatestReadMessage();
    });
    socket.addEventListener('close', () => {
      stopHeartbeat?.();
      mediaSocketRef.value?.close();
      mediaSocketRef.value = null;
      scheduleSocketReconnect(
        generation,
        () => connectGuestChatSocket(roomId),
        (attempt) => `连接已断开，5 秒后第 ${attempt} 次重连`,
        '连接已断开，等待下次重连'
      );
    });
  }

  onMounted(async () => {
    window.addEventListener('keydown', handleImagePreviewKeydown);
    syncPageTitle();

    if (page.value === 'login' && new URLSearchParams(window.location.search).get('reason') === 'expired') {
      setStatus('登录已失效，请重新登录。', 'error');
      return;
    }

    if (page.value === 'guest-chat') {
      await loadGuestRoom();

      if (guestRoom.value) {
        loadGuestChatHistory(guestRoom.value.id);
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
    clearToastTimer();
    stopSocketReconnect();
  });

  return {
    loginForm,
    setupForm,
    settingsForm,
    roomForm,
    status,
    toast,
    showSetup,
    rooms,
    guestRoom,
    loadingRooms,
    copiedRoomId,
    messageInput,
    connectionStatus,
    soundReminderEnabled,
    chatHistoryEnabled,
    activeGuestId,
    pendingImages,
    previewImage,
    page,
    admin,
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
    toggleSoundReminder,
    toggleChatHistoryStorage,
    selectRoomUser,
    submitLogin,
    submitSetup,
    submitSettings,
    logout,
    createRoom,
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
  };
}
