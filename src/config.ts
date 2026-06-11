import path from 'node:path';

export type AppConfig = {
  server: {
    port: number;
  };
  site: {
    protocol: string;
    host: string;
  };
  database: {
    connectionString: string;
  };
  bootstrapAdmin: {
    username: string;
    password: string;
  };
  auth: {
    adminTokenTtlMs: number;
  };
};

const defaultConfig: AppConfig = {
  server: {
    port: 30007
  },
  site: {
    protocol: 'http',
    host: 'localhost:5173'
  },
  database: {
    connectionString: 'postgres://postgres:postgres@localhost:5432/chat_online'
  },
  bootstrapAdmin: {
    username: 'admin',
    password: 'change-me'
  },
  auth: {
    adminTokenTtlMs: 24 * 60 * 60 * 1000
  }
};

/**
 * 加载本地配置文件。
 * @returns 合并默认值后的应用配置；当 config.js 不存在时使用安全默认值。
 * 核心分支：存在本地配置则覆盖默认值，不存在时保持模板默认值便于测试启动。
 */
export function loadConfig(): AppConfig {
  try {
    const localConfigPath = path.resolve(process.cwd(), 'config.js');
    const localConfig = require(localConfigPath) as Partial<AppConfig>;

    return {
      server: { ...defaultConfig.server, ...localConfig.server },
      site: { ...defaultConfig.site, ...localConfig.site },
      database: { ...defaultConfig.database, ...localConfig.database },
      bootstrapAdmin: { ...defaultConfig.bootstrapAdmin, ...localConfig.bootstrapAdmin },
      auth: { ...defaultConfig.auth, ...localConfig.auth }
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === 'MODULE_NOT_FOUND') {
      return defaultConfig;
    }

    throw error;
  }
}
