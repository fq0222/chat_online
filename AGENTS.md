# 项目指令与协作规范

> 使用简体中文回答所有问题

### 代码提交
1. 可以 `git commit` 提交本地更改
2. 刚写完但用户没有明确要求提交的文件，不要 `git add`，避免用户后续难以定位未确认的改动
3. `git push` 前**必须**展示变更并获得用户同意
4. **commit 信息必须使用中文书写**
5. 新建文件和新增方法必须保持与当前项目一致的代码风格
6. 新建文件和新增方法**必须补充注释**，至少说明职责、关键参数和核心分支语义


## 关键配置

### ecosystem.config.js (PM2)
- 生产环境启动配置
- **禁止写入真实敏感信息**，此文件需提交至 GitHub

### config.js (本地开发)
- **允许写入真实数据**，严禁提交至远程仓库
- 包含数据库连接、JWT 密钥等
- 包含站点配置 `site.protocol` 和 `site.host`

## 日志
关键点要有日志打印，提取专用的日志类文件。
格式参考以下代码，使用TypeScript重写

```javascript
function getLocalTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/**
 * 创建日志工具实例
 * @param {string} module - 模块名称
 * @returns {Object} 日志工具
 */
function createLogger(module) {
  return {
    info: (msg) => console.log(`[${module}] [INFO] ${getLocalTime()} - ${msg}`),
    error: (msg) => console.error(`[${module}] [ERROR] ${getLocalTime()} - ${msg}`),
    warn: (msg) => console.warn(`[${module}] [WARN] ${getLocalTime()} - ${msg}`)
  };
}
```
