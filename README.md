# chat_online
在线聊天匿名客服系统

## 后端说明

当前阶段实现 Node.js、Express、ws、PostgreSQL 和 TypeScript 后端。

### 本地配置

复制 `config.example.js` 为 `config.js`，填写真实数据库连接和首次管理员账号密码。`config.js` 可能包含真实敏感信息，已加入 `.gitignore`，不要提交到远程仓库。
生产环境必须把 `auth.jwtSecret` 改成长度至少 32 位的强随机密钥；PM2 使用 `NODE_ENV=production` 启动时，如果仍使用模板或开发密钥，服务会拒绝启动。

### 常用命令

```bash
npm install
npm run migrate
npm run dev
```

### API 概览

- `POST /api/auth/login`：管理员登录。数据库暂无管理员时，可使用 `config.js` 中的首次管理员账号登录。
- `POST /api/admin/setup`：首次创建数据库管理员，需要首次登录 token。
- `PUT /api/admin/profile`：更新管理员用户名或密码，需要管理员 token。
- `POST /api/rooms`：创建聊天室，需要管理员 token，房间元数据保存到 PostgreSQL。
- `GET /api/rooms/:roomId`：查询聊天室基础信息，不返回聊天记录。
- `/ws/chat?roomId=<roomId>&role=admin|guest&token=<adminToken>`：聊天室 WebSocket 连接。

### 数据保存边界

PostgreSQL 只保存管理员信息和聊天室元数据。聊天记录不保存在服务端内存、文件或数据库中，服务端只做实时转发；聊天内容由管理员和访客浏览器各自保存在本地内存中，关闭标签页后消失。

## Docker 生产部署说明

生产环境使用 `docker-compose.yml` 统一编排三个容器：

- `postgres`：PostgreSQL 数据库，使用 Docker volume 持久化数据。
- `backend`：Node.js 后端容器，容器内使用 PM2 和 `pm2-logrotate` 托管服务日志。
- `frontend`：OpenResty 前端容器，托管 `apps/web` 构建后的静态资源，并反向代理 `/api/` 与 `/ws/` 到后端。

三个容器都会加入同一个自定义 bridge 网络 `chat-online-network`，容器之间通过 Compose 服务名互相访问：后端连接 `postgres:5432`，OpenResty 连接 `backend:30007`。

### 部署文件

项目已提供以下 Docker 部署文件：

- `docker-compose.yml`：统一启动 PostgreSQL、后端和前端。
- `Dockerfile.backend`：构建后端生产镜像。
- `apps/web/Dockerfile`：构建前端资源并打包到 OpenResty。
- `apps/web/openresty.conf`：OpenResty 静态资源与反向代理配置。
- `.dockerignore`：避免把 `config.js`、`node_modules`、构建产物和日志打进镜像。

### 生产配置

复制 `config.example.js` 为 `config.js`，生产环境至少修改数据库连接、站点地址、管理员初始账号和鉴权密钥。Docker Compose 中后端容器会只读挂载当前目录下的 `config.js` 到 `/app/config.js`。

`config.js` 示例：

```javascript
module.exports = {
  server: {
    port: 30007
  },
  site: {
    protocol: 'https',
    host: 'chat.example.com'
  },
  database: {
    connectionString: 'postgres://chat_online_user:change-me-db-password@postgres:5432/chat_online'
  },
  bootstrapAdmin: {
    username: 'admin',
    password: 'change-me-strong-password'
  },
  auth: {
    adminTokenTtlMs: 24 * 60 * 60 * 1000,
    jwtSecret: 'change-me-to-a-random-jwt-secret-at-least-32-characters',
    adminEntryKey: '0123456789abcdef0123456789abcdef'
  }
};
```

注意：

- `database.connectionString` 的主机名必须使用 Compose 服务名 `postgres`。
- `POSTGRES_PASSWORD` 要和 `config.js` 中的数据库密码保持一致。
- `auth.jwtSecret` 必须改为长度至少 32 位的强随机字符串。
- `auth.adminEntryKey` 必须是 32 位十六进制字符串。
- `config.js` 包含真实敏感信息，严禁提交到远程仓库。

可用以下命令生成随机密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### docker-compose.yml

当前 `docker-compose.yml` 会创建 `chat-online-network` 网络，把前端映射到宿主机 `80` 端口，后端只在容器网络内部暴露给 OpenResty。

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: chat-online-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: chat_online
      POSTGRES_USER: chat_online_user
      POSTGRES_PASSWORD: change-me-db-password
      TZ: Asia/Shanghai
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chat_online_user -d chat_online"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - chat-online-network

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: chat-online-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./config.js:/app/config.js:ro
      - backend-logs:/app/logs
    expose:
      - "30007"
    networks:
      - chat-online-network

  frontend:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    container_name: chat-online-frontend
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "80:80"
    networks:
      - chat-online-network

networks:
  chat-online-network:
    driver: bridge

volumes:
  postgres-data:
  backend-logs:
```

### 后端 PM2 与日志轮转

后端容器启动时会执行数据库迁移，然后通过 `pm2-runtime ecosystem.config.js` 启动 `dist/src/server.js`。容器内会安装并启用 `pm2-logrotate`，启动命令包含以下配置：

```bash
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 3
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
pm2 set pm2-logrotate:rotateModule true
```

后端日志写入容器内 `/app/logs`，并通过 Compose volume `backend-logs` 持久化。

### OpenResty 前端部署

前端镜像会先执行 `npm run build` 生成 Vite 静态资源，再复制到 OpenResty 的 HTML 目录。OpenResty 配置包含：

- `/`：托管前端页面，使用 `try_files $uri $uri/ /index.html` 支持 SPA 刷新。
- `/api/`：反向代理到 `backend:30007`。
- `/ws/`：反向代理 WebSocket 到 `backend:30007`，并设置 `Upgrade` 与长连接超时。

### 启动与维护命令

首次部署：

```bash
cp config.example.js config.js
# 编辑 config.js，并同步修改 docker-compose.yml 中的 POSTGRES_PASSWORD
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

更新部署：

```bash
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

停止服务并删除数据库数据卷时才使用以下命令：

```bash
docker compose down -v
```
