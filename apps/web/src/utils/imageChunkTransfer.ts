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
 * 将 ArrayBuffer 转为 base64 字符串。
 * @param buffer 二进制分片；核心分支按字节拼接后交给 btoa 编码。
 * @returns 可放入 JSON WebSocket 消息的 base64 文本。
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

/**
 * 将 base64 字符串转回 Uint8Array。
 * @param value base64 分片正文；核心分支逐字节还原，供 Blob 合成使用。
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
    chunks.push({ chunkIndex, totalChunks, data: arrayBufferToBase64(buffer) });
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
  const parts = orderedChunks.map((chunk) => base64ToArrayBuffer(chunk.data));

  return new Blob(parts, { type: mimeType });
}
