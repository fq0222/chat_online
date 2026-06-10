import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

/**
 * 挂载 Vue 管理端应用。
 * 职责：创建单页应用实例；核心分支由 App 组件根据浏览器路径切换登录、创建房间和聊天室页面。
 */
createApp(App).mount('#app');
