import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './pool';
import { createLogger } from '../utils/logger';

const logger = createLogger('数据库迁移');

/**
 * 执行数据库迁移脚本。
 * 职责：按文件名顺序执行 SQL；关键参数为 migrations 目录；核心分支包括执行成功和数据库错误。
 */
export async function runMigrations(): Promise<void> {
  const pool = createPool();
  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
      logger.info(`迁移执行完成：${file}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((error) => {
    logger.error(`迁移执行失败：${(error as Error).message}`);
    process.exitCode = 1;
  });
}
