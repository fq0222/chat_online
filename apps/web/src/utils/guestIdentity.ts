/**
 * 从访客聊天室 URL 查询参数中读取自定义展示名。
 * @param search URL 查询字符串；核心分支为仅接受非空 user 参数，缺失或空白时交还默认访客名逻辑。
 * @returns 可用于本次 WebSocket 连接的访客展示名，未提供时返回 null。
 */
export function getGuestNameFromSearch(search: string): string | null {
  const username = new URLSearchParams(search).get('user')?.trim();

  return username || null;
}
