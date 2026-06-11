import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(__dirname, '..');

/**
 * 读取 JSON 文件并解析为对象。
 * @param relativePath 相对项目根目录的 JSON 文件路径。
 * @returns JSON 对象；核心分支为文件不存在或格式错误时直接抛错，让测试暴露结构问题。
 */
function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as Record<string, unknown>;
}

test('前端工程必须使用 Vue3 + Vite 并放在 apps/web', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const rootPackage = readJson('package.json');
  const webPackage = readJson('apps/web/package.json');
  const viteConfig = fs.readFileSync(path.join(root, 'apps/web/vite.config.ts'), 'utf8');
  const appVue = fs.readFileSync(path.join(root, 'apps/web/src/App.vue'), 'utf8');
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
  assert.match(appVue, /\/admin\/settings/);
  assert.match(appVue, /\/admin\/rooms/);
  assert.match(appVue, /\/admin\/chat\?roomId=/);
  assert.match(appVue, /\/api\/admin\/profile/);
  assert.match(appVue, /\/api\/rooms\/share\//);
  assert.match(appVue, /guest-chat/);
  assert.match(appVue, /method:\s*'DELETE'/);
  assert.match(appVue, /fallbackCopyText/);
  assert.match(appVue, /execCommand\('copy'\)/);
  assert.match(appVue, /copiedRoomId/);
  assert.match(appVue, /response\.status === 401/);
  assert.match(appVue, /clearSession/);
  assert.match(appVue, /loginForm\s*=\s*reactive\(\{\s*username:\s*''/);
  assert.doesNotMatch(appVue, /loginForm\s*=\s*reactive\(\{\s*username:\s*'admin'/);
  assert.match(appVue, /const chatMessages = ref<ChatMessage\[\]>\(\[\]\)/);
  assert.doesNotMatch(appVue, /要先给他下单么/);
  assert.match(appVue, /room-user-list/);
  assert.match(appVue, /unread-badge/);
  assert.match(appVue, /selectRoomUser/);
  assert.match(appVue, /scrollToFirstUnreadMessage/);
  assert.match(appVue, /copyShareUrl\(activeRoom\)/);
  assert.doesNotMatch(appVue, /我的订单/);
  assert.doesNotMatch(appVue, /咨询商品/);
  assert.doesNotMatch(appVue, /常用回复/);
  assert.match(appVue, /imageInputRef/);
  assert.match(appVue, /composer-upload-button/);
  assert.match(appVue, /accept="image\/\*"/);
  assert.match(appVue, /handleImageSelect/);
  assert.match(appVue, /handleComposerPaste/);
  assert.match(appVue, /readImageFileAsDataUrl/);
  assert.match(appVue, /type:\s*'image'/);
  assert.match(appVue, /message-image/);
  assert.match(appVue, /previewImage/);
  assert.match(appVue, /openImagePreview/);
  assert.match(appVue, /closeImagePreview/);
  assert.match(appVue, /@click="openImagePreview\(message\)"/);
  assert.match(appVue, /class="image-viewer"/);
  assert.match(stylesCss, /\.image-viewer\s*{[^}]*position:\s*fixed/s);
  assert.match(stylesCss, /\.image-viewer-image\s*{[^}]*width:\s*auto[^}]*height:\s*auto/s);
  assert.doesNotMatch(appVue, /guest-room-info/);
  assert.doesNotMatch(appVue, /请在这里发送消息，客服在线时会实时回复。/);
  assert.match(appVue, /ref="messageTimelineRef" class="message-timeline guest-timeline"/);
  assert.match(appVue, /message\.from === 'admin'" class="avatar">管<\/span>/);
  assert.match(appVue, /chatMessages\.value\.push\(\{[\s\S]*mimeType:[\s\S]*\}\);\s*scrollToLatestReadMessage\(\);/);
  assert.match(stylesCss, /\.guest-chat-page\s*{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
  assert.match(stylesCss, /\.guest-chat-shell\s*{[^}]*grid-template-rows:\s*64px minmax\(0,\s*1fr\) 192px/s);
  assert.match(appVue, /maxImageBytes\s*=\s*1024\s*\*\s*1024\s*\*\s*5/);
  assert.match(appVue, /maxPendingImages\s*=\s*5/);
  assert.match(appVue, /pendingImages/);
  assert.match(appVue, /image-preview/);
  assert.match(appVue, /v-for="\(image, index\) in pendingImages"/);
  assert.match(appVue, /multiple/);
  assert.match(appVue, /removePendingImage/);
  assert.match(appVue, /canSendMessage/);
  assert.match(appVue, /selectedGuestId/);
  assert.match(appVue, /composer-action-stack/);
  assert.match(stylesCss, /\.composer\s*{[^}]*display:\s*grid/s);
  assert.match(stylesCss, /\.message-form\s*{[^}]*height:\s*100%/s);
  assert.match(stylesCss, /\.composer-input-wrap\s*{[^}]*height:\s*100%/s);
  assert.match(stylesCss, /\.composer-input-wrap\s*{[^}]*border:/s);
  assert.match(stylesCss, /\.composer-input-wrap textarea\s*{[^}]*border:\s*0/s);
  assert.match(stylesCss, /\.composer-input-wrap:has\(\.image-preview\) textarea/s);
  assert.doesNotMatch(appVue, /:disabled="!activeGuestId"/);
  assert.doesNotMatch(appVue, /:disabled="!guestRoom"/);
  assert.match(appVue, /登录已失效/);
});
