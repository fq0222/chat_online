import test from 'node:test';
import assert from 'node:assert/strict';
import { compressImageFileForChat, getCompressedImageDimensions } from '../apps/web/src/utils/imageCompression';

test('聊天图片压缩尺寸按最大边界等比缩放且不放大小图', () => {
  assert.deepEqual(getCompressedImageDimensions({ width: 3200, height: 1600, maxWidth: 1600, maxHeight: 1600 }), {
    width: 1600,
    height: 800
  });
  assert.deepEqual(getCompressedImageDimensions({ width: 600, height: 400, maxWidth: 1600, maxHeight: 1600 }), {
    width: 600,
    height: 400
  });
});

test('聊天图片压缩后返回 WebP dataURL 和压缩统计', async () => {
  const drawCalls: unknown[][] = [];
  let closed = false;

  const result = await compressImageFileForChat(
    new Blob(['original-image'], { type: 'image/jpeg' }),
    { maxWidth: 1600, maxHeight: 1600, outputMimeType: 'image/webp', quality: 0.72 },
    {
      now: (() => {
        const values = [100, 136];
        return () => values.shift() ?? 136;
      })(),
      createImageBitmap: async () => ({
        width: 3200,
        height: 1600,
        close: () => {
          closed = true;
        }
      }),
      createCanvas: (width, height) => ({
        getContext: () => ({
          drawImage: (...args: unknown[]) => {
            drawCalls.push(args);
          }
        }),
        toBlob: (callback, mimeType) => {
          callback(new Blob(['compressed'], { type: mimeType ?? 'image/webp' }));
        },
        width,
        height
      }),
      readAsDataUrl: async (blob) => `data:${blob.type};base64,compressed`
    }
  );

  assert.equal(result.dataUrl, 'data:image/webp;base64,compressed');
  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.originalBytes, 14);
  assert.equal(result.compressedBytes, 10);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 800);
  assert.equal(result.durationMs, 36);
  assert.equal(closed, true);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 1600, 800]);
});
