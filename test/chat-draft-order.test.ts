import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSendQueue } from '../apps/web/src/utils/chatDraftOrder';
import type { PendingImage } from '../apps/web/src/types';

const firstImage: PendingImage = {
  dataUrl: 'data:image/png;base64,first',
  mimeType: 'image/png',
  name: 'first.png'
};
const secondImage: PendingImage = {
  dataUrl: 'data:image/webp;base64,second',
  mimeType: 'image/webp',
  name: 'second.webp'
};

test('发送草稿同时包含图片和文字时文字排在图片前面', () => {
  const queue = createDraftSendQueue('  文字消息  ', [firstImage, secondImage]);

  assert.deepEqual(queue, [
    { type: 'text', text: '文字消息' },
    { type: 'image', image: firstImage },
    { type: 'image', image: secondImage }
  ]);
});

test('发送草稿只有文字时只生成文字任务', () => {
  const queue = createDraftSendQueue('  只有文字  ', []);

  assert.deepEqual(queue, [{ type: 'text', text: '只有文字' }]);
});

test('发送草稿只有图片时保留图片原有顺序', () => {
  const queue = createDraftSendQueue('', [firstImage, secondImage]);

  assert.deepEqual(queue, [
    { type: 'image', image: firstImage },
    { type: 'image', image: secondImage }
  ]);
});
