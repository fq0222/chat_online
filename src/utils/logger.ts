export type LoggerWriter = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * 获取上海时区本地时间字符串。
 * 职责：统一日志时间格式；无参数；核心分支由运行环境的 Intl 实现处理。
 */
export function getLocalTime(): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 创建指定模块的日志工具。
 * @param moduleName 模块名称，会写入每一条日志前缀。
 * @param writer 可选输出器，测试时可注入内存输出，默认使用 console。
 * @returns 包含 info、warn、error 三种级别的日志工具。
 */
export function createLogger(moduleName: string, writer: LoggerWriter = console): Logger {
  const format = (level: 'INFO' | 'WARN' | 'ERROR', message: string) => {
    return `[${moduleName}] [${level}] ${getLocalTime()} - ${message}`;
  };

  return {
    info: (message: string) => writer.info(format('INFO', message)),
    warn: (message: string) => writer.warn(format('WARN', message)),
    error: (message: string) => writer.error(format('ERROR', message))
  };
}
