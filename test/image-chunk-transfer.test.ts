import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleImageChunks, createImageChunks, dataUrlToBlob, decodeImageChunkFrame, encodeImageChunkFrame } from '../apps/web/src/utils/imageChunkTransfer';

test('图片数据会按固定大小切成有序分片', async () => {
  const chunks = await createImageChunks(new Blob(['abcdefghij'], { type: 'image/jpeg' }), 4);

  assert.equal(chunks.imageId.length > 0, true);
  assert.equal(chunks.mimeType, 'image/jpeg');
  assert.equal(chunks.size, 10);
  assert.equal(chunks.chunkSize, 4);
  assert.equal(chunks.totalChunks, 3);
  assert.deepEqual(
    chunks.chunks.map((chunk) => ({ index: chunk.chunkIndex, total: chunk.totalChunks, bytes: chunk.data.byteLength })),
    [
      { index: 0, total: 3, bytes: 4 },
      { index: 1, total: 3, bytes: 4 },
      { index: 2, total: 3, bytes: 2 }
    ]
  );
});

test('接收端按分片序号合成 Blob', async () => {
  const blob = await assembleImageChunks(
    [
      { chunkIndex: 1, totalChunks: 3, data: new TextEncoder().encode('efgh').buffer },
      { chunkIndex: 0, totalChunks: 3, data: new TextEncoder().encode('abcd').buffer },
      { chunkIndex: 2, totalChunks: 3, data: new TextEncoder().encode('ij').buffer }
    ],
    'image/jpeg'
  );

  assert.equal(blob.type, 'image/jpeg');
  assert.equal(await blob.text(), 'abcdefghij');
});

test('图片分片会编码为携带元数据和原始字节的二进制帧', () => {
  const data = new TextEncoder().encode('abcd').buffer;
  const frame = encodeImageChunkFrame('image-1', { chunkIndex: 0, totalChunks: 2, data });
  const decoded = decodeImageChunkFrame(frame);

  assert.equal(decoded.imageId, 'image-1');
  assert.equal(decoded.chunkIndex, 0);
  assert.equal(decoded.totalChunks, 2);
  assert.equal(new TextDecoder().decode(decoded.data), 'abcd');
  assert.equal(frame.byteLength < JSON.stringify({ type: 'image:chunk', imageId: 'image-1', chunkIndex: 0, totalChunks: 2, data: btoa('abcd') }).length + 20, true);
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
