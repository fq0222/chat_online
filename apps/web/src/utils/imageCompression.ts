/// <reference lib="dom" />

type ImageBitmapLike = {
  width: number;
  height: number;
  close?: () => void;
};

type ImageCanvasLike = {
  width: number;
  height: number;
  getContext: (contextId: '2d') => {
    drawImage: (image: unknown, dx: number, dy: number, targetWidth: number, targetHeight: number) => void;
  } | null;
  toBlob: (callback: (blob: Blob | null) => void, mimeType: string, quality: number) => void;
};

type ImageCompressionDependencies = {
  createImageBitmap: (source: Blob) => Promise<ImageBitmapLike>;
  createCanvas: (width: number, height: number) => ImageCanvasLike;
  readAsDataUrl: (blob: Blob) => Promise<string>;
  now: () => number;
};

export type ImageCompressionOptions = {
  maxWidth: number;
  maxHeight: number;
  outputMimeType: 'image/webp' | 'image/jpeg';
  quality: number;
};

export type CompressedChatImage = {
  dataUrl: string;
  mimeType: string;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
  durationMs: number;
};

const defaultCompressionOptions: ImageCompressionOptions = {
  maxWidth: 960,
  maxHeight: 960,
  outputMimeType: 'image/webp',
  quality: 0.58
};

/**
 * 计算聊天图片压缩后的展示尺寸。
 * @param options 原始宽高与最大宽高；核心分支为大图等比缩小，小图保持原尺寸。
 * @returns 压缩目标尺寸。
 */
export function getCompressedImageDimensions(options: {
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
}): { width: number; height: number } {
  const scale = Math.min(1, options.maxWidth / options.width, options.maxHeight / options.height);

  return {
    width: Math.max(1, Math.round(options.width * scale)),
    height: Math.max(1, Math.round(options.height * scale))
  };
}

/**
 * 读取二进制图片为 dataURL。
 * @param blob 图片二进制数据；核心分支为 FileReader 成功时返回 dataURL，失败时抛出错误。
 * @returns 可用于图片预览和 WebSocket 转发的 dataURL 字符串。
 */
export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('图片读取失败，请重新选择。'));
    });
    reader.addEventListener('error', () => {
      reject(new Error('图片读取失败，请重新选择。'));
    });
    reader.readAsDataURL(blob);
  });
}

/**
 * 创建浏览器画布压缩输出。
 * @param canvas 已绘制目标图片的画布。
 * @param mimeType 输出图片 MIME 类型。
 * @param quality 压缩质量；核心分支为浏览器返回空 blob 时抛出可展示错误。
 * @returns 压缩后的图片二进制数据。
 */
function createCompressedBlob(canvas: ImageCanvasLike, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('图片压缩失败，请重新选择。'));
    }, mimeType, quality);
  });
}

/**
 * 判断浏览器输出是否符合请求的图片格式。
 * @param blob 浏览器压缩后的二进制结果。
 * @param requestedMimeType 请求输出的 MIME 类型；核心分支为 Safari 等浏览器可能回退 PNG，需要识别后再兜底。
 * @returns true 表示浏览器实际输出格式符合请求。
 */
function isExpectedOutputMimeType(blob: Blob, requestedMimeType: string): boolean {
  return !blob.type || blob.type === requestedMimeType;
}

/**
 * 压缩聊天图片并转换为 dataURL。
 * @param source 本地图片文件或二进制对象。
 * @param options 压缩配置；核心分支限制最大宽高、输出格式和质量。
 * @param dependencies 浏览器 API 依赖；测试时可注入假实现，生产环境默认使用 createImageBitmap、canvas 和 FileReader。
 * @returns 压缩后的 dataURL、尺寸和耗时统计。
 */
export async function compressImageFileForChat(
  source: Blob,
  options: Partial<ImageCompressionOptions> = {},
  dependencies: Partial<ImageCompressionDependencies> = {}
): Promise<CompressedChatImage> {
  const compressionOptions = { ...defaultCompressionOptions, ...options };
  const now = dependencies.now ?? (() => performance.now());
  const createCanvas =
    dependencies.createCanvas ??
    ((width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      return {
        width,
        height,
        getContext: () => {
          const context = canvas.getContext('2d');

          if (!context) {
            return null;
          }

          return {
            drawImage: (image: unknown, dx: number, dy: number, targetWidth: number, targetHeight: number) => {
              context.drawImage(image as CanvasImageSource, dx, dy, targetWidth, targetHeight);
            }
          };
        },
        toBlob: (callback: (blob: Blob | null) => void, mimeType: string, quality: number) => {
          canvas.toBlob(callback, mimeType, quality);
        }
      };
    });
  const deps: ImageCompressionDependencies = {
    createImageBitmap: dependencies.createImageBitmap ?? ((imageSource) => createImageBitmap(imageSource)),
    createCanvas,
    readAsDataUrl: dependencies.readAsDataUrl ?? readBlobAsDataUrl,
    now
  };

  const startedAt = deps.now();
  const bitmap = await deps.createImageBitmap(source);

  try {
    const dimensions = getCompressedImageDimensions({
      width: bitmap.width,
      height: bitmap.height,
      maxWidth: compressionOptions.maxWidth,
      maxHeight: compressionOptions.maxHeight
    });
    const canvas = deps.createCanvas(dimensions.width, dimensions.height);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('图片压缩失败，请重新选择。');
    }

    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const primaryBlob = await createCompressedBlob(canvas, compressionOptions.outputMimeType, compressionOptions.quality);
    const compressedBlob =
      compressionOptions.outputMimeType === 'image/webp' && !isExpectedOutputMimeType(primaryBlob, compressionOptions.outputMimeType)
        ? await createCompressedBlob(canvas, 'image/jpeg', compressionOptions.quality)
        : primaryBlob;
    const dataUrl = await deps.readAsDataUrl(compressedBlob);

    return {
      dataUrl,
      mimeType: compressedBlob.type || compressionOptions.outputMimeType,
      originalBytes: source.size,
      compressedBytes: compressedBlob.size,
      width: dimensions.width,
      height: dimensions.height,
      durationMs: Math.round(deps.now() - startedAt)
    };
  } finally {
    bitmap.close?.();
  }
}
