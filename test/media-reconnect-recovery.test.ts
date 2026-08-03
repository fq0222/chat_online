import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaReconnectRecovery } from '../apps/web/src/utils/mediaReconnectRecovery';

test('媒体通道连续断开达到阈值后升级重建控制通道', () => {
  const recovery = createMediaReconnectRecovery({ maxMediaReconnectsBeforeControlReconnect: 3 });

  assert.deepEqual(recovery.markMediaClosed(), { shouldReconnectControlSocket: false, mediaCloseCount: 1 });
  assert.deepEqual(recovery.markMediaClosed(), { shouldReconnectControlSocket: false, mediaCloseCount: 2 });
  assert.deepEqual(recovery.markMediaClosed(), { shouldReconnectControlSocket: true, mediaCloseCount: 3 });
});

test('媒体通道连接成功后会清空连续断开计数', () => {
  const recovery = createMediaReconnectRecovery({ maxMediaReconnectsBeforeControlReconnect: 2 });

  recovery.markMediaClosed();
  recovery.markMediaOpened();

  assert.deepEqual(recovery.markMediaClosed(), { shouldReconnectControlSocket: false, mediaCloseCount: 1 });
});
