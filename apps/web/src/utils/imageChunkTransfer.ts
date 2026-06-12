export type ImageChunk = {
  chunkIndex: number;
  totalChunks: number;
  data: ArrayBuffer;
};

export type PreparedImageChunks = {
  imageId: string;
  mimeType: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  chunks: ImageChunk[];
};

export type DecodedImageChunkFrame = {
  imageId: string;
  chunkIndex: number;
  totalChunks: number;
  data: ArrayBuffer;
};

/**
 * 生成图片传输 ID。
 * 核心分支：优先使用浏览器原生 randomUUID；旧浏览器退回 getRandomValues，避免图片发送在生成 ID 阶段中断。
 */
function createImageTransferId(): string {
  const browserCrypto = globalThis.crypto;

  if (typeof browserCrypto?.randomUUID === 'function') {
    return browserCrypto.randomUUID();
  }

  if (typeof browserCrypto?.getRandomValues === 'function') {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

    return `image-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 将 base64 字符串转回 Uint8Array。
 * @param value dataURL 中的 base64 正文；核心分支逐字节还原，供 Blob 合成使用。
 * @returns 分片二进制数据。
 */
function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * 截取 Uint8Array 背后的精确 ArrayBuffer。
 * @param bytes 待截取的字节视图；核心分支避免把底层更大的共享 buffer 一并传出。
 * @returns 与视图范围完全一致的 ArrayBuffer。
 */
function sliceExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
}

/**
 * 将图片分片编码为单个二进制 WebSocket 帧。
 * @param imageId 图片传输 ID。
 * @param chunk 图片分片；核心分支在前 4 字节写入元数据长度，随后拼接 UTF-8 JSON 元数据和原始图片字节。
 * @returns 可直接通过 WebSocket.send 发送的二进制帧。
 */
export function encodeImageChunkFrame(imageId: string, chunk: ImageChunk): ArrayBuffer {
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      type: 'image:chunk',
      imageId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks
    })
  );
  const payload = new Uint8Array(chunk.data);
  const frame = new Uint8Array(4 + metadata.byteLength + payload.byteLength);
  const view = new DataView(frame.buffer);

  view.setUint32(0, metadata.byteLength);
  frame.set(metadata, 4);
  frame.set(payload, 4 + metadata.byteLength);

  return frame.buffer;
}

/**
 * 解析图片分片二进制 WebSocket 帧。
 * @param frame 收到的二进制帧；核心分支先读取元数据长度，再解析 JSON 元数据和图片原始字节。
 * @returns 解码后的图片分片。
 */
export function decodeImageChunkFrame(frame: ArrayBuffer): DecodedImageChunkFrame {
  if (frame.byteLength < 4) {
    throw new Error('图片分片格式错误');
  }

  const view = new DataView(frame);
  const metadataLength = view.getUint32(0);
  const metadataStart = 4;
  const metadataEnd = metadataStart + metadataLength;

  if (metadataLength <= 0 || metadataEnd > frame.byteLength) {
    throw new Error('图片分片格式错误');
  }

  const bytes = new Uint8Array(frame);
  const metadata = JSON.parse(new TextDecoder().decode(bytes.slice(metadataStart, metadataEnd))) as {
    type?: string;
    imageId?: string;
    chunkIndex?: number;
    totalChunks?: number;
  };

  if (
    metadata.type !== 'image:chunk' ||
    !metadata.imageId ||
    typeof metadata.chunkIndex !== 'number' ||
    typeof metadata.totalChunks !== 'number'
  ) {
    throw new Error('图片分片格式错误');
  }

  return {
    imageId: metadata.imageId,
    chunkIndex: metadata.chunkIndex,
    totalChunks: metadata.totalChunks,
    data: sliceExactArrayBuffer(bytes.slice(metadataEnd))
  };
}

/**
 * 将 dataURL 转为 Blob。
 * @param dataUrl 图片 dataURL；核心分支解析 MIME 和 base64 正文，供现有待发送图片草稿复用。
 * @returns 可继续分片传输的 Blob。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, base64 = ''] = dataUrl.split(',');
  const mimeType = metadata.match(/^data:([^;]+);base64$/)?.[1] ?? 'application/octet-stream';

  return new Blob([base64ToArrayBuffer(base64)], { type: mimeType });
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
    chunks.push({ chunkIndex, totalChunks, data: buffer });
  }

  return {
    imageId: createImageTransferId(),
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
  const parts = orderedChunks.map((chunk) => chunk.data);

  return new Blob(parts, { type: mimeType });
}
