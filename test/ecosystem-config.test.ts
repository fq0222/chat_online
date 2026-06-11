import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(__dirname, '..');

/**
 * PM2 生产配置契约测试。
 * 职责：约束 ecosystem.config.js 只描述安全启动参数；关键参数为应用名称、编译产物入口和环境变量；核心分支避免写入数据库/JWT 等真实敏感信息。
 */
test('PM2 配置使用编译产物并避免写入敏感信息', () => {
  const config = require(path.join(root, 'ecosystem.config.js')) as {
    apps: Array<Record<string, unknown>>;
  };
  const app = config.apps[0];

  assert.equal(Array.isArray(config.apps), true);
  assert.equal(config.apps.length, 1);
  assert.equal(app.name, 'chat-online');
  assert.equal(app.cwd, root);
  assert.equal(app.script, 'dist/src/server.js');
  assert.equal(app.exec_mode, 'fork');
  assert.equal(app.instances, 1);
  assert.equal(app.watch, false);
  assert.deepEqual(app.env, { NODE_ENV: 'production' });
  assert.equal('database' in app, false);
  assert.equal('jwt' in app, false);
});
