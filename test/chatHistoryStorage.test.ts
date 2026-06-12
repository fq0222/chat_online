import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../apps/web/src/types';
import { createChatHistoryStorage } from '../apps/web/src/utils/chatHistoryStorage';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly items = new Map<string, string>();

  /**
   * 读取内存版浏览器缓存。
   * @param key 缓存键；核心分支为不存在时返回 null，模拟 localStorage 行为。
   * @returns 缓存字符串或 null。
   */
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  /**
   * 写入内存版浏览器缓存。
   * @param key 缓存键。
   * @param value 缓存值；核心分支为覆盖同名键，模拟 localStorage 行为。
   */
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  /**
   * 删除内存版浏览器缓存。
   * @param key 缓存键；核心分支为键不存在时保持静默。
   */
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

test('聊天记录缓存开关开启时必须立即保存已有消息', () => {
  const storage = new MemoryStorage();
  const history: ChatMessage[] = [{ from: 'guest', text: '之前的消息', time: '2026/6/11 10:00:00' }];
  const chatHistoryStorage = createChatHistoryStorage({
    storage,
    enabledKey: 'chat-history-enabled',
    historyKey: 'chat-history-room-a'
  });

  chatHistoryStorage.setEnabled(true, history);

  assert.equal(storage.getItem('chat-history-enabled'), 'on');
  assert.deepEqual(chatHistoryStorage.read(), history);
});

test('聊天记录缓存关闭时不会写入新消息', () => {
  const storage = new MemoryStorage();
  const chatHistoryStorage = createChatHistoryStorage({
    storage,
    enabledKey: 'chat-history-enabled',
    historyKey: 'chat-history-room-a'
  });

  const saved = chatHistoryStorage.write([{ from: 'admin', text: '新消息', time: '2026/6/11 10:01:00' }]);

  assert.equal(saved, false);
  assert.equal(storage.getItem('chat-history-room-a'), null);
});

test('聊天记录缓存写入图片消息时不保存原始 dataURL', () => {
  const storage = new MemoryStorage();
  const chatHistoryStorage = createChatHistoryStorage({
    storage,
    enabledKey: 'chat-history-enabled',
    historyKey: 'chat-history-room-a'
  });
  const imageMessage: ChatMessage = {
    from: 'guest',
    text: '[图片消息]',
    time: '2026/6/12 10:00:00',
    imageUrl: 'data:image/png;base64,very-large-image-body',
    mimeType: 'image/png'
  };

  chatHistoryStorage.setEnabled(true, [imageMessage]);

  const rawHistory = storage.getItem('chat-history-room-a') ?? '';
  assert.doesNotMatch(rawHistory, /very-large-image-body/);
  assert.deepEqual(chatHistoryStorage.read(), [
    {
      from: 'guest',
      text: '[图片消息]',
      time: '2026/6/12 10:00:00',
      mimeType: 'image/png'
    }
  ]);
});
