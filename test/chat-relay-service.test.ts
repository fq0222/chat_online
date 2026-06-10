import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatRelayService, type ClientMessage } from '../src/services/chatRelayService';

class MemorySender {
  readonly messages: unknown[] = [];

  send(message: string): void {
    this.messages.push(JSON.parse(message));
  }
}

test('访客连接时按时间戳生成用户名', () => {
  const relay = new ChatRelayService({ now: () => new Date('2026-06-10T12:00:00.123Z') });
  const sender = new MemorySender();

  const guest = relay.connectGuest('room-1', sender);

  assert.equal(guest.username, '用户-1781092800123');
});

test('访客文本消息只转发给管理员', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);
  const message: ClientMessage = {
    type: 'text',
    clientMessageId: 'm-1',
    payload: { text: '你好' }
  };

  relay.handleClientMessage(guest.connectionId, message);

  assert.equal(adminSender.messages.length, 1);
  assert.equal(guestSender.messages.length, 1);
  assert.equal((adminSender.messages[0] as { payload: { text: string } }).payload.text, '你好');
  assert.equal((guestSender.messages[0] as { event: string }).event, 'message:ack');
});

test('管理员消息只转发给指定访客', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const firstGuestSender = new MemorySender();
  const secondGuestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const firstGuest = relay.connectGuest('room-1', firstGuestSender);
  relay.connectGuest('room-1', secondGuestSender);

  relay.handleClientMessage(admin.connectionId, {
    type: 'text',
    clientMessageId: 'm-2',
    targetConnectionId: firstGuest.connectionId,
    payload: { text: '只发给你' }
  });

  assert.equal(firstGuestSender.messages.length, 1);
  assert.equal(secondGuestSender.messages.length, 0);
});

test('图片消息校验 MIME 和大小后转发', () => {
  const relay = new ChatRelayService({ maxImageBytes: 12 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(guest.connectionId, {
    type: 'image',
    clientMessageId: 'img-1',
    payload: { mimeType: 'image/png', dataUrl: 'data:image/png;base64,MTIzNA==' }
  });
  relay.handleClientMessage(guest.connectionId, {
    type: 'image',
    clientMessageId: 'img-2',
    payload: { mimeType: 'image/gif', dataUrl: 'data:image/gif;base64,MTIzNA==' }
  });

  assert.equal((adminSender.messages[0] as { type: string }).type, 'image');
  assert.equal((guestSender.messages[1] as { event: string }).event, 'message:error');
});

test('转发服务不提供聊天历史列表', () => {
  const relay = new ChatRelayService();

  assert.equal(Object.hasOwn(relay, 'messages'), false);
  assert.equal('getMessages' in relay, false);
});
