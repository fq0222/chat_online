import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatRelayService, type ClientMessage } from '../src/services/chatRelayService';

class MemorySender {
  readonly messages: unknown[] = [];

  send(message: string): void {
    this.messages.push(JSON.parse(message));
  }
}

/**
 * 按事件类型筛选内存发送器收到的消息。
 * @param sender 内存发送器。
 * @param event 目标事件名；核心分支只保留匹配事件，避免 presence 消息影响业务断言。
 * @returns 匹配事件的消息列表。
 */
function findEvents<T extends { event: string }>(sender: MemorySender, event: string): T[] {
  return sender.messages.filter((message) => (message as { event?: string }).event === event) as T[];
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

  const adminMessages = findEvents<{ event: string; payload: { text: string } }>(adminSender, 'message:new');
  const guestAcks = findEvents<{ event: string }>(guestSender, 'message:ack');

  assert.equal(adminMessages.length, 1);
  assert.equal(guestAcks.length, 1);
  assert.equal(adminMessages[0].payload.text, '你好');
});

test('房间欢迎语只自动发送给新进入的访客', () => {
  const relay = new ChatRelayService({ now: () => new Date('2026-06-10T12:00:00.123Z') });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.sendWelcomeMessageToGuest('room-1', guest.connectionId, '欢迎咨询，请描述您的问题。');

  const guestMessages = findEvents<{ event: string; from: { role: string }; payload: { text: string } }>(
    guestSender,
    'message:new'
  );
  const adminMessages = findEvents(adminSender, 'message:new');

  assert.equal(guestMessages.length, 1);
  assert.equal(guestMessages[0].from.role, 'admin');
  assert.equal(guestMessages[0].payload.text, '欢迎咨询，请描述您的问题。');
  assert.equal(adminMessages.length, 0);
});

test('同一访客 1 小时内重复进入不重复收到房间欢迎语', () => {
  let now = new Date('2026-06-10T12:00:00.000Z');
  const relay = new ChatRelayService({ now: () => now });
  const firstSender = new MemorySender();
  const secondSender = new MemorySender();
  const thirdSender = new MemorySender();

  const firstGuest = relay.connectGuest('room-1', firstSender, {
    guestSessionId: 'guest-session-stable-1',
    username: '固定访客'
  });
  relay.sendWelcomeMessageToGuest('room-1', firstGuest.connectionId, '欢迎咨询');
  relay.disconnect(firstGuest.connectionId);

  now = new Date('2026-06-10T12:30:00.000Z');
  const secondGuest = relay.connectGuest('room-1', secondSender, {
    guestSessionId: 'guest-session-stable-1',
    username: '固定访客'
  });
  relay.sendWelcomeMessageToGuest('room-1', secondGuest.connectionId, '欢迎咨询');
  relay.disconnect(secondGuest.connectionId);

  now = new Date('2026-06-10T13:00:01.000Z');
  const thirdGuest = relay.connectGuest('room-1', thirdSender, {
    guestSessionId: 'guest-session-stable-1',
    username: '固定访客'
  });
  relay.sendWelcomeMessageToGuest('room-1', thirdGuest.connectionId, '欢迎咨询');

  assert.equal(findEvents(firstSender, 'message:new').length, 1);
  assert.equal(findEvents(secondSender, 'message:new').length, 0);
  assert.equal(findEvents(thirdSender, 'message:new').length, 1);
});

test('空房间欢迎语不会自动发送', () => {
  const relay = new ChatRelayService();
  const guestSender = new MemorySender();
  const guest = relay.connectGuest('room-1', guestSender);

  relay.sendWelcomeMessageToGuest('room-1', guest.connectionId, '   ');

  assert.equal(findEvents(guestSender, 'message:new').length, 0);
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

  assert.equal(findEvents(firstGuestSender, 'message:new').length, 1);
  assert.equal(findEvents(secondGuestSender, 'message:new').length, 0);
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

  assert.equal(findEvents<{ event: string; type: string }>(adminSender, 'message:new')[0].type, 'image');
  assert.equal(findEvents(guestSender, 'message:error').length, 1);
});

test('图片开始事件只转发元数据和预览图且不包含完整图片正文', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(guest.connectionId, {
    type: 'image:start',
    clientMessageId: 'img-start-1',
    payload: {
      imageId: 'image-1',
      mimeType: 'image/png',
      size: 12345,
      chunkSize: 4096,
      totalChunks: 4,
      previewDataUrl: 'data:image/png;base64,cHJldmlldw==',
      dataUrl: 'data:image/png;base64,full-image'
    }
  } as unknown as ClientMessage);

  const adminMessages = findEvents<{
    event: string;
    type: string;
    payload: { previewDataUrl: string; dataUrl?: string };
  }>(adminSender, 'message:new');

  assert.equal(adminMessages.length, 1);
  assert.equal(adminMessages[0].type, 'image:start');
  assert.equal(adminMessages[0].payload.previewDataUrl, 'data:image/png;base64,cHJldmlldw==');
  assert.equal(Object.hasOwn(adminMessages[0].payload, 'dataUrl'), false);
});

test('图片开始事件不阻塞后续文字消息转发', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(guest.connectionId, {
    type: 'image:start',
    clientMessageId: 'img-start-2',
    payload: {
      imageId: 'image-2',
      mimeType: 'image/jpeg',
      size: 8192,
      chunkSize: 4096,
      totalChunks: 2,
      previewDataUrl: 'data:image/jpeg;base64,cHJldmlldw=='
    }
  });
  relay.handleClientMessage(guest.connectionId, {
    type: 'text',
    clientMessageId: 'text-after-image-start',
    payload: { text: '图片还在传，这条文字要先到' }
  });

  const adminMessages = findEvents<{ event: string; type: string; payload: { text?: string } }>(
    adminSender,
    'message:new'
  );

  assert.deepEqual(
    adminMessages.map((message) => message.type),
    ['image:start', 'text']
  );
  assert.equal(adminMessages[1].payload.text, '图片还在传，这条文字要先到');
});

test('图片开始事件会创建媒体传输会话', () => {
  const sessions: unknown[] = [];
  const relay = new ChatRelayService({ onImageStart: (session) => sessions.push(session) });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(admin.connectionId, {
    type: 'image:start',
    clientMessageId: 'img-start-session',
    targetConnectionId: guest.connectionId,
    payload: {
      imageId: 'image-session',
      mimeType: 'image/webp',
      size: 4096,
      chunkSize: 1024,
      totalChunks: 4,
      previewDataUrl: 'data:image/webp;base64,cHJldmlldw=='
    }
  });

  assert.deepEqual(sessions, [
    {
      imageId: 'image-session',
      roomId: 'room-1',
      fromConnectionId: admin.connectionId,
      toConnectionId: guest.connectionId,
      totalChunks: 4,
      chunkSize: 1024,
      size: 4096
    }
  ]);
});

test('图片开始事件拒绝过大的预览图载荷', () => {
  const relay = new ChatRelayService({ maxPreviewBytes: 4 });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(admin.connectionId, {
    type: 'image:start',
    clientMessageId: 'img-start-preview',
    targetConnectionId: guest.connectionId,
    payload: {
      imageId: 'image-preview',
      mimeType: 'image/png',
      size: 4096,
      chunkSize: 1024,
      totalChunks: 4,
      previewDataUrl: `data:image/png;base64,${Buffer.alloc(5).toString('base64')}`
    }
  });

  const errors = findEvents<{ event: string; message: string }>(adminSender, 'message:error');

  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, '图片预览过大');
});

test('图片开始事件允许没有预览图时继续转发占位消息', () => {
  const sessions: unknown[] = [];
  const relay = new ChatRelayService({ onImageStart: (session) => sessions.push(session) });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(admin.connectionId, {
    type: 'image:start',
    clientMessageId: 'img-start-no-preview',
    targetConnectionId: guest.connectionId,
    payload: {
      imageId: 'image-no-preview',
      mimeType: 'image/jpeg',
      size: 4096,
      chunkSize: 1024,
      totalChunks: 4
    }
  } as unknown as ClientMessage);

  const messages = findEvents<{ event: string; type: string; payload: { previewDataUrl?: string } }>(guestSender, 'message:new');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'image:start');
  assert.equal(messages[0].payload.previewDataUrl, undefined);
  assert.equal(sessions.length, 1);
});

test('默认允许发送 5MB 以内图片并拒绝超过限制的图片', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(guest.connectionId, {
    type: 'image',
    clientMessageId: 'img-5mb',
    payload: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.alloc(1024 * 1024 * 5).toString('base64')}` }
  });
  relay.handleClientMessage(guest.connectionId, {
    type: 'image',
    clientMessageId: 'img-over-5mb',
    payload: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.alloc(1024 * 1024 * 5 + 1).toString('base64')}` }
  });

  assert.equal(findEvents<{ event: string; type: string }>(adminSender, 'message:new').length, 1);
  assert.equal(findEvents(guestSender, 'message:error').length, 1);
});

test('转发服务不提供聊天历史列表', () => {
  const relay = new ChatRelayService();

  assert.equal(Object.hasOwn(relay, 'messages'), false);
  assert.equal('getMessages' in relay, false);
});

test('管理员收到房间在线用户快照并在访客进出时刷新', () => {
  const relay = new ChatRelayService({ now: () => new Date('2026-06-10T12:00:00.123Z') });
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.disconnect(guest.connectionId);

  const snapshots = findEvents<{ event: string; users: { connectionId: string; role: string; username: string }[] }>(
    adminSender,
    'room:users'
  );

  assert.equal(snapshots.length, 3);
  assert.deepEqual(
    snapshots[0].users.map((user) => user.connectionId),
    [admin.connectionId]
  );
  assert.deepEqual(
    snapshots[1].users.map((user) => user.connectionId),
    [admin.connectionId, guest.connectionId]
  );
  assert.deepEqual(
    snapshots[2].users.map((user) => user.connectionId),
    [admin.connectionId]
  );
});

test('访客使用稳定浏览器身份重连时保留同一个访客会话标识和名称', () => {
  const relay = new ChatRelayService({ now: () => new Date('2026-06-10T12:00:00.123Z') });
  const firstSender = new MemorySender();
  const secondSender = new MemorySender();

  const firstGuest = relay.connectGuest('room-1', firstSender, {
    guestSessionId: 'guest-session-stable-1',
    username: '用户-固定'
  });
  relay.disconnect(firstGuest.connectionId);
  const secondGuest = relay.connectGuest('room-1', secondSender, {
    guestSessionId: 'guest-session-stable-1',
    username: '用户-固定'
  });

  assert.notEqual(firstGuest.connectionId, secondGuest.connectionId);
  assert.equal(firstGuest.guestSessionId, 'guest-session-stable-1');
  assert.equal(secondGuest.guestSessionId, 'guest-session-stable-1');
  assert.equal(secondGuest.username, '用户-固定');
});
