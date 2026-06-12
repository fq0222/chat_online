import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleImageChunks, createImageChunks, dataUrlToBlob } from '../apps/web/src/utils/imageChunkTransfer';

test('图片数据会按固定大小切成有序分片', async () => {
  const chunks = await createImageChunks(new Blob(['abcdefghij'], { type: 'image/jpeg' }), 4);

  assert.equal(chunks.imageId.length > 0, true);
  assert.equal(chunks.mimeType, 'image/jpeg');
  assert.equal(chunks.size, 10);
  assert.equal(chunks.chunkSize, 4);
  assert.equal(chunks.totalChunks, 3);
  assert.deepEqual(
    chunks.chunks.map((chunk) => ({ index: chunk.chunkIndex, total: chunk.totalChunks })),
    [
      { index: 0, total: 3 },
      { index: 1, total: 3 },
      { index: 2, total: 3 }
    ]
  );
});

test('接收端按分片序号合成 Blob', async () => {
  const blob = await assembleImageChunks(
    [
      { chunkIndex: 1, totalChunks: 3, data: btoa('efgh') },
      { chunkIndex: 0, totalChunks: 3, data: btoa('abcd') },
      { chunkIndex: 2, totalChunks: 3, data: btoa('ij') }
    ],
    'image/jpeg'
  );

  assert.equal(blob.type, 'image/jpeg');
  assert.equal(await blob.text(), 'abcdefghij');
});

test('dataURL 可以转换为 Blob 后继续分片', async () => {
  const blob = dataUrlToBlob(`data:image/png;base64,${btoa('hello')}`);
  const chunks = await createImageChunks(blob, 2);

  assert.equal(blob.type, 'image/png');
  assert.equal(await blob.text(), 'hello');
  assert.equal(chunks.totalChunks, 3);
});

test('浏览器不支持 crypto.randomUUID 时仍能生成图片分片 ID', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array): Uint8Array {
        bytes.fill(7);
        return bytes;
      }
    }
  });

  try {
    const chunks = await createImageChunks(new Blob(['abc'], { type: 'image/png' }), 2);

    assert.equal(chunks.imageId.startsWith('image-'), true);
    assert.equal(chunks.totalChunks, 2);
  } finally {
    if (originalCrypto) {
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  }
});
