import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageTitle } from '../apps/web/src/utils/pageTitle';

test('浏览器标签标题按当前页面内容变化', () => {
  assert.equal(getPageTitle('login'), '管理员登录 - Chat Online');
  assert.equal(getPageTitle('rooms'), '聊天室管理 - Chat Online');
  assert.equal(getPageTitle('settings'), '管理员设置 - Chat Online');
  assert.equal(getPageTitle('chat'), '管理端聊天窗口 - Chat Online');
  assert.equal(getPageTitle('guest-chat'), '在线客服 - Chat Online');
});
