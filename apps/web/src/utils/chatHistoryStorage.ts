import type { ChatMessage, MessageFrom } from '../types';

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type ChatHistoryStorageOptions = {
  storage: BrowserStorage;
  enabledKey: string;
  historyKey: string;
};

const messageSenders: MessageFrom[] = ['guest', 'admin'];

/**
 * 判断缓存值是否为可展示的聊天消息。
 * @param value 待校验的缓存项；核心分支为校验发送方、文本、时间和可选图片字段。
 * @returns true 表示该值可以安全放回聊天消息列表。
 */
function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<ChatMessage>;

  return (
    typeof message.from === 'string' &&
    messageSenders.includes(message.from as MessageFrom) &&
    typeof message.text === 'string' &&
    typeof message.time === 'string' &&
    (message.imageUrl === undefined || typeof message.imageUrl === 'string') &&
    (message.mimeType === undefined || typeof message.mimeType === 'string') &&
    (message.imageId === undefined || typeof message.imageId === 'string') &&
    (message.imageStatus === undefined || ['loading', 'ready', 'failed'].includes(message.imageStatus)) &&
    (message.imageProgress === undefined || typeof message.imageProgress === 'number') &&
    (message.previewUrl === undefined || typeof message.previewUrl === 'string')
  );
}

/**
 * 生成适合写入浏览器缓存的聊天消息快照。
 * @param messages 当前完整聊天消息；核心分支为图片消息移除原始 dataURL，避免 localStorage 同步写入大体积内容。
 * @returns 可安全写入缓存的聊天消息列表。
 */
export function createChatHistorySnapshot(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!message.imageUrl) {
      return message;
    }

    return {
      from: message.from,
      text: message.text,
      time: message.time,
      mimeType: message.mimeType
    };
  });
}

/**
 * 创建聊天记录缓存读写器。
 * @param options 浏览器缓存实例与键名；核心分支按 enabledKey 控制写入，并按 historyKey 隔离不同聊天窗口记录。
 * @returns 聊天记录缓存操作集合。
 */
export function createChatHistoryStorage(options: ChatHistoryStorageOptions) {
  const { storage, enabledKey, historyKey } = options;

  return {
    /**
     * 判断聊天记录缓存是否启用。
     * @returns true 表示用户已开启浏览器缓存保存。
     */
    isEnabled(): boolean {
      return storage.getItem(enabledKey) === 'on';
    },

    /**
     * 读取已缓存的聊天记录。
     * @returns 校验后的聊天消息列表；核心分支为 JSON 异常或结构不符时返回空列表。
     */
    read(): ChatMessage[] {
      try {
        const rawHistory = storage.getItem(historyKey);
        const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];

        return Array.isArray(parsedHistory) ? parsedHistory.filter(isChatMessage) : [];
      } catch {
        return [];
      }
    },

    /**
     * 切换聊天记录缓存开关。
     * @param enabled 是否启用缓存。
     * @param currentMessages 当前窗口已有聊天记录；核心分支为开启时立即写入这些旧记录。
     */
    setEnabled(enabled: boolean, currentMessages: ChatMessage[]): void {
      storage.setItem(enabledKey, enabled ? 'on' : 'off');

      if (enabled) {
        this.write(currentMessages);
      }
    },

    /**
     * 写入聊天记录。
     * @param messages 当前完整聊天记录；核心分支为开关关闭时拒绝写入，防止继续更新浏览器缓存。
     * @returns true 表示实际完成写入。
     */
    write(messages: ChatMessage[]): boolean {
      if (!this.isEnabled()) {
        return false;
      }

      try {
        storage.setItem(historyKey, JSON.stringify(createChatHistorySnapshot(messages)));
        return true;
      } catch {
        return false;
      }
    },

    /**
     * 清理当前聊天窗口缓存。
     * 核心分支：仅删除 historyKey，不改变用户的开关偏好。
     */
    clear(): void {
      storage.removeItem(historyKey);
    }
  };
}
