# 聊天图片分片传输设计

## 背景与目标

当前图片消息通过 `/ws/chat` 发送完整 dataURL。实际公网环境中，图片可能在浏览器、Cloudflare Tunnel、OpenResty 或 WebSocket 连接上耗时很久才到达 Node 服务端。由于 WebSocket 单连接按顺序传输，大图片帧会阻塞后续文字消息，导致“图片没发完，文字也发不出去”。

本设计目标是把文字和图片传输彻底解耦：文字消息必须始终通过控制通道即时发送；图片通过独立媒体通道分片传输；接收方在图片未加载完成前先看到占位和进度，图片逐步加载，不影响双方继续聊天。

## 核心约束

- 服务端仍然只做实时转发，不保存聊天内容。
- 图片分片只存在于两端浏览器内存和 Node 进程内存的短暂转发路径中，不写入数据库、文件或长期缓存。
- 文字消息和图片分片必须使用不同 WebSocket 连接，避免单连接有序传输导致相互阻塞。
- 图片开始、进度、完成、失败等状态必须通过控制通道同步，便于对方立即显示占位。
- 图片分片通道断开时，只影响当前图片传输，不应影响文字通道继续工作。
- 管理员发给访客时仍必须指定目标访客连接 ID；访客发给管理员时仍按房间内管理员连接路由。
- 图片格式继续限制为 PNG、JPEG、WebP，单图大小限制保持可配置，第一版沿用当前 5MB 上限。

## 推荐架构

系统新增一个媒体 WebSocket 通道：

```text
/ws/chat   控制通道：文字、图片开始、图片进度、图片完成、图片失败、ack、在线用户列表
/ws/media  媒体通道：图片分片上传和转发
```

`/ws/chat` 保持现有连接和鉴权语义，负责所有轻量消息。`/ws/media` 使用与 `/ws/chat` 相同的 `roomId`、`role`、`token` 查询参数建立连接，但只处理图片分片。两条连接分别由浏览器维护，互不等待。

后端新增 `ChatMediaRelayService` 管理媒体连接和图片传输会话。该服务只维护图片传输中的临时状态，例如 `imageId`、发送方、接收方、已收到分片数量和最近活动时间。传输完成或失败后立即释放状态。

## 前端状态模型

`ChatMessage` 增加图片传输状态字段：

```ts
type ChatMessage = {
  from: MessageFrom;
  text: string;
  time: string;
  imageUrl?: string;
  mimeType?: string;
  imageId?: string;
  imageStatus?: 'loading' | 'ready' | 'failed';
  imageProgress?: number;
  previewUrl?: string;
};
```

发送方选择图片后仍可先做压缩和缩略图生成，但发送时不再把完整 dataURL 放入 `/ws/chat`。发送方本地立即追加一条图片消息，状态为 `loading`，用于显示“发送中”和进度。接收方收到 `image:start` 后也立即追加一条图片占位消息。

图片完成后，接收端将分片合并为 `Blob`，生成 `blob:` URL 写入 `imageUrl`，并把 `imageStatus` 改为 `ready`。失败时改为 `failed`，展示“图片加载失败”。

## 控制通道协议

### 文字消息

文字消息继续沿用现有格式：

```json
{
  "type": "text",
  "clientMessageId": "local-message-id",
  "targetConnectionId": "guest-connection-id",
  "payload": {
    "text": "你好"
  }
}
```

### 图片开始

图片开始事件走 `/ws/chat`：

```json
{
  "type": "image:start",
  "clientMessageId": "local-image-message-id",
  "targetConnectionId": "guest-connection-id",
  "payload": {
    "imageId": "image-uuid",
    "mimeType": "image/jpeg",
    "size": 2030000,
    "chunkSize": 32768,
    "totalChunks": 62,
    "previewDataUrl": "data:image/jpeg;base64,..."
  }
}
```

服务端校验目标在线、图片类型、图片大小、分片数量后，立即向接收方转发 `message:new`，其中 `type` 为 `image:start`。接收方据此显示占位和初始进度。

### 图片进度

服务端可以按一定节流频率通过 `/ws/chat` 转发进度，例如每收到 5 个分片或进度变化超过 5% 时发送：

```json
{
  "event": "image:progress",
  "imageId": "image-uuid",
  "receivedChunks": 12,
  "totalChunks": 62,
  "progress": 19
}
```

第一版也可以由接收端按实际收到分片自行计算进度，服务端只在关键节点发送开始、完成和失败。为了界面稳定，推荐前后端都支持进度事件，但不依赖它完成图片合成。

### 图片完成

所有分片成功到达接收方后，接收方本地合成图片。服务端在转发完最后一个分片后，通过控制通道发送：

```json
{
  "event": "image:complete",
  "imageId": "image-uuid"
}
```

接收方若已收齐分片，则将占位替换为完整图片。若缺少分片，则保留加载状态并等待短暂超时，超时后显示失败。

### 图片失败

任何一端断开、目标离线、分片超时、大小不一致或校验失败时，通过控制通道发送：

```json
{
  "event": "image:error",
  "imageId": "image-uuid",
  "message": "图片传输中断"
}
```

接收方将对应消息标记为 `failed`。文字消息不受影响。

## 媒体通道协议

媒体连接地址：

```text
/ws/media?role=admin|guest&roomId=<roomId>&token=<adminToken>
```

管理员连接必须携带 token，访客连接不需要 token。鉴权和房间校验规则与 `/ws/chat` 保持一致。

图片分片消息示例：

```json
{
  "type": "image:chunk",
  "imageId": "image-uuid",
  "chunkIndex": 0,
  "totalChunks": 62,
  "data": "base64-chunk"
}
```

第一版可以继续使用 JSON + base64 分片，避免一次性大 JSON 帧阻塞连接。每个分片建议 32KB。后续如果需要进一步优化，可以把媒体通道升级为二进制 frame，但控制协议不需要改变。

服务端收到一个分片后，只校验 `imageId`、分片序号和传输会话是否存在，然后立即转发给目标媒体连接。服务端不需要等图片全部收齐，也不需要保存完整图片。

## 数据流

发送图片时的完整流程：

1. 发送方压缩图片并生成小缩略图。
2. 发送方通过 `/ws/chat` 发送 `image:start`。
3. 发送方本地消息列表立即出现图片占位。
4. 接收方收到 `image:start`，聊天窗口立即出现图片占位和 0% 进度。
5. 发送方通过 `/ws/media` 按 32KB 分片发送图片数据。
6. 服务端收到每个分片后立即转发给目标媒体连接。
7. 接收方每收到一个分片更新进度。
8. 所有分片收齐后，接收方合成 Blob，生成 `blob:` URL 展示图片。
9. 图片完成或失败状态通过 `/ws/chat` 同步，双方消息状态收敛。

文字消息全程只走 `/ws/chat`，不等待图片分片、图片完成或媒体连接状态。

## 后端模块改动

### `src/ws/chatServer.ts`

继续负责 `/ws/chat`。需要新增对 `image:start` 的解析和转发。该文件只处理控制消息，不处理图片分片正文。

### `src/ws/mediaServer.ts`

新增媒体 WebSocket 挂载函数。职责是接收 `/ws/media` upgrade、复用房间和管理员鉴权逻辑、注册媒体连接、接收图片分片并交给媒体转发服务。

### `src/services/chatRelayService.ts`

继续管理文字、在线用户和图片控制事件。新增 `image:start` 校验和控制事件转发，不保存完整图片。

### `src/services/chatMediaRelayService.ts`

新增图片分片转发服务。职责是维护媒体连接、传输会话和短暂进度状态。关键参数包括 `imageId`、房间 ID、发送方连接、目标连接、分片总数和分片大小。

核心分支：

- 媒体连接注册和断开。
- 根据 `imageId` 找到目标媒体连接并转发分片。
- 目标媒体连接不存在时通过控制通道返回失败。
- 分片序号越界、总数不一致、大小超过限制时失败。
- 图片传输完成或失败时清理临时状态。

## 前端模块改动

### `apps/web/src/utils/imageChunkTransfer.ts`

新增图片分片工具。职责是将 dataURL 或 Blob 切成固定大小分片，并在接收侧按 `chunkIndex` 合成 Blob。

### `apps/web/src/utils/mediaSocket.ts`

新增媒体 WebSocket 管理工具。职责是建立 `/ws/media` 连接、断线重连、发送分片队列、接收分片、派发进度事件。

### `apps/web/src/composables/useChatOnlineApp.ts`

发送图片时改为：

- 先通过 `/ws/chat` 发送 `image:start`。
- 再把图片交给媒体通道分片发送。
- 文字消息仍通过 `/ws/chat` 直接发送。
- 接收 `image:start` 时追加占位。
- 接收媒体分片时更新对应 `ChatMessage.imageProgress`。
- 完成后把占位替换为完整图片 URL。

## UI 行为

图片占位在聊天窗口中表现为一个稳定大小的图片气泡。占位内容包括：

- 缩略图或灰色背景。
- 进度百分比。
- 失败状态文案。

发送方和接收方都能继续发送文字。图片进度更新不改变消息顺序，不挤压其他消息布局。

## 错误处理

- 媒体连接未建立：图片消息进入失败状态，文字通道继续可用。
- 目标用户离线：`image:start` 阶段直接失败，不开始发送分片。
- 传输中目标断开：双方对应图片消息变为失败。
- 分片超时：服务端清理传输会话，通知双方失败。
- 分片缺失：接收端不合成图片，等待超时后失败。
- 图片过大：`image:start` 阶段拒绝。
- MIME 不支持：`image:start` 阶段拒绝。

## 日志与观测

后端日志只记录：

- 媒体连接建立和断开。
- `image:start` 的图片大小、分片数量和目标角色。
- 分片转发进度摘要，例如每 10 个分片或每 10% 记录一次。
- 完成耗时和失败原因。

日志不得输出图片正文、完整 base64 或用户聊天内容。

前端控制台日志记录：

- 图片压缩耗时和压缩后大小。
- `image:start` ack 时间。
- 分片发送进度。
- 媒体连接断开和重连。

## 测试范围

新增测试覆盖：

- 图片开始事件只在目标在线时转发。
- 图片分片通过媒体服务转发，不经过文字消息队列。
- 文字消息在图片分片传输中仍可立即转发。
- 图片分片缺失或序号越界时返回失败。
- 目标媒体连接断开时图片失败，但文字通道不受影响。
- 接收端按分片顺序合成 Blob，并在完成前保持占位。
- 浏览器历史缓存不保存图片分片正文。

## 分阶段实施

第一阶段实现 JSON + base64 分片，重点解决文字阻塞和占位进度。该阶段不引入服务端文件存储，也不做断点续传。

第二阶段如果公网仍存在明显瓶颈，再将 `/ws/media` 的分片格式升级为二进制 frame，减少 base64 膨胀。

第三阶段如果需要离线重试或跨刷新恢复，再讨论临时对象存储、过期清理和权限访问，不在本设计第一版范围内。

## 非目标

- 不保存服务端聊天记录。
- 不把图片写入 PostgreSQL。
- 不把图片保存到服务器磁盘。
- 不做离线图片投递。
- 不做多实例媒体路由同步。
- 不在第一版实现断点续传。
