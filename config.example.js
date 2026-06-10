/**
 * 本地配置模板，复制为 config.js 后填写真实配置。
 * 职责：提供服务端端口、站点地址、数据库连接和首次管理员账号。
 */
module.exports = {
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
  }
};
