import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatMediaRelayService } from '../src/services/chatMediaRelayService';

class MemorySender {
  readonly messages: unknown[] = [];

  send(message: string): void {
    this.messages.push(JSON.parse(message));
  }
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
    data: 'YWJj'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(guestSender.messages[0], {
    event: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: 'YWJj'
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
    data: btoa('abcd')
  });

  assert.deepEqual(firstResult, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });
  assert.equal(guestSender.messages.length, 0);

  media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);

  assert.deepEqual(guestSender.messages, [
    {
      event: 'image:chunk',
      imageId: 'image-late-target',
      chunkIndex: 0,
      totalChunks: 2,
      data: btoa('abcd')
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
    data: 'YWJj'
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
    data: ''
  });
  const firstResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: 'YWJj'
  });
  const repeatResult = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: 'YWJj'
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
    data: btoa('abcde')
  });
  const firstChunk = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 0,
    totalChunks: 2,
    data: btoa('abcd')
  });
  const oversizedTotal = media.handleChunk(admin.connectionId, {
    type: 'image:chunk',
    imageId: 'image-1',
    chunkIndex: 1,
    totalChunks: 2,
    data: btoa('cde')
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
    data: btoa('abcd')
  });
  assert.deepEqual(pendingResult, { ok: true, complete: true, receivedChunks: 1, totalChunks: 1 });
  assert.equal(guestSender.messages.length, 0);

  media.connectMedia({ connectionId: 'guest-1', roomId: 'room-1', role: 'guest' }, guestSender);
  assert.deepEqual(guestSender.messages, [
    {
      event: 'image:chunk',
      imageId: 'image-1',
      chunkIndex: 0,
      totalChunks: 1,
      data: btoa('abcd')
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
    data: btoa('abcd')
  });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.message, '图片传输不存在');
});
