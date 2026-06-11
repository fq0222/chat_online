/**
 * PM2 生产启动配置。
 * 职责：启动编译后的 Node.js 后端服务；关键参数为 cwd、script、实例模式和安全环境变量；核心分支为单进程 fork 模式，避免当前内存会话型 WebSocket 被 cluster 多进程拆分。
 */
module.exports = {
  apps: [
    {
      name: 'chat-online',
      cwd: __dirname,
      script: 'dist/src/server.js',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      restart_delay: 3000,
      kill_timeout: 5000,
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
