export type FrontendLoggerWriter = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type FrontendLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * 获取上海时区前端日志时间。
 * 职责：统一浏览器控制台日志时间；无参数；核心分支依赖浏览器 Intl 输出本地化时间。
 */
function getFrontendLocalTime(): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 创建前端日志工具。
 * @param moduleName 模块名称，会写入每条日志前缀。
 * @param writer 输出器；核心分支为生产环境写入 console，测试可注入内存输出。
 * @returns 包含 info、warn、error 三种级别的日志方法。
 */
export function createFrontendLogger(moduleName: string, writer: FrontendLoggerWriter = console): FrontendLogger {
  const format = (level: 'INFO' | 'WARN' | 'ERROR', message: string) => {
    return `[${moduleName}] [${level}] ${getFrontendLocalTime()} - ${message}`;
  };

  return {
    info: (message: string) => writer.info(format('INFO', message)),
    warn: (message: string) => writer.warn(format('WARN', message)),
    error: (message: string) => writer.error(format('ERROR', message))
  };
}
