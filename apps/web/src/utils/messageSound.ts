export type IncomingMessageSoundOptions = {
  soundReminderEnabled: boolean;
  pageIsActive: boolean;
  activeConversation: boolean;
  currentPage: string;
};

export type IncomingMessageSoundMode = 'beep' | 'tts';

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const adminIncomingMessageTtsUrl = '/admin-new-message.wav';
let audioContextRef: AudioContext | null = null;
let adminTtsBufferRef: AudioBuffer | null = null;
let adminTtsBufferPromiseRef: Promise<AudioBuffer> | null = null;

/**
 * 判断收到新消息时是否需要播放提示音。
 * @param options 提示音开关、页面聚焦状态和会话匹配状态；核心分支为关闭开关时永不播放，页面未聚焦或非当前会话时播放。
 * @returns 是否应该触发内置短促提示音。
 */
export function shouldPlayIncomingMessageSound(options: IncomingMessageSoundOptions): boolean {
  if (!options.soundReminderEnabled) {
    return false;
  }

  if (options.currentPage !== 'chat' && options.currentPage !== 'guest-chat') {
    return true;
  }

  return !options.pageIsActive || !options.activeConversation;
}

/**
 * 获取一次新消息提醒需要播放的 beep 起始偏移。
 * @returns 三次连续 beep 的秒级偏移；核心分支保持每一下仍使用当前短促 beep，只改变重复次数。
 */
export function getIncomingMessageBeepOffsets(): number[] {
  return [0, 0.26, 0.52];
}

/**
 * 获取当前页面收到新消息时使用的声音模式。
 * @param page 当前前端页面；核心分支为管理员聊天页使用 TTS，访客聊天页继续使用三下 beep。
 * @returns 新消息提示音模式。
 */
export function getIncomingMessageSoundMode(page: string): IncomingMessageSoundMode {
  return page === 'chat' ? 'tts' : 'beep';
}

/**
 * 判断当前浏览器标签页是否处于可见且聚焦状态。
 * @returns 页面可见且窗口聚焦时返回 true；核心分支用于区分用户是否正在看当前聊天窗口。
 */
export function isPageActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * 预热新消息提示音需要的浏览器音频权限和 TTS 资源。
 * 核心分支：必须由点击、按键等用户激活事件触发，后续后台收到管理员消息时才能稳定播报。
 */
export function primeIncomingMessageSound(): void {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  const ready = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
  void ready.then(() => loadAdminIncomingMessageTts(audioContext)).catch(() => undefined);
}

/**
 * 播放当前接收端的新消息提示音。
 * @param mode 提示音模式；核心分支为管理员侧 TTS 播报，访客侧保留 Web Audio 三下 beep。
 * 浏览器不支持或自动播放策略拒绝时静默跳过，不影响消息收发。
 */
export function playIncomingMessageSound(mode: IncomingMessageSoundMode = 'beep'): void {
  if (mode === 'tts') {
    playIncomingMessageTts();
    return;
  }

  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  try {
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
 * 播放管理员侧客户新消息 TTS 播报。
 * 核心分支：每次创建独立 Audio 实例，让播报可与页面中正在播放的视频混音，不复用旧实例导致中断。
 */
function playIncomingMessageTts(): void {
  const audioContext = getAudioContext();

  if (!audioContext) {
    playIncomingMessageTtsWithAudioElement();
    return;
  }

  const ready = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
  void ready
    .then(() => loadAdminIncomingMessageTts(audioContext))
    .then((buffer) => playAudioBuffer(audioContext, buffer))
    .catch(() => playIncomingMessageTtsWithAudioElement());
}

/**
 * 获取全局复用的浏览器音频上下文。
 * @returns 可用音频上下文；核心分支在浏览器不支持 Web Audio 时返回 null。
 */
function getAudioContext(): AudioContext | null {
  const audioWindow = window as AudioWindow;
  const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  audioContextRef = audioContextRef ?? new AudioContextConstructor();

  return audioContextRef;
}

/**
 * 加载并解码管理员新消息 TTS 音频。
 * @param audioContext 浏览器音频上下文；核心分支复用已解码 AudioBuffer，避免每次消息重复请求。
 * @returns 已解码的 TTS 音频缓冲。
 */
function loadAdminIncomingMessageTts(audioContext: AudioContext): Promise<AudioBuffer> {
  if (adminTtsBufferRef) {
    return Promise.resolve(adminTtsBufferRef);
  }

  adminTtsBufferPromiseRef = adminTtsBufferPromiseRef ?? fetch(adminIncomingMessageTtsUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`TTS 音频加载失败：${response.status}`);
      }

      return response.arrayBuffer();
    })
    .then((buffer) => audioContext.decodeAudioData(buffer))
    .then((audioBuffer) => {
      adminTtsBufferRef = audioBuffer;
      return audioBuffer;
    })
    .catch((error) => {
      adminTtsBufferPromiseRef = null;
      throw error;
    });

  return adminTtsBufferPromiseRef;
}

/**
 * 使用 Web Audio 播放已解码音频。
 * @param audioContext 浏览器音频上下文；核心分支创建一次性 source，允许多条消息播报重叠混音。
 * @param buffer 已解码音频缓冲。
 */
function playAudioBuffer(audioContext: AudioContext, buffer: AudioBuffer): void {
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();
}

/**
 * Web Audio 不可用时的 TTS 播放兜底。
 * 核心分支：仍创建独立 Audio 实例，避免复用旧实例导致播报被截断。
 */
function playIncomingMessageTtsWithAudioElement(): void {
  try {
    const audio = new Audio(adminIncomingMessageTtsUrl);
    audio.preload = 'auto';
    audio.volume = 1;
    void audio.play().catch(() => undefined);
  } catch {
    // 浏览器自动播放策略可能拒绝无交互播放，失败时不影响聊天收发。
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
