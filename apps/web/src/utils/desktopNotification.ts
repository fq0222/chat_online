export type DesktopNotificationPermission = NotificationPermission | 'unsupported';

export type DesktopNotificationOptions = {
  enabled: boolean;
  permission: DesktopNotificationPermission;
  pageIsActive: boolean;
  activeConversation: boolean;
  currentPage: string;
};

/**
 * 生成管理员桌面通知标题。
 * @param username 访客展示名；核心分支只包含用户名称，不透出真实聊天内容。
 * @returns 可直接展示在系统通知标题里的隐私友好文案。
 */
export function createGuestMessageNotificationTitle(username: string): string {
  return `用户 ${username} 有新消息`;
}

/**
 * 生成访客新消息桌面通知配置。
 * @returns Notification 构造参数；核心分支刻意不设置 tag，避免 Chrome 合并同一访客的连续通知。
 */
export function createGuestMessageNotificationInit(): NotificationOptions {
  return {
    icon: '/favicon.svg'
  };
}

/**
 * 判断是否需要弹出桌面通知。
 * @param options 通知开关、浏览器授权、页面焦点和会话匹配状态；核心分支为仅管理员聊天页在后台或非当前会话时提醒。
 * @returns 满足后台提醒条件时返回 true。
 */
export function shouldShowDesktopNotification(options: DesktopNotificationOptions): boolean {
  if (!options.enabled || options.permission !== 'granted' || options.currentPage !== 'chat') {
    return false;
  }

  return !options.pageIsActive || !options.activeConversation;
}
