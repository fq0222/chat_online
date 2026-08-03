export type MediaReconnectRecoveryDecision = {
  shouldReconnectControlSocket: boolean;
  mediaCloseCount: number;
};

/**
 * 创建媒体通道恢复策略。
 * @param options 恢复配置；核心分支为媒体通道连续断开达到阈值后升级重建控制通道。
 * @returns 可记录媒体连接开关状态的恢复控制器。
 */
export function createMediaReconnectRecovery(options: { maxMediaReconnectsBeforeControlReconnect: number }) {
  let mediaCloseCount = 0;

  return {
    /**
     * 记录一次媒体通道断开。
     * @returns 恢复决策；达到阈值时要求重建控制通道，避免旧 connectionId 导致媒体通道反复握手失败。
     */
    markMediaClosed(): MediaReconnectRecoveryDecision {
      mediaCloseCount += 1;

      return {
        shouldReconnectControlSocket: mediaCloseCount >= options.maxMediaReconnectsBeforeControlReconnect,
        mediaCloseCount
      };
    },
    /**
     * 记录媒体通道连接成功。
     * 核心分支：成功连上说明当前控制连接身份有效，需要清空连续断开计数。
     */
    markMediaOpened(): void {
      mediaCloseCount = 0;
    }
  };
}
