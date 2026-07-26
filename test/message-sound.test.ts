import test from 'node:test';
import assert from 'node:assert/strict';
import { getIncomingMessageBeepOffsets, getIncomingMessageSoundMode, shouldPlayIncomingMessageSound } from '../apps/web/src/utils/messageSound';

/**
 * 新消息声音提醒规则测试。
 * 职责：覆盖开关、页面聚焦状态和当前会话匹配状态的组合；关键参数来自前端收消息分支，核心分支不直接测试浏览器音频播放。
 */
test('新消息声音提醒只在开关开启且页面未聚焦或非当前会话时触发', () => {
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: false,
    activeConversation: true,
    currentPage: 'guest-chat'
  }), true);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: true,
    activeConversation: false,
    currentPage: 'guest-chat'
  }), true);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: true,
    activeConversation: true,
    currentPage: 'guest-chat'
  }), false);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: false,
    pageIsActive: false,
    activeConversation: false,
    currentPage: 'guest-chat'
  }), false);
});

test('管理员只有正在前台查看消息所属聊天页时不播放提示音', () => {
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: true,
    activeConversation: true,
    currentPage: 'chat'
  }), false);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: false,
    activeConversation: true,
    currentPage: 'chat'
  }), true);
  assert.equal(shouldPlayIncomingMessageSound({
    soundReminderEnabled: true,
    pageIsActive: true,
    activeConversation: true,
    currentPage: 'rooms'
  }), true);
});

test('新消息提示音每次触发时连续播放三下当前 beep', () => {
  assert.deepEqual(getIncomingMessageBeepOffsets(), [0, 0.26, 0.52]);
});

test('管理员收到客户消息使用 TTS 播报，访客收到管理员消息仍使用 beep', () => {
  assert.equal(getIncomingMessageSoundMode('chat'), 'tts');
  assert.equal(getIncomingMessageSoundMode('guest-chat'), 'beep');
});
