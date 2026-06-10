import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

type LocalConfig = {
  server?: {
    port?: number;
  };
};

/**
 * 读取后端本地开发端口。
 * @returns 后端 API 目标地址；核心分支为 config.js 存在时读取 server.port，不存在时回退 30007。
 */
function getApiTarget(): string {
  try {
    const config = require(path.resolve(process.cwd(), 'config.js')) as LocalConfig;
    const port = config.server?.port ?? 30007;

    return `http://127.0.0.1:${port}`;
  } catch (error) {
    return 'http://127.0.0.1:30007';
  }
}

const apiTarget = getApiTarget();

/**
 * Vite 前端构建配置。
 * 职责：装配 Vue3 插件、开发代理和 OpenResty 可托管的构建输出；核心分支为开发时代理 API/WS，构建时只生成静态产物。
 */
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      },
      '/ws/chat': {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
