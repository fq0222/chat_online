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
  assert.match(appVue, /登录已失效/);
});
