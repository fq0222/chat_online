# 在线实时聊天室后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Node.js、Express、ws、PostgreSQL 和 TypeScript 后端，实现管理员登录、管理员初始化、房间创建/查询和不保存聊天记录的实时消息转发。

**Architecture:** REST API 处理登录、管理员资料和房间元数据；PostgreSQL 只保存管理员和房间信息；WebSocket 只维护在线连接和会话路由并转发消息。聊天内容不进入数据库、不进入服务端内存历史列表、不写日志正文。

**Tech Stack:** Node.js、TypeScript、Express、ws、pg、bcryptjs、node:test、tsx。

---

## 文件结构

- Create: `package.json`，定义脚本、依赖和 Node 测试命令。
- Create: `tsconfig.json`，约束 TypeScript 编译范围和 CommonJS 输出。
- Create: `config.example.js`，提供安全配置模板。
- Create: `src/config.ts`，加载根目录 `config.js` 并提供类型化配置。
- Create: `src/utils/logger.ts`，统一中文注释日志工具。
- Create: `src/db/pool.ts`，创建 PostgreSQL 连接池。
- Create: `src/db/migrate.ts`，执行数据库迁移。
- Create: `src/db/migrations/001_init.sql`，创建管理员表和聊天室表。
- Create: `src/services/adminService.ts`，管理管理员查询、创建和更新。
- Create: `src/services/authService.ts`，处理登录、内存 token 和鉴权。
- Create: `src/services/roomService.ts`，处理房间创建、分享链接和查询。
- Create: `src/services/chatRelayService.ts`，处理 WebSocket 连接和消息转发。
- Create: `src/routes/authRoutes.ts`，注册登录接口。
- Create: `src/routes/adminRoutes.ts`，注册管理员初始化和更新接口。
- Create: `src/routes/roomRoutes.ts`，注册房间接口。
- Create: `src/app.ts`，创建 Express 应用并挂载路由。
- Create: `src/server.ts`，启动 HTTP 服务和 WebSocket 服务。
- Create: `test/*.test.ts`，覆盖核心服务和 API 行为。

## Task 1: 项目脚手架与日志

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `config.example.js`
- Create: `src/config.ts`
- Create: `src/utils/logger.ts`
- Test: `test/logger.test.ts`

- [ ] **Step 1: 写日志工具失败测试**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, getLocalTime } from '../src/utils/logger';

test('日志工具输出模块名、级别和上海时间', () => {
  const messages: string[] = [];
  const logger = createLogger('测试模块', {
    info: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    error: (message) => messages.push(message)
  });

  logger.info('启动完成');

  assert.equal(messages.length, 1);
  assert.match(messages[0], /^\[测试模块\] \[INFO\] /);
  assert.match(messages[0], / - 启动完成$/);
  assert.match(getLocalTime(), /^\d{4}\/\d{1,2}\/\d{1,2}/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --import tsx test/logger.test.ts`
Expected: FAIL，提示找不到 `../src/utils/logger`。

- [ ] **Step 3: 创建脚手架和日志实现**

实现 `package.json`、`tsconfig.json`、`config.example.js`、`src/config.ts`、`src/utils/logger.ts`。所有新增文件和方法包含中文注释。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --import tsx test/logger.test.ts`
Expected: PASS。

## Task 2: 数据库迁移和管理员服务

**Files:**
- Create: `src/db/pool.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/migrations/001_init.sql`
- Create: `src/services/adminService.ts`
- Test: `test/admin-service.test.ts`

- [ ] **Step 1: 写管理员服务失败测试**

测试使用内存假仓储验证：数据库为空时 `hasAnyAdmin()` 返回 false；创建管理员保存密码摘要；重复用户名报错；更新密码后明文密码不会保存。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --import tsx test/admin-service.test.ts`
Expected: FAIL，提示找不到 `AdminService`。

- [ ] **Step 3: 实现迁移 SQL 和管理员服务**

实现 `admins` 表、`rooms` 表和管理员服务。密码使用 `bcryptjs` 摘要。服务接受仓储接口，便于测试不依赖真实数据库。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --import tsx test/admin-service.test.ts`
Expected: PASS。

## Task 3: 鉴权服务和登录 API

**Files:**
- Create: `src/services/authService.ts`
- Create: `src/routes/authRoutes.ts`
- Create: `src/app.ts`
- Test: `test/auth-service.test.ts`
- Test: `test/auth-routes.test.ts`

- [ ] **Step 1: 写鉴权失败测试**

覆盖数据库已有管理员时使用数据库密码登录；数据库无管理员时允许 `config.js` 首次账号登录；错误密码返回失败；生成 token 后可校验；撤销 token 后失效。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --import tsx test/auth-service.test.ts test/auth-routes.test.ts`
Expected: FAIL，提示找不到鉴权服务或路由。

- [ ] **Step 3: 实现鉴权和登录接口**

实现 `POST /api/auth/login`。成功返回 `{ token, admin, requiresSetup }`，失败返回 401。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --import tsx test/auth-service.test.ts test/auth-routes.test.ts`
Expected: PASS。

## Task 4: 管理员初始化和资料更新 API

**Files:**
- Create: `src/routes/adminRoutes.ts`
- Modify: `src/app.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: 写接口失败测试**

覆盖数据库无管理员且携带首次登录 token 时可 `POST /api/admin/setup`；已有管理员时 setup 返回 409；`PUT /api/admin/profile` 需要管理员 token；更新成功后旧 token 失效。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --import tsx test/admin-routes.test.ts`
Expected: FAIL，提示路由不存在。

- [ ] **Step 3: 实现管理员路由**

实现初始化和更新接口。请求体校验用户名和密码，密码最短 6 位。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --import tsx test/admin-routes.test.ts`
Expected: PASS。

## Task 5: 房间服务和 REST API

**Files:**
- Create: `src/services/roomService.ts`
- Create: `src/routes/roomRoutes.ts`
- Modify: `src/app.ts`
- Test: `test/room-service.test.ts`
- Test: `test/room-routes.test.ts`

- [ ] **Step 1: 写房间失败测试**

覆盖未登录无法创建房间；管理员创建房间写入仓储并返回分享链接；访客可查询房间基础信息；查询接口不返回聊天记录字段。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --import tsx test/room-service.test.ts test/room-routes.test.ts`
Expected: FAIL，提示房间服务或路由不存在。

- [ ] **Step 3: 实现房间服务和路由**

实现 `POST /api/rooms` 和 `GET /api/rooms/:roomId`。房间 ID 使用随机 UUID，分享链接使用站点配置拼接。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --import tsx test/room-service.test.ts test/room-routes.test.ts`
Expected: PASS。

## Task 6: WebSocket 聊天转发

**Files:**
- Create: `src/services/chatRelayService.ts`
- Create: `src/ws/chatServer.ts`
- Modify: `src/server.ts`
- Test: `test/chat-relay-service.test.ts`

- [ ] **Step 1: 写转发失败测试**

覆盖访客用户名按时间戳生成；访客消息只转发给管理员；管理员消息只转发给指定访客；图片消息校验 MIME 和大小；服务不提供历史消息数组。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --import tsx test/chat-relay-service.test.ts`
Expected: FAIL，提示转发服务不存在。

- [ ] **Step 3: 实现转发服务和 WebSocket 挂载**

实现连接注册、断开清理、消息校验和即时转发。日志不输出消息正文。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --import tsx test/chat-relay-service.test.ts`
Expected: PASS。

## Task 7: 集成校验

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 运行完整测试**

Run: `node --test --import tsx test/*.test.ts`
Expected: PASS。

- [ ] **Step 2: 类型检查**

Run: `npm run check`
Expected: PASS。

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 4: 更新 README**

补充后端启动、迁移、配置和聊天记录不落库说明。

- [ ] **Step 5: 查看变更**

Run: `git diff --stat`
Expected: 展示后端、测试、文档变更；不执行 `git add`，除非用户明确要求提交。

## 自查结果

- 规格覆盖：管理员首次配置、数据库管理员、房间入库、REST API、WebSocket 转发和聊天记录不保存均有任务覆盖。
- 占位扫描：计划没有待定项；每个任务都有明确文件、测试命令和预期结果。
- 类型一致性：管理员服务、鉴权服务、房间服务和聊天转发服务的职责边界与设计文档一致。
