import type { PageName } from '../types';

const pageTitleMap: Record<PageName, string> = {
  login: '管理员登录 - Chat Online',
  rooms: '聊天室管理 - Chat Online',
  settings: '管理员设置 - Chat Online',
  chat: '管理端聊天窗口 - Chat Online',
  'guest-chat': '在线客服 - Chat Online'
};

/**
 * 获取当前前端页面对应的浏览器标签标题。
 * @param page 当前页面名称；核心分支按管理端页面和用户端聊天页分别返回不同标题。
 * @returns 用于 document.title 的完整标题。
 */
export function getPageTitle(page: PageName): string {
  return pageTitleMap[page];
}
