import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, type AppConfig } from '../src/config';

const root = path.resolve(__dirname, '..');

test('config.example.js 包含生产环境必需配置项', () => {
  const config = require(path.join(root, 'config.example.js')) as AppConfig;

  assert.equal(typeof config.server.port, 'number');
  assert.equal(typeof config.site.protocol, 'string');
  assert.equal(typeof config.site.host, 'string');
  assert.equal(typeof config.database.connectionString, 'string');
  assert.equal(typeof config.bootstrapAdmin.username, 'string');
  assert.equal(typeof config.bootstrapAdmin.password, 'string');
  assert.equal(config.auth.adminTokenTtlMs, 24 * 60 * 60 * 1000);
  assert.equal(typeof config.auth.jwtSecret, 'string');
  assert.equal(config.auth.jwtSecret.length >= 32, true);
});

test('生产环境缺少管理员隐藏入口时返回可读中文错误', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-online-config-'));

  process.env.NODE_ENV = 'production';
  process.chdir(tempDir);

  try {
    assert.throws(
      () => loadConfig(),
      /生产环境必须配置 32 位十六进制的 auth\.adminEntryKey/
    );
  } finally {
    process.chdir(previousCwd);
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
