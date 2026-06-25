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
    jwtSecret: string;
    adminEntryKey?: string;
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
    adminTokenTtlMs: 24 * 60 * 60 * 1000,
    jwtSecret: 'development-only-jwt-secret-change-before-production',
    adminEntryKey: undefined
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

    const config = {
      server: { ...defaultConfig.server, ...localConfig.server },
      site: { ...defaultConfig.site, ...localConfig.site },
      database: { ...defaultConfig.database, ...localConfig.database },
      bootstrapAdmin: { ...defaultConfig.bootstrapAdmin, ...localConfig.bootstrapAdmin },
      auth: { ...defaultConfig.auth, ...localConfig.auth }
    };

    assertSafeProductionConfig(config);
    return config;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === 'MODULE_NOT_FOUND') {
      assertSafeProductionConfig(defaultConfig);
      return defaultConfig;
    }

    throw error;
  }
}

/**
 * 校验生产环境安全配置。
 * @param config 已合并默认值的应用配置。
 * 核心分支：生产环境禁止继续使用模板或开发用 jwtSecret，避免可预测签名密钥上线。
 */
function assertSafeProductionConfig(config: AppConfig): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (!config.auth.adminEntryKey || !/^[0-9a-f]{32}$/i.test(config.auth.adminEntryKey)) {
    throw new Error('鐢熶骇鐜蹇呴』閰嶇疆 32 浣嶅崄鍏繘鍒剁殑 auth.adminEntryKey');
  }

  if (config.auth.jwtSecret.length < 32 || /change|development|example/i.test(config.auth.jwtSecret)) {
    throw new Error('生产环境必须配置长度至少 32 位且不可使用模板值的 auth.jwtSecret');
  }
}
