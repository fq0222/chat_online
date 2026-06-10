# chat_online
在线聊天匿名客服系统

## 后端说明

当前阶段实现 Node.js、Express、ws、PostgreSQL 和 TypeScript 后端。

### 本地配置

复制 `config.example.js` 为 `config.js`，填写真实数据库连接和首次管理员账号密码。`config.js` 可能包含真实敏感信息，已加入 `.gitignore`，不要提交到远程仓库。

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
