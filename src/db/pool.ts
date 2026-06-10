import { Pool } from 'pg';
import { loadConfig } from '../config';

/**
 * 创建 PostgreSQL 连接池。
 * 职责：集中管理数据库连接；关键参数来自 config.js；核心分支由 pg 连接池处理连接复用和错误抛出。
 */
export function createPool(): Pool {
  const config = loadConfig();

  return new Pool({
    connectionString: config.database.connectionString
  });
}
