export type ControlConnectionState =
  | 'idle'
  | 'room-unselected'
  | 'room-unavailable'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'rebuilding'
  | 'disconnected';
export type MediaConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
export type ConnectionRole = 'admin' | 'guest';

/**
 * 获取控制通道的主状态文案。
 * @param role 当前聊天室角色；管理员和访客使用各自已有的连接文案。
 * @param state 控制通道状态；重连时优先提示整体实时服务状态。
 * @param attempt 当前重连次数；仅重连状态展示次数。
 * @returns 应展示在聊天室主位置的实时服务状态。
 */
export function getControlConnectionStatus(role: ConnectionRole, state: ControlConnectionState, attempt = 0): string {
  const connectedText = role === 'admin' ? '实时服务已连接' : '已进入聊天室';
  const connectingText = role === 'admin' ? '正在连接实时服务' : '正在连接客服';

  if (state === 'connected') {
    return connectedText;
  }

  if (state === 'connecting') {
    return connectingText;
  }

  if (state === 'room-unselected') {
    return '请选择聊天室';
  }

  if (state === 'room-unavailable') {
    return '聊天室不可用';
  }

  if (state === 'reconnecting') {
    return role === 'admin' ? `实时服务已断开，5 秒后第 ${attempt} 次重连` : `连接已断开，5 秒后第 ${attempt} 次重连`;
  }

  if (state === 'rebuilding') {
    return '正在重建实时服务';
  }

  if (state === 'disconnected') {
    return role === 'admin' ? '实时服务已断开，等待下次重连' : '连接已断开，等待下次重连';
  }

  return '等待连接';
}

/**
 * 获取图片媒体通道的补充状态文案。
 * @param state 图片分片媒体通道状态；连接正常时返回空字符串以隐藏补充提示。
 * @returns 图片通道提示，或空字符串。
 */
export function getMediaConnectionStatus(state: MediaConnectionState): string {
  if (state === 'connecting') {
    return '图片通道连接中';
  }

  if (state === 'reconnecting') {
    return '图片通道正在重连，图片将自动续传';
  }

  if (state === 'unavailable') {
    return '图片通道多次连接失败，正在重建实时服务';
  }

  return '';
}
