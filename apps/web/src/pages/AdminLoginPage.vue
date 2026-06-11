<script setup lang="ts">
import type { AccountForm, StatusState } from '../types';

/**
 * 管理端登录页。
 * 职责：展示登录与首次初始化表单；关键参数为账号表单、初始化表单和状态提示；核心分支由 showSetup 决定是否展示创建管理员表单。
 */
defineProps<{
  loginForm: AccountForm;
  setupForm: AccountForm;
  status: StatusState;
  showSetup: boolean;
}>();

const emit = defineEmits<{
  (event: 'submit-login'): void;
  (event: 'submit-setup'): void;
}>();
</script>

<template>
<main class="auth-shell" data-page="admin-login">
    <section class="auth-layout" aria-labelledby="loginTitle">
      <div class="auth-visual">
        <div class="brand-mark">CO</div>
        <p class="eyebrow">Chat Online 管理端</p>
        <h1 id="loginTitle">把访客会话稳稳接住</h1>
        <p class="auth-copy">登录后可创建聊天室、复制访客入口，并在 PC 工作台集中处理实时消息。</p>
        <div class="auth-stats" aria-label="管理端能力">
          <span>实时转发</span>
          <span>房间分享</span>
          <span>客服工作台</span>
        </div>
      </div>
      <div class="auth-card" aria-label="登录表单">
        <div class="panel-title">
          <p>管理员登录</p>
          <span>PC 管理后台</span>
        </div>
        <form class="form-stack" @submit.prevent="emit('submit-login')">
          <label>
            <span>用户名</span>
            <input v-model="loginForm.username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input v-model="loginForm.password" type="password" autocomplete="current-password" required />
          </label>
          <button class="primary-button" type="submit">登录</button>
        </form>
        <form v-if="showSetup" class="form-stack setup-panel" @submit.prevent="emit('submit-setup')">
          <div class="notice">首次登录需要创建数据库管理员。当前临时 token 会自动用于初始化。</div>
          <label>
            <span>新管理员用户名</span>
            <input v-model="setupForm.username" autocomplete="off" required />
          </label>
          <label>
            <span>新管理员密码</span>
            <input v-model="setupForm.password" type="password" minlength="6" required />
          </label>
          <button class="secondary-button" type="submit">创建管理员</button>
        </form>
        <p class="status-text" :class="status.type" role="status">{{ status.message }}</p>
      </div>
    </section>
  </main>
</template>
