import type { PendingImage } from '../types';

export type DraftSendTask =
  | {
      type: 'image';
      image: PendingImage;
    }
  | {
      type: 'text';
      text: string;
    };

/**
 * 创建聊天草稿发送队列。
 * @param text 输入框文字；核心分支会先 trim，空文字不生成文字任务。
 * @param images 待发送图片列表；核心分支保持图片原有顺序，并始终排在文字任务之前。
 * @returns 按实际发送顺序排列的任务队列。
 */
export function createDraftSendQueue(text: string, images: PendingImage[]): DraftSendTask[] {
  const trimmedText = text.trim();
  const imageTasks: DraftSendTask[] = images.map((image) => ({ type: 'image', image }));

  return trimmedText ? [...imageTasks, { type: 'text', text: trimmedText }] : imageTasks;
}
