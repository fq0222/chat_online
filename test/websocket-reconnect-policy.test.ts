import test from 'node:test';
import assert from 'node:assert/strict';
import { createReconnectPolicy } from '../apps/web/src/utils/websocketReconnect';

test('WebSocket 断线重连策略每 5 秒重连一次且最多 3 次', () => {
  const policy = createReconnectPolicy({ maxAttempts: 3, delayMs: 5000 });

  assert.deepEqual(policy.next(), { shouldReconnect: true, attempt: 1, delayMs: 5000 });
  assert.deepEqual(policy.next(), { shouldReconnect: true, attempt: 2, delayMs: 5000 });
  assert.deepEqual(policy.next(), { shouldReconnect: true, attempt: 3, delayMs: 5000 });
  assert.deepEqual(policy.next(), { shouldReconnect: false, attempt: 3, delayMs: 5000 });
});

test('WebSocket 重连策略可在连接成功后重置次数', () => {
  const policy = createReconnectPolicy({ maxAttempts: 3, delayMs: 5000 });

  policy.next();
  policy.next();
  policy.reset();

  assert.deepEqual(policy.next(), { shouldReconnect: true, attempt: 1, delayMs: 5000 });
});
