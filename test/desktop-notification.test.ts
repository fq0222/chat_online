import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestMessageNotificationTitle, shouldShowDesktopNotification } from '../apps/web/src/utils/desktopNotification';

test('桌面通知标题只显示访客名称且不暴露消息正文', () => {
  assert.equal(createGuestMessageNotificationTitle('fuqiang_2015@163.com'), '用户 fuqiang_2015@163.com 有新消息');
});

test('管理员后台或非当前会话收到消息时才弹桌面通知', () => {
  assert.equal(
    shouldShowDesktopNotification({
      enabled: true,
      permission: 'granted',
      pageIsActive: false,
      activeConversation: true,
      currentPage: 'chat'
    }),
    true
  );
  assert.equal(
    shouldShowDesktopNotification({
      enabled: true,
      permission: 'granted',
      pageIsActive: true,
      activeConversation: false,
      currentPage: 'chat'
    }),
    true
  );
  assert.equal(
    shouldShowDesktopNotification({
      enabled: true,
      permission: 'granted',
      pageIsActive: true,
      activeConversation: true,
      currentPage: 'chat'
    }),
    false
  );
});

test('桌面通知未开启或未授权时不弹出', () => {
  assert.equal(
    shouldShowDesktopNotification({
      enabled: false,
      permission: 'granted',
      pageIsActive: false,
      activeConversation: true,
      currentPage: 'chat'
    }),
    false
  );
  assert.equal(
    shouldShowDesktopNotification({
      enabled: true,
      permission: 'denied',
      pageIsActive: false,
      activeConversation: true,
      currentPage: 'chat'
    }),
    false
  );
});
