# Chat Image Chunk Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build non-blocking chat image delivery where text continues over `/ws/chat` while images transfer in chunks over `/ws/media` with placeholder progress.

**Architecture:** Keep `/ws/chat` as the control channel for text, online users, image start, progress, completion, and failure. Add `/ws/media` as an independent media channel that relays small image chunks by `imageId`, never stores full images server-side, and never blocks text messages.

**Tech Stack:** Node.js, TypeScript, Express HTTP upgrade handling, `ws`, Vue 3, Vite, browser `Blob`/`URL.createObjectURL`, Node test runner with `tsx`.

---

## File Structure

- Modify `src/services/chatRelayService.ts`
  - Add `image:start` control-message support.
  - Keep text routing and online-user snapshots in this service.
  - Expose a small callback hook so media relay failures can notify the same control channel.
- Create `src/services/chatMediaRelayService.ts`
  - Own media WebSocket registration, per-image transfer sessions, chunk validation, chunk forwarding, progress, completion, and failure cleanup.
  - Store only short-lived transfer metadata, never full image bytes.
- Modify `src/ws/chatServer.ts`
  - Continue mounting `/ws/chat`.
  - Pass control-channel dependencies needed by media relay.
- Create `src/ws/mediaServer.ts`
  - Mount `/ws/media`.
  - Reuse room lookup and admin token validation rules.
  - Register media senders and forward chunk messages to `ChatMediaRelayService`.
- Modify `src/server.ts`
  - Instantiate `ChatMediaRelayService`.
  - Attach both chat and media WebSocket servers to the same HTTP server.
- Modify `apps/web/src/types.ts`
  - Extend `ChatMessage` with `imageId`, `imageStatus`, `imageProgress`, and `previewUrl`.
  - Add image transfer utility types.
- Create `apps/web/src/utils/imageChunkTransfer.ts`
  - Split a `Blob` or dataURL into fixed-size base64 chunks.
  - Reassemble received chunks into a `Blob`.
- Create `apps/web/src/utils/mediaSocket.ts`
  - Manage the `/ws/media` client connection.
  - Send queued chunks independently from `/ws/chat`.
  - Receive chunks and progress callbacks.
- Modify `apps/web/src/composables/useChatOnlineApp.ts`
  - Send `image:start` over `/ws/chat`.
  - Send image chunks over `/ws/media`.
  - Add local and remote placeholder messages.
  - Update image progress and replace placeholders with `blob:` URLs when complete.
- Modify `apps/web/src/pages/AdminChatWindowPage.vue` and `apps/web/src/pages/GuestChatWindowPage.vue`
  - Render image placeholders, progress, ready image, and failed state.
- Modify `apps/web/src/styles.css`
  - Add stable placeholder/progress styles.
- Add and modify tests under `test/*.test.ts`.

## Task 1: Backend Control Protocol for `image:start`

**Files:**
- Modify: `src/services/chatRelayService.ts`
- Test: `test/chat-relay-service.test.ts`

- [ ] **Step 1: Write failing tests for `image:start` routing and text independence**

Add these tests to `test/chat-relay-service.test.ts`:

```ts
test('图片开始事件只发送占位信息且不包含完整图片正文', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(admin.connectionId, {
    type: 'image:start',
    clientMessageId: 'image-start-1',
    targetConnectionId: guest.connectionId,
    payload: {
      imageId: 'image-1',
      mimeType: 'image/jpeg',
      size: 2048,
      chunkSize: 32768,
      totalChunks: 1,
      previewDataUrl: 'data:image/jpeg;base64,preview-only'
    }
  });

  const messages = findEvents<{
    event: string;
    type: string;
    payload: { imageId: string; previewDataUrl: string; dataUrl?: string };
  }>(guestSender, 'message:new');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'image:start');
  assert.equal(messages[0].payload.imageId, 'image-1');
  assert.equal(messages[0].payload.previewDataUrl, 'data:image/jpeg;base64,preview-only');
  assert.equal(Object.hasOwn(messages[0].payload, 'dataUrl'), false);
  assert.equal(findEvents(adminSender, 'message:ack').length, 1);
});

test('图片开始事件不会阻塞后续文字消息转发', () => {
  const relay = new ChatRelayService();
  const adminSender = new MemorySender();
  const guestSender = new MemorySender();
  const admin = relay.connectAdmin('room-1', 'admin-1', adminSender);
  const guest = relay.connectGuest('room-1', guestSender);

  relay.handleClientMessage(admin.connectionId, {
    type: 'image:start',
    clientMessageId: 'image-start-2',
    targetConnectionId: guest.connectionId,
    payload: {
      imageId: 'image-2',
      mimeType: 'image/jpeg',
      size: 4096,
      chunkSize: 32768,
      totalChunks: 1,
      previewDataUrl: 'data:image/jpeg;base64,preview'
    }
  });
  relay.handleClientMessage(admin.connectionId, {
    type: 'text',
    clientMessageId: 'text-after-image-start',
    targetConnectionId: guest.connectionId,
    payload: { text: '图片还在传，这条文字要先到' }
  });

  const messages = findEvents<{ event: string; type: string; payload: { text?: string } }>(guestSender, 'message:new');

  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, 'image:start');
  assert.equal(messages[1].type, 'text');
  assert.equal(messages[1].payload.text, '图片还在传，这条文字要先到');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test --import tsx "test/chat-relay-service.test.ts"
```

Expected: FAIL because `ClientMessage` does not accept `image:start` and `validateMessage()` only understands `text` and `image`.

- [ ] **Step 3: Extend backend message types**

In `src/services/chatRelayService.ts`, replace the image branch in `ClientMessage` with:

```ts
  | {
      type: 'image:start';
      clientMessageId: string;
      targetConnectionId?: string;
      payload: {
        imageId: string;
        mimeType: string;
        size: number;
        chunkSize: number;
        totalChunks: number;
        previewDataUrl: string;
      };
    };
```

Keep the current `text` branch. The old full `image` branch will be removed from the control channel in a later task after the frontend switch.

- [ ] **Step 4: Add `image:start` validation**

In `validateMessage()`, handle `image:start`:

```ts
    if (message.type === 'image:start') {
      if (!message.payload.imageId.trim()) {
        return '图片 ID 不能为空';
      }

      if (!['image/png', 'image/jpeg', 'image/webp'].includes(message.payload.mimeType)) {
        return '图片类型不支持';
      }

      if (!Number.isSafeInteger(message.payload.size) || message.payload.size <= 0 || message.payload.size > this.maxImageBytes) {
        return '图片大小超过限制';
      }

      if (!Number.isSafeInteger(message.payload.chunkSize) || message.payload.chunkSize <= 0 || message.payload.chunkSize > 64 * 1024) {
        return '图片分片大小无效';
      }

      if (!Number.isSafeInteger(message.payload.totalChunks) || message.payload.totalChunks <= 0) {
        return '图片分片数量无效';
      }

      const expectedChunks = Math.ceil(message.payload.size / message.payload.chunkSize);
      return expectedChunks === message.payload.totalChunks ? null : '图片分片数量不匹配';
    }
```

- [ ] **Step 5: Run focused test and verify it passes**

Run:

```bash
node --test --import tsx "test/chat-relay-service.test.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit task 1**

Run:

```bash
git add src/services/chatRelayService.ts test/chat-relay-service.test.ts
git commit -m "支持图片开始控制消息"
```

## Task 2: Backend Media Relay Service

**Files:**
- Create: `src/services/chatMediaRelayService.ts`
- Test: `test/chat-media-relay-service.test.ts`

- [ ] **Step 1: Write failing tests for media chunk forwarding**

Create `test/chat-media-relay-service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
node --test --import tsx "test/chat-media-relay-service.test.ts"
```

Expected: FAIL with missing module `chatMediaRelayService`.

- [ ] **Step 3: Create the media relay service**

Create `src/services/chatMediaRelayService.ts`:

```ts
export type MediaRole = 'admin' | 'guest';

export type MediaConnection = {
  connectionId: string;
  roomId: string;
  role: MediaRole;
};

export type MediaSender = {
  send: (message: string) => void;
};

export type ImageChunkMessage = {
  type: 'image:chunk';
  imageId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type ImageTransferSession = {
  imageId: string;
  roomId: string;
  fromConnectionId: string;
  toConnectionId: string;
  totalChunks: number;
  chunkSize: number;
  size: number;
};

type InternalMediaConnection = MediaConnection & {
  sender: MediaSender;
};

type ChatMediaRelayOptions = {
  now?: () => number;
};

type ChunkResult =
  | { ok: true; complete: boolean; receivedChunks: number; totalChunks: number }
  | { ok: false; message: string };

/**
 * 聊天图片媒体分片转发服务。
 * 职责：维护媒体 WebSocket 连接和短暂图片传输会话；关键参数为 imageId、连接 ID 和分片序号；核心分支为直接转发、完成清理和失败拒绝。
 */
export class ChatMediaRelayService {
  private readonly connections = new Map<string, InternalMediaConnection>();
  private readonly transfers = new Map<string, ImageTransferSession & { receivedChunks: Set<number>; updatedAt: number }>();
  private readonly now: () => number;

  constructor(options: ChatMediaRelayOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 注册媒体连接。
   * @param connection 媒体连接摘要。
   * @param sender 消息发送器，生产环境为 WebSocket。
   * @returns 注册后的连接摘要。
   */
  connectMedia(connection: MediaConnection, sender: MediaSender): MediaConnection {
    this.connections.set(connection.connectionId, { ...connection, sender });
    return connection;
  }

  /**
   * 移除媒体连接。
   * @param connectionId 连接 ID。
   */
  disconnectMedia(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * 开始一张图片的短暂传输会话。
   * @param session 传输元数据；核心分支只保存分片路由信息，不保存图片正文。
   */
  startTransfer(session: ImageTransferSession): void {
    this.transfers.set(session.imageId, {
      ...session,
      receivedChunks: new Set<number>(),
      updatedAt: this.now()
    });
  }

  /**
   * 处理并转发图片分片。
   * @param senderConnectionId 发送分片的媒体连接 ID。
   * @param message 图片分片消息；核心分支校验 imageId、发送方、分片序号和目标连接。
   * @returns 分片处理结果。
   */
  handleChunk(senderConnectionId: string, message: ImageChunkMessage): ChunkResult {
    const transfer = this.transfers.get(message.imageId);

    if (!transfer) {
      return { ok: false, message: '图片传输不存在' };
    }

    if (transfer.fromConnectionId !== senderConnectionId) {
      return { ok: false, message: '图片发送方不匹配' };
    }

    if (message.totalChunks !== transfer.totalChunks || message.chunkIndex < 0 || message.chunkIndex >= transfer.totalChunks) {
      return { ok: false, message: '图片分片序号无效' };
    }

    const target = this.connections.get(transfer.toConnectionId);

    if (!target) {
      this.transfers.delete(message.imageId);
      return { ok: false, message: '图片接收方已离线' };
    }

    transfer.receivedChunks.add(message.chunkIndex);
    transfer.updatedAt = this.now();
    target.sender.send(
      JSON.stringify({
        event: 'image:chunk',
        imageId: message.imageId,
        chunkIndex: message.chunkIndex,
        totalChunks: message.totalChunks,
        data: message.data
      })
    );

    const complete = transfer.receivedChunks.size === transfer.totalChunks;

    if (complete) {
      this.transfers.delete(message.imageId);
    }

    return {
      ok: true,
      complete,
      receivedChunks: transfer.receivedChunks.size,
      totalChunks: transfer.totalChunks
    };
  }
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
node --test --import tsx "test/chat-media-relay-service.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit task 2**

Run:

```bash
git add src/services/chatMediaRelayService.ts test/chat-media-relay-service.test.ts
git commit -m "添加图片媒体分片转发服务"
```

## Task 3: Mount `/ws/media`

**Files:**
- Create: `src/ws/mediaServer.ts`
- Modify: `src/server.ts`
- Test: `test/frontendViteStructure.test.ts`

- [ ] **Step 1: Add structure test for `/ws/media` source ownership**

Add assertions to `test/frontendViteStructure.test.ts` or create a focused structure test:

```ts
test('后端必须挂载独立图片媒体 WebSocket 通道', () => {
  const mediaServer = fs.readFileSync(path.join(root, 'src/ws/mediaServer.ts'), 'utf8');
  const serverTs = fs.readFileSync(path.join(root, 'src/server.ts'), 'utf8');

  assert.match(mediaServer, /url\.pathname !== '\\/ws\\/media'/);
  assert.match(mediaServer, /chatMediaRelayService/);
  assert.match(serverTs, /attachMediaServer/);
  assert.match(serverTs, /new ChatMediaRelayService/);
});
```

- [ ] **Step 2: Run the structure test and verify it fails**

Run:

```bash
node --test --import tsx "test/frontendViteStructure.test.ts"
```

Expected: FAIL because `src/ws/mediaServer.ts` does not exist.

- [ ] **Step 3: Create `src/ws/mediaServer.ts`**

Use the same upgrade pattern as `src/ws/chatServer.ts`. The new file should parse `roomId`, `role`, and `token`; verify room exists; verify admin token for admin role; register media connection in `ChatMediaRelayService`; parse JSON chunk messages; and return JSON errors to the sender.

The central connection handler should look like:

```ts
wsServer.on('connection', (socket: WebSocket, _request: IncomingMessage, context: { roomId: string; role: 'admin' | 'guest'; adminSession?: AuthSession }) => {
  const connectionId = context.role === 'admin' && context.adminSession ? context.adminSession.adminId : crypto.randomUUID();
  const sender = { send: (message: string) => socket.send(message) };
  const connection = dependencies.chatMediaRelayService.connectMedia(
    { connectionId, roomId: context.roomId, role: context.role },
    sender
  );

  socket.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString()) as ImageChunkMessage;
      const result = dependencies.chatMediaRelayService.handleChunk(connection.connectionId, message);

      if (!result.ok) {
        socket.send(JSON.stringify({ event: 'image:error', imageId: message.imageId, message: result.message }));
      }
    } catch {
      socket.send(JSON.stringify({ event: 'image:error', message: '图片分片格式错误' }));
    }
  });

  socket.on('close', () => {
    dependencies.chatMediaRelayService.disconnectMedia(connection.connectionId);
    logger.info(`媒体连接已断开：${connection.roomId} ${connection.role}`);
  });
});
```

- [ ] **Step 4: Modify `src/server.ts`**

Instantiate `ChatMediaRelayService` near the existing chat relay service:

```ts
const chatMediaRelayService = new ChatMediaRelayService();
```

Attach both servers:

```ts
attachChatServer(server, { roomService, authService, chatRelayService });
attachMediaServer(server, { roomService, authService, chatMediaRelayService });
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
node --test --import tsx "test/frontendViteStructure.test.ts"
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit task 3**

Run:

```bash
git add src/ws/mediaServer.ts src/server.ts test/frontendViteStructure.test.ts
git commit -m "挂载图片媒体 WebSocket 通道"
```

## Task 4: Frontend Chunk Utility

**Files:**
- Create: `apps/web/src/utils/imageChunkTransfer.ts`
- Test: `test/image-chunk-transfer.test.ts`

- [ ] **Step 1: Write failing chunk utility tests**

Create `test/image-chunk-transfer.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageChunks, assembleImageChunks } from '../apps/web/src/utils/imageChunkTransfer';

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
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
node --test --import tsx "test/image-chunk-transfer.test.ts"
```

Expected: FAIL with missing module `imageChunkTransfer`.

- [ ] **Step 3: Create `imageChunkTransfer.ts`**

Create `apps/web/src/utils/imageChunkTransfer.ts`:

```ts
export type ImageChunk = {
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type PreparedImageChunks = {
  imageId: string;
  mimeType: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  chunks: ImageChunk[];
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * 创建图片分片。
 * @param blob 图片二进制数据。
 * @param chunkSize 每个分片字节数；核心分支按固定大小切分并保留序号。
 * @returns 可通过媒体 WebSocket 发送的分片集合。
 */
export async function createImageChunks(blob: Blob, chunkSize: number): Promise<PreparedImageChunks> {
  const totalChunks = Math.ceil(blob.size / chunkSize);
  const chunks: ImageChunk[] = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(blob.size, start + chunkSize);
    const buffer = await blob.slice(start, end).arrayBuffer();
    chunks.push({ chunkIndex, totalChunks, data: arrayBufferToBase64(buffer) });
  }

  return {
    imageId: crypto.randomUUID(),
    mimeType: blob.type,
    size: blob.size,
    chunkSize,
    totalChunks,
    chunks
  };
}

/**
 * 合成图片分片。
 * @param chunks 已收到的图片分片。
 * @param mimeType 图片 MIME 类型；核心分支会按 chunkIndex 排序后合成 Blob。
 * @returns 合成后的图片 Blob。
 */
export async function assembleImageChunks(chunks: ImageChunk[], mimeType: string): Promise<Blob> {
  const orderedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const parts = orderedChunks.map((chunk) => base64ToUint8Array(chunk.data));

  return new Blob(parts, { type: mimeType });
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
node --test --import tsx "test/image-chunk-transfer.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit task 4**

Run:

```bash
git add apps/web/src/utils/imageChunkTransfer.ts test/image-chunk-transfer.test.ts
git commit -m "添加前端图片分片工具"
```

## Task 5: Frontend Media Socket and Message State

**Files:**
- Create: `apps/web/src/utils/mediaSocket.ts`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/composables/useChatOnlineApp.ts`
- Test: `test/frontendViteStructure.test.ts`

- [ ] **Step 1: Add structure assertions**

Extend `test/frontendViteStructure.test.ts`:

```ts
assert.match(frontEndSource, /createMediaSocket/);
assert.match(frontEndSource, /imageStatus/);
assert.match(frontEndSource, /imageProgress/);
assert.match(frontEndSource, /image:start/);
assert.match(frontEndSource, /image:chunk/);
assert.doesNotMatch(frontEndSource, /type:\s*'image'[\s\S]*dataUrl:\s*image\.dataUrl/);
```

- [ ] **Step 2: Run structure test and verify it fails**

Run:

```bash
node --test --import tsx "test/frontendViteStructure.test.ts"
```

Expected: FAIL because frontend still sends complete image data through `/ws/chat`.

- [ ] **Step 3: Extend `ChatMessage`**

In `apps/web/src/types.ts`, add:

```ts
  imageId?: string;
  imageStatus?: 'loading' | 'ready' | 'failed';
  imageProgress?: number;
  previewUrl?: string;
```

to `ChatMessage`.

- [ ] **Step 4: Create `mediaSocket.ts`**

Create `apps/web/src/utils/mediaSocket.ts` with a small factory:

```ts
import type { ImageChunk } from './imageChunkTransfer';

export type MediaSocketHandlers = {
  onChunk: (message: { imageId: string; chunkIndex: number; totalChunks: number; data: string }) => void;
  onError: (message: { imageId?: string; message?: string }) => void;
};

/**
 * 创建图片媒体 WebSocket 客户端。
 * @param url 媒体 WebSocket 地址。
 * @param handlers 媒体事件处理器；核心分支为接收图片分片和错误事件。
 * @returns 连接控制和分片发送方法。
 */
export function createMediaSocket(url: string, handlers: MediaSocketHandlers) {
  const socket = new WebSocket(url);

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data) as {
      event: string;
      imageId?: string;
      chunkIndex?: number;
      totalChunks?: number;
      data?: string;
      message?: string;
    };

    if (data.event === 'image:chunk' && data.imageId && typeof data.chunkIndex === 'number' && typeof data.totalChunks === 'number' && data.data) {
      handlers.onChunk({ imageId: data.imageId, chunkIndex: data.chunkIndex, totalChunks: data.totalChunks, data: data.data });
      return;
    }

    if (data.event === 'image:error') {
      handlers.onError({ imageId: data.imageId, message: data.message });
    }
  });

  return {
    socket,
    sendChunk(imageId: string, chunk: ImageChunk): void {
      socket.send(JSON.stringify({ type: 'image:chunk', imageId, ...chunk }));
    },
    isOpen(): boolean {
      return socket.readyState === WebSocket.OPEN;
    }
  };
}
```

- [ ] **Step 5: Modify `useChatOnlineApp.ts` send flow**

Replace complete image sending with:

```ts
const preparedChunks = await createImageChunks(compressedBlob, 32 * 1024);
socketRef.value?.send(JSON.stringify({
  type: 'image:start',
  clientMessageId,
  targetConnectionId,
  payload: {
    imageId: preparedChunks.imageId,
    mimeType: preparedChunks.mimeType,
    size: preparedChunks.size,
    chunkSize: preparedChunks.chunkSize,
    totalChunks: preparedChunks.totalChunks,
    previewDataUrl: image.dataUrl
  }
}));
preparedChunks.chunks.forEach((chunk) => mediaSocket.sendChunk(preparedChunks.imageId, chunk));
```

The implementation should keep the existing local message append, but set `imageStatus: 'loading'`, `imageProgress: 0`, and `previewUrl`.

- [ ] **Step 6: Handle received `image:start` and `image:chunk`**

In both admin and guest socket message handlers:

```ts
if (data.type === 'image:start') {
  append image placeholder with imageId, imageStatus: 'loading', imageProgress: 0, previewUrl: data.payload?.previewDataUrl;
  return;
}
```

In media socket `onChunk`, store chunks by `imageId`, update `imageProgress`, and call `assembleImageChunks()` when all chunks are present.

- [ ] **Step 7: Run focused checks**

Run:

```bash
node --test --import tsx "test/frontendViteStructure.test.ts"
npm run web:check
```

Expected: PASS.

- [ ] **Step 8: Commit task 5**

Run:

```bash
git add apps/web/src/types.ts apps/web/src/utils/mediaSocket.ts apps/web/src/composables/useChatOnlineApp.ts test/frontendViteStructure.test.ts
git commit -m "前端接入图片媒体通道"
```

## Task 6: Placeholder UI

**Files:**
- Modify: `apps/web/src/pages/AdminChatWindowPage.vue`
- Modify: `apps/web/src/pages/GuestChatWindowPage.vue`
- Modify: `apps/web/src/styles.css`
- Test: `test/frontendViteStructure.test.ts`

- [ ] **Step 1: Add structure assertions for placeholder UI**

In `test/frontendViteStructure.test.ts`, add:

```ts
assert.match(frontEndSource, /imageStatus === 'loading'/);
assert.match(frontEndSource, /image-progress/);
assert.match(stylesCss, /\.image-progress/);
assert.match(stylesCss, /\.message-image-placeholder/);
```

- [ ] **Step 2: Run structure test and verify it fails**

Run:

```bash
node --test --import tsx "test/frontendViteStructure.test.ts"
```

Expected: FAIL because placeholder UI classes do not exist.

- [ ] **Step 3: Update message image templates**

In both page components, replace the simple image block with:

```vue
<button v-if="message.imageUrl" class="message-image-button" type="button" @click="emit('open-image-preview', message)">
  <img class="message-image" :src="message.imageUrl" :alt="message.text" />
</button>
<div v-else-if="message.imageStatus === 'loading'" class="message-image-placeholder">
  <img v-if="message.previewUrl" class="message-image preview" :src="message.previewUrl" :alt="message.text" />
  <span class="image-progress">图片加载中 {{ message.imageProgress ?? 0 }}%</span>
</div>
<div v-else-if="message.imageStatus === 'failed'" class="message-image-placeholder failed">
  <span>图片加载失败</span>
</div>
<template v-else>{{ message.text }}</template>
```

- [ ] **Step 4: Add stable styles**

In `apps/web/src/styles.css`, add:

```css
.message-image-placeholder {
  width: min(240px, 64vw);
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: #e5e7eb;
  color: #475569;
  font-size: 13px;
}

.message-image-placeholder.failed {
  background: #fee2e2;
  color: #b91c1c;
}

.message-image.preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.72;
}

.image-progress {
  position: absolute;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
}
```

- [ ] **Step 5: Run frontend tests and check**

Run:

```bash
node --test --import tsx "test/frontendViteStructure.test.ts"
npm run web:check
```

Expected: PASS.

- [ ] **Step 6: Commit task 6**

Run:

```bash
git add apps/web/src/pages/AdminChatWindowPage.vue apps/web/src/pages/GuestChatWindowPage.vue apps/web/src/styles.css test/frontendViteStructure.test.ts
git commit -m "添加图片占位加载状态"
```

## Task 7: End-to-End Verification and Cleanup

**Files:**
- Modify as needed: touched source and test files only.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm run test
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run backend TypeScript check**

Run:

```bash
npm run check
```

Expected: exit code 0.

- [ ] **Step 3: Run frontend TypeScript check**

Run:

```bash
npm run web:check
```

Expected: exit code 0.

- [ ] **Step 4: Run frontend production build**

Run:

```bash
npm run web:build
```

Expected: Vite build succeeds and writes `apps/web/dist`.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan are modified.

- [ ] **Step 6: Commit verification cleanup if any**

If Step 5 shows cleanup changes, commit them:

```bash
git add <exact-cleanup-files>
git commit -m "完善图片分片传输验证"
```

If there are no cleanup changes, do not create an empty commit.

## Self-Review

- Spec coverage: The plan implements separate `/ws/chat` and `/ws/media`, immediate placeholders, chunk progress, failure semantics, no server-side persistence, and tests for text independence.
- Placeholder scan: The plan contains no unresolved placeholder markers or unspecified implementation steps.
- Type consistency: `imageId`, `imageStatus`, `imageProgress`, `previewUrl`, `image:start`, and `image:chunk` are introduced before later tasks use them.
