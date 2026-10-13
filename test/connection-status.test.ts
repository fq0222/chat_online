import assert from 'node:assert/strict';
import test from 'node:test';
import { getControlConnectionStatus, getMediaConnectionStatus } from '../apps/web/src/utils/connectionStatus';

test('媒体通道重连不覆盖已连接的管理端实时服务状态', () => {
  assert.equal(getControlConnectionStatus('admin', 'connected'), '实时服务已连接');
  assert.equal(getMediaConnectionStatus('reconnecting'), '图片通道正在重连，图片将自动续传');
});

test('媒体通道恢复连接后不再显示图片通道提示', () => {
  assert.equal(getMediaConnectionStatus('connected'), '');
});

test('控制通道重连时优先展示整体实时服务状态', () => {
  assert.equal(getControlConnectionStatus('guest', 'reconnecting', 2), '连接已断开，5 秒后第 2 次重连');
  assert.equal(getMediaConnectionStatus('idle'), '');
});

test('不可建立控制连接时保留原有的角色提示', () => {
  assert.equal(getControlConnectionStatus('admin', 'room-unselected'), '请选择聊天室');
  assert.equal(getControlConnectionStatus('guest', 'room-unavailable'), '聊天室不可用');
});
