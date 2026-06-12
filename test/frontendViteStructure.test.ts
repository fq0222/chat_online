import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(__dirname, '..');
const webSrcRoot = path.join(root, 'apps/web/src');

/**
 * 读取 JSON 文件并解析为对象。
 * @param relativePath 相对项目根目录的 JSON 文件路径。
 * @returns JSON 对象；核心分支为文件不存在或格式错误时直接抛错，让测试暴露结构问题。
 */
function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as Record<string, unknown>;
}

/**
 * 读取前端源码文件内容。
 * @param relativePath 相对 apps/web/src 的文件路径；核心分支为文件缺失时直接抛错，暴露组件拆分遗漏。
 * @returns UTF-8 源码文本。
 */
function readWebSource(relativePath: string): string {
  return fs.readFileSync(path.join(webSrcRoot, relativePath), 'utf8');
}

/**
 * 汇总前端源码文件内容。
 * @param relativePaths 相对 apps/web/src 的文件路径列表；核心分支为逐个读取并拼接，避免断言继续耦合到 App.vue 单文件。
 * @returns 合并后的 UTF-8 源码文本。
 */
function readWebSourceBundle(relativePaths: string[]): string {
  return relativePaths.map((relativePath) => readWebSource(relativePath)).join('\n');
}

test('前端页面必须从 App.vue 拆分为独立页面组件', () => {
  const appVue = readWebSource('App.vue');
  const pageComponents = [
    'pages/AdminLoginPage.vue',
    'pages/RoomManagerPage.vue',
    'pages/AdminChatWindowPage.vue',
    'pages/GuestChatWindowPage.vue'
  ];

  pageComponents.forEach((componentPath) => {
    assert.equal(fs.existsSync(path.join(webSrcRoot, componentPath)), true);
  });

  assert.match(appVue, /import AdminLoginPage from '\.\/pages\/AdminLoginPage\.vue'/);
  assert.match(appVue, /import RoomManagerPage from '\.\/pages\/RoomManagerPage\.vue'/);
  assert.match(appVue, /import AdminChatWindowPage from '\.\/pages\/AdminChatWindowPage\.vue'/);
  assert.match(appVue, /import GuestChatWindowPage from '\.\/pages\/GuestChatWindowPage\.vue'/);
  assert.match(appVue, /<AdminLoginPage/);
  assert.match(appVue, /<RoomManagerPage/);
  assert.match(appVue, /<AdminChatWindowPage/);
  assert.match(appVue, /<GuestChatWindowPage/);
  assert.ok(appVue.split('\n').length < 700);
});

test('前端工程必须使用 Vue3 + Vite 并放在 apps/web', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const rootPackage = readJson('package.json');
  const webPackage = readJson('apps/web/package.json');
  const viteConfig = fs.readFileSync(path.join(root, 'apps/web/vite.config.ts'), 'utf8');
  const appVue = fs.readFileSync(path.join(root, 'apps/web/src/App.vue'), 'utf8');
  const frontEndSource = readWebSourceBundle([
    'App.vue',
    'composables/useChatOnlineApp.ts',
    'pages/AdminLoginPage.vue',
    'pages/RoomManagerPage.vue',
    'pages/AdminChatWindowPage.vue',
    'pages/GuestChatWindowPage.vue',
    'utils/mediaSocket.ts',
    'utils/imageChunkTransfer.ts',
    'types.ts'
  ]);
  const stylesCss = fs.readFileSync(path.join(root, 'apps/web/src/styles.css'), 'utf8');

  assert.match(agents, /前端.*Vue3 \+ Vite/);
  assert.equal((rootPackage.scripts as Record<string, string>)['web:dev'], 'npm --prefix apps/web run dev');
  assert.equal((rootPackage.scripts as Record<string, string>)['web:build'], 'npm --prefix apps/web run build');
  assert.equal((webPackage.dependencies as Record<string, string>).vue.startsWith('^3.'), true);
  assert.equal((webPackage.devDependencies as Record<string, string>).vite.startsWith('^5.'), true);
  assert.equal(fs.existsSync(path.join(root, 'apps/web/vite.config.ts')), true);
  assert.equal(fs.existsSync(path.join(root, 'apps/web/src/App.vue')), true);
  assert.match(viteConfig, /proxy:\s*{/);
  assert.match(viteConfig, /['"]\/api['"]/);
  assert.match(viteConfig, /['"]\/ws\/chat['"]/);
  assert.match(viteConfig, /['"]\/ws\/media['"]/);
  assert.match(frontEndSource, /\/admin\/settings/);
  assert.match(frontEndSource, /\/admin\/rooms/);
  assert.match(frontEndSource, /\/admin\/chat\?roomId=/);
  assert.match(frontEndSource, /class="room-name"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/);
  assert.match(frontEndSource, /\/api\/admin\/profile/);
  assert.match(frontEndSource, /\/api\/rooms\/share\//);
  assert.match(frontEndSource, /guest-chat/);
  assert.match(frontEndSource, /method:\s*'DELETE'/);
  assert.match(frontEndSource, /fallbackCopyText/);
  assert.match(frontEndSource, /execCommand\('copy'\)/);
  assert.match(frontEndSource, /copiedRoomId/);
  assert.match(frontEndSource, /response\.status === 401/);
  assert.match(frontEndSource, /clearSession/);
  assert.match(frontEndSource, /loginForm\s*=\s*reactive\(\{\s*username:\s*''/);
  assert.doesNotMatch(frontEndSource, /loginForm\s*=\s*reactive\(\{\s*username:\s*'admin'/);
  assert.match(frontEndSource, /const chatMessages = ref<ChatMessage\[\]>\(\[\]\)/);
  assert.doesNotMatch(frontEndSource, /要先给他下单么/);
  assert.match(frontEndSource, /room-user-list/);
  assert.match(frontEndSource, /unread-badge/);
  assert.match(frontEndSource, /selectRoomUser/);
  assert.match(frontEndSource, /scrollToFirstUnreadMessage/);
  assert.match(frontEndSource, /copy-share-url/);
  assert.doesNotMatch(frontEndSource, /我的订单/);
  assert.doesNotMatch(frontEndSource, /咨询商品/);
  assert.doesNotMatch(frontEndSource, /常用回复/);
  assert.match(frontEndSource, /imageInputRef/);
  assert.match(frontEndSource, /composer-upload-button/);
  assert.match(frontEndSource, /accept="image\/\*"/);
  assert.match(frontEndSource, /handleImageSelect/);
  assert.match(frontEndSource, /handleComposerPaste/);
  assert.match(frontEndSource, /compressImageFileForChat/);
  assert.match(frontEndSource, /createFrontendLogger/);
  assert.match(frontEndSource, /图片压缩完成/);
  assert.match(frontEndSource, /createMediaSocket/);
  assert.match(frontEndSource, /imageStatus/);
  assert.match(frontEndSource, /imageProgress/);
  assert.match(frontEndSource, /image:start/);
  assert.match(frontEndSource, /image:chunk/);
  assert.doesNotMatch(frontEndSource, /type:\s*'image'[\s\S]*dataUrl:\s*image\.dataUrl/);
  assert.match(frontEndSource, /imageStatus === 'loading'/);
  assert.match(frontEndSource, /image-progress/);
  assert.match(frontEndSource, /message-image/);
  assert.match(frontEndSource, /previewImage/);
  assert.match(frontEndSource, /openImagePreview/);
  assert.match(frontEndSource, /closeImagePreview/);
  assert.match(frontEndSource, /open-image-preview/);
  assert.match(frontEndSource, /class="image-viewer"/);
  assert.match(stylesCss, /\.image-viewer\s*{[^}]*position:\s*fixed/s);
  assert.match(stylesCss, /\.image-viewer-image\s*{[^}]*width:\s*auto[^}]*height:\s*auto/s);
  assert.match(stylesCss, /\.image-progress/);
  assert.match(stylesCss, /\.message-image-placeholder/);
  assert.doesNotMatch(frontEndSource, /guest-room-info/);
  assert.doesNotMatch(frontEndSource, /请在这里发送消息，客服在线时会实时回复。/);
  assert.match(frontEndSource, /:ref="setMessageTimelineElement" class="message-timeline guest-timeline"/);
  assert.match(frontEndSource, /message\.from === 'admin'" class="avatar">管<\/span>/);
  assert.match(frontEndSource, /请勿刷新网页，刷新后聊天记录会被清空，服务器不保存。/);
  assert.match(frontEndSource, /class="guest-refresh-warning"/);
  assert.match(frontEndSource, /appendIncomingImagePlaceholder/);
  assert.match(frontEndSource, /previewUrl/);
  assert.match(frontEndSource, /persistGuestChatHistory\(guestRoom\.value\?\.id \?\? ''\)/);
  assert.match(stylesCss, /\.guest-chat-page\s*{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
  assert.match(stylesCss, /\.guest-chat-shell\s*{[^}]*grid-template-rows:\s*64px minmax\(0,\s*1fr\) 192px/s);
  assert.match(stylesCss, /\.guest-refresh-warning\s*{[^}]*color:\s*#dc2626/s);
  assert.match(frontEndSource, /maxImageBytes\s*=\s*1024\s*\*\s*1024\s*\*\s*5/);
  assert.match(frontEndSource, /maxPendingImages\s*=\s*5/);
  assert.match(frontEndSource, /pendingImages/);
  assert.match(frontEndSource, /image-preview/);
  assert.match(frontEndSource, /v-for="\(image, index\) in pendingImages"/);
  assert.match(frontEndSource, /multiple/);
  assert.match(frontEndSource, /removePendingImage/);
  assert.match(frontEndSource, /canSendMessage/);
  assert.match(frontEndSource, /selectedGuestId/);
  assert.match(frontEndSource, /soundReminderEnabled/);
  assert.match(frontEndSource, /toggleSoundReminder/);
  assert.match(frontEndSource, /shouldPlayIncomingMessageSound/);
  assert.match(frontEndSource, /playIncomingMessageSound/);
  assert.match(frontEndSource, /type="checkbox"[\s\S]*声音提醒/);
  assert.match(frontEndSource, /chatHistoryEnabled/);
  assert.match(frontEndSource, /toggleChatHistoryStorage/);
  assert.match(frontEndSource, /createChatHistoryStorage/);
  assert.match(frontEndSource, /guestChatHistoryEnabled/);
  assert.match(frontEndSource, /persistGuestChatHistory\(guestRoom\.value\?\.id \?\? ''\)/);
  assert.match(frontEndSource, /toggle-chat-history-storage/);
  assert.match(frontEndSource, /type="checkbox"[\s\S]*保存记录/);
  assert.match(stylesCss, /\.chat-history-toggle\s*{/);
  assert.match(frontEndSource, /composer-action-stack/);
  assert.match(stylesCss, /\.composer\s*{[^}]*display:\s*grid/s);
  assert.match(stylesCss, /\.message-form\s*{[^}]*height:\s*100%/s);
  assert.match(stylesCss, /\.composer-input-wrap\s*{[^}]*height:\s*100%/s);
  assert.match(stylesCss, /\.composer-input-wrap\s*{[^}]*border:/s);
  assert.match(stylesCss, /\.composer-input-wrap textarea\s*{[^}]*border:\s*0/s);
  assert.match(stylesCss, /\.composer-input-wrap:has\(\.image-preview\) textarea/s);
  assert.match(stylesCss, /\.message-bubble\s*{[^}]*white-space:\s*pre-wrap/s);
  assert.match(stylesCss, /\.chat-workspace\s*{[^}]*grid-template-columns:\s*300px 1fr/s);
  assert.match(stylesCss, /\.guest-chat-shell\s*{[^}]*min-width:\s*760px/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.chat-workspace\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.room-user-list\s*{[\s\S]*display:\s*flex/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.guest-chat-shell\s*{[\s\S]*width:\s*100vw[\s\S]*height:\s*100dvh[\s\S]*min-width:\s*0/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*#app\s*{[\s\S]*overscroll-behavior-y:\s*none/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.message-timeline\s*{[\s\S]*overscroll-behavior:\s*contain/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.guest-chat-page\s*{[\s\S]*touch-action:\s*pan-y/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.message-timeline\s*{[\s\S]*touch-action:\s*pan-y/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.image-viewer\s*{[\s\S]*touch-action:\s*pinch-zoom/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.guest-header\s*{[\s\S]*grid-template-areas:[\s\S]*"brand actions"[\s\S]*"warning warning"[\s\S]*min-height:\s*0/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.guest-header \.sound-reminder-toggle > span,\s*\.guest-header \.chat-history-toggle > span\s*{[\s\S]*display:\s*inline/s);
  assert.match(stylesCss, /@media \(max-width:\s*767px\)\s*{[\s\S]*\.composer-input-wrap textarea\s*{[\s\S]*font-size:\s*16px/s);
  assert.doesNotMatch(frontEndSource, /:disabled="!activeGuestId"/);
  assert.doesNotMatch(frontEndSource, /:disabled="!guestRoom"/);
  assert.match(frontEndSource, /登录已失效/);
});

test('后端必须挂载独立图片媒体 WebSocket 通道', () => {
  const mediaServer = fs.readFileSync(path.join(root, 'src/ws/mediaServer.ts'), 'utf8');
  const chatServer = fs.readFileSync(path.join(root, 'src/ws/chatServer.ts'), 'utf8');
  const serverTs = fs.readFileSync(path.join(root, 'src/server.ts'), 'utf8');

  assert.match(mediaServer, /url\.pathname !== '\/ws\/media'/);
  assert.match(mediaServer, /chatMediaRelayService/);
  assert.match(mediaServer, /connectionId/);
  assert.match(chatServer, /connection:ready/);
  assert.match(serverTs, /attachMediaServer/);
  assert.match(serverTs, /new ChatMediaRelayService/);
});
