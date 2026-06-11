import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig } from '../src/config';

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
});
