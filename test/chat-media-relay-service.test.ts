import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatMediaRelayService } from '../src/services/chatMediaRelayService';

class MemorySender {
  readonly messages: unknown[] = [];

  send(message: string | Buffer): void {
    this.messages.push(typeof message === 'string' ? JSON.parse(message) : decodeBinaryChunkFrame(message));
  }
}

/**
 * 创建测试用图片分片字节。
 * @param value 分片文本；核心分支按 UTF-8 转为 Buffer，模拟 WebSocket 二进制帧中的图片正文。
 * @returns 可交给媒体服务处理的分片正文。
 */
function chunk(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

/**
 * 解析测试收到的二进制图片分片帧。
 * @param frame 服务端转发给接收方的二进制帧；核心分支读取 4 字节元数据长度，再解析 JSON 元数据和原始字节。
 * @returns 便于断言的分片摘要。
 */
function decodeBinaryChunkFrame(frame: Buffer): Record<string, unknown> {
  const metadataLength = frame.readUInt32BE(0);
  const metadataEnd = 4 + metadataLength;
  const metadata = JSON.parse(frame.subarray(4, metadataEnd).toString('utf8')) as Record<string, unknown>;

  return {
    ...metadata,
    data: frame.subarray(metadataEnd)
  };
}

test('图片分片通过媒体服务转发给目标媒体连接', () => {
  const media = new ChatMediaRelayService({ now: () => 1000 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);
  const guest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  media.startTransfer({
    imageId: 'image-1',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: guest.connectionId,
    totalChunks: 2,
    chunkSize: 32768,
    size: 12
  });
  const result = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abc')
  });

  assert.equal(result.ok, true);
  assert.deepEqual(guestSender.messages[0], {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abc')
  });
});

test('接收方媒体连接稍后建立时会收到已经到达的图片分片', () => {
  const media = new ChatMediaRelayService({ now: () => 1000 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);

  media.startTransfer({
    imageId: 'image-late-target',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: 'guest-1',
    totalChunks: 2,
    chunkSize: 4,
    size: 8
  });

  const firstResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-late-target',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abcd')
  });

  assert.deepEqual(firstResult, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });
  assert.equal(guestSender.messages.length, 0);

  media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  assert.deepEqual(guestSender.messages, [
    {
      type: 'image:chunk',
      imageId: 'image-late-target',
      chunkIndex: 0,
      totalChunks: 2,
      data: chunk('abcd')
    }
  ]);
});

test('旧媒体连接关闭晚于新连接建立时不能删除新连接', () => {
  const media = new ChatMediaRelayService({ now: () => 1000 });
  const adminSender = new MemorySender();
  const oldGuestSender = new MemorySender();
  const newGuestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);
  const oldGuest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, oldGuestSender);
  const newGuest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, newGuestSender);

  media.disconnectMedia(oldGuest.connectionId, oldGuestSender);
  media.startTransfer({
    imageId: 'image-reconnect-race',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: newGuest.connectionId,
    totalChunks: 1,
    chunkSize: 4,
    size: 4
  });
  media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-reconnect-race',
    chunkIndex: 0,
    totalChunks: 1,
    data: chunk('abcd')
  });

  assert.equal(oldGuestSender.messages.length, 0);
  assert.deepEqual(newGuestSender.messages, [
    {
      type: 'image:chunk',
      imageId: 'image-reconnect-race',
      chunkIndex: 0,
      totalChunks: 1,
      data: chunk('abcd')
    }
  ]);
});

test('媒体服务拒绝越界分片且不影响其他传输', () => {
  const media = new ChatMediaRelayService({ now: () => 1000 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);
  const guest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  media.startTransfer({
    imageId: 'image-1',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: guest.connectionId,
    totalChunks: 1,
    chunkSize: 32768,
    size: 4
  });
  const result = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 1,
    totalChunks: 1,
    data: chunk('abc')
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, '图片分片序号无效');
  assert.equal(guestSender.messages.length, 0);
});

test('媒体服务拒绝空分片正文并忽略重复分片完成计数', () => {
  const media = new ChatMediaRelayService({ now: () => 1000 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);
  const guest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  media.startTransfer({
    imageId: 'image-1',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: guest.connectionId,
    totalChunks: 2,
    chunkSize: 32768,
    size: 8
  });

  const invalidResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: Buffer.alloc(0)
  });
  const firstResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abc')
  });
  const repeatResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abc')
  });

  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.message, '图片分片正文不能为空');
  assert.deepEqual(firstResult, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });
  assert.deepEqual(repeatResult, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });
});

test('媒体服务拒绝超过声明大小的分片', () => {
  const media = new ChatMediaRelayService({ now: () => 1000 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);
  const guest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  media.startTransfer({
    imageId: 'image-1',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: guest.connectionId,
    totalChunks: 2,
    chunkSize: 4,
    size: 6
  });

  const oversizedChunk = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abcde')
  });
  const firstChunk = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: chunk('abcd')
  });
  const oversizedTotal = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 1,
    totalChunks: 2,
    data: chunk('cde')
  });

  assert.equal(oversizedChunk.ok, false);
  assert.equal(oversizedChunk.message, '图片分片大小超过限制');
  assert.equal(firstChunk.ok, true);
  assert.equal(oversizedTotal.ok, false);
  assert.equal(oversizedTotal.message, '图片累计大小超过限制');
});

test('媒体连接短暂断开不会清理传输会话并在重连后补发分片', () => {
  let now = 1000;
  const media = new ChatMediaRelayService({ now: () => now, maxSessionIdleMs: 100 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();

  const admin = media.connectMedia({ connectionId: 'admin-1', roomId: 'room-1', role: 'admin' }, adminSender);
  const guest = media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  media.startTransfer({
    imageId: 'image-1',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: guest.connectionId,
    totalChunks: 1,
    chunkSize: 4,
    size: 4
  });
  media.disconnectMedia(guest.connectionId);

  const pendingResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 1,
    data: chunk('abcd')
  });
  assert.deepEqual(pendingResult, { ok: true, complete: true, receivedChunks: 1, totalChunks: 1 });
  assert.equal(guestSender.messages.length, 0);

  media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);
  assert.deepEqual(guestSender.messages, [
    {
      type: 'image:chunk',
      imageId: 'image-1',
      chunkIndex: 0,
      totalChunks: 1,
      data: chunk('abcd')
    }
  ]);

  media.startTransfer({
    imageId: 'image-2',
    roomId: 'room-1',
    fromConnectionId: admin.connectionId,
    toConnectionId: guest.connectionId,
    totalChunks: 1,
    chunkSize: 4,
    size: 4
  });
  now = 1200;

  const expiredResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-2',
    chunkIndex: 0,
    totalChunks: 1,
    data: chunk('abcd')
  });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.message, '图片传输不存在');
});
