export type IncomingMessageSoundOptions = {
  soundReminderEnabled: boolean;
  pageIsActive: boolean;
  activeConversation: boolean;
};

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContextRef: AudioContext | null = null;

/**
 * 判断收到新消息时是否需要播放提示音。
 * @param options 提示音开关、页面聚焦状态和会话匹配状态；核心分支为关闭开关时永不播放，页面未聚焦或非当前会话时播放。
 * @returns 是否应该触发内置短促提示音。
 */
export function shouldPlayIncomingMessageSound(options: IncomingMessageSoundOptions): boolean {
  return options.soundReminderEnabled && (!options.pageIsActive || !options.activeConversation);
}

/**
 * 获取一次新消息提醒需要播放的 beep 起始偏移。
 * @returns 三次连续 beep 的秒级偏移；核心分支保持每一下仍使用当前短促 beep，只改变重复次数。
 */
export function getIncomingMessageBeepOffsets(): number[] {
  return [0, 0.26, 0.52];
}

/**
 * 判断当前浏览器标签页是否处于可见且聚焦状态。
 * @returns 页面可见且窗口聚焦时返回 true；核心分支用于区分用户是否正在看当前聊天窗口。
 */
export function isPageActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * 播放一段由 Web Audio 生成的短促提示音。
 * 核心分支：浏览器不支持或自动播放策略拒绝时静默跳过，不影响消息收发。
 */
export function playIncomingMessageSound(): void {
  const audioWindow = window as AudioWindow;
  const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  try {
    audioContextRef = audioContextRef ?? new AudioContextConstructor();
    const audioContext = audioContextRef;

    if (audioContext.state === 'suspended') {
      void audioContext.resume().then(() => playIncomingMessageBeeps(audioContext)).catch(() => undefined);
      return;
    }

    playIncomingMessageBeeps(audioContext);
  } catch {
    // 浏览器可能因未发生用户交互而拒绝播放，提示音失败不应打断聊天流程。
  }
}

/**
 * 在指定音频上下文中连续调度三下新消息 beep。
 * @param audioContext 浏览器音频上下文；核心分支按固定偏移重复当前 beep，形成连续三下提示音。
 */
function playIncomingMessageBeeps(audioContext: AudioContext): void {
  getIncomingMessageBeepOffsets().forEach((offsetSeconds) => {
    playBeep(audioContext, offsetSeconds);
  });
}

/**
 * 在指定音频上下文中生成一段短促 beep。
 * @param audioContext 浏览器音频上下文；核心分支使用振荡器和音量节点控制音高、音量和持续时间。
 * @param offsetSeconds 相对当前音频时间的延迟秒数；核心分支用于连续调度多下提示音。
 */
function playBeep(audioContext: AudioContext, offsetSeconds: number): void {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const startedAt = audioContext.currentTime + offsetSeconds;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, startedAt);
  gainNode.gain.setValueAtTime(0.0001, startedAt);
  gainNode.gain.exponentialRampToValueAtTime(0.18, startedAt + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.18);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + 0.2);
}
