import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontendLogger } from '../apps/web/src/utils/frontendLogger';

test('前端日志工具按模块和级别输出统一前缀', () => {
  const messages: string[] = [];
  const logger = createFrontendLogger('图片发送', {
    info: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    error: (message) => messages.push(message)
  });

  logger.info('压缩完成');

  assert.equal(messages.length, 1);
  assert.match(messages[0], /^\[图片发送\] \[INFO\] /);
  assert.match(messages[0], / - 压缩完成$/);
});
