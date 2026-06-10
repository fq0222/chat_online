import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, getLocalTime } from '../src/utils/logger';

test('日志工具输出模块名、级别和上海时间', () => {
  const messages: string[] = [];
  const logger = createLogger('测试模块', {
    info: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    error: (message) => messages.push(message)
  });

  logger.info('启动完成');

  assert.equal(messages.length, 1);
  assert.match(messages[0], /^\[测试模块\] \[INFO\] /);
  assert.match(messages[0], / - 启动完成$/);
  assert.match(getLocalTime(), /^\d{4}\/\d{1,2}\/\d{1,2}/);
});
