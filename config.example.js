/**
 * 本地配置模板，复制为 config.js 后填写真实配置。
 * 职责：提供服务端端口、站点地址、数据库连接和首次管理员账号。
 * node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
module.exports = {
  server: {
    port: 30007
  },
  site: {
    protocol: 'https',
    host: 'chat.example.com'
  },
  database: {
    connectionString: 'postgres://chat_online_user:change-me@127.0.0.1:5432/chat_online'
  },
  bootstrapAdmin: {
    username: 'admin',
    password: 'change-me-strong-password'
  },
  auth: {
    adminTokenTtlMs: 24 * 60 * 60 * 1000,
    jwtSecret: 'change-me-to-a-random-jwt-secret-at-least-32-characters'
  }
};
