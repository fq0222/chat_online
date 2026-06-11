import test from 'node:test';
import assert from 'node:assert/strict';
import { getIncomingMessageBeepOffsets, shouldPlayIncomingMessageSound } from '../apps/web/src/utils/messageSound';

/**
 * 新消息声音提醒规则测试。
 * 职责：覆盖开关、页面聚焦状态和当前会话匹配状态的组合；关键参数来自前端收消息分支，核心分支不直接测试浏览器音频播放。
 */
test('新消息声音提醒只在开关开启且页面未聚焦或非当前会话时触发', () => {
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: false,
    activeConversation: true
  }), true);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: true,
    activeConversation: false
  }), true);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: true,
    activeConversation: true
  }), false);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: false,
    pageIsActive: false,
    activeConversation: false
  }), false);
});

test('新消息提示音每次触发时连续播放三下当前 beep', () => {
  assert.deepEqual(getIncomingMessageBeepOffsets(), [0, 0.26, 0.52]);
});
