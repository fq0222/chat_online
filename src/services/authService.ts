import crypto from 'node:crypto';
import type { AdminRecord, AdminService } from './adminService';

export type BootstrapAdminConfig = {
  username: string;
  password: string;
};

export type AuthSession = {
  token: string;
  adminId: string;
  username: string;
  isBootstrap: boolean;
  createdAt: Date;
};

export type LoginResult = {
  ok: true;
  token: string;
  requiresSetup: boolean;
  admin: {
    id: string;
    username: string;
  };
};

export type AuthServiceOptions = {
  adminTokenTtlMs: number;
  now?: () => Date;
};

/**
 * 管理员鉴权服务。
 * 职责：处理登录、内存 token 生成与校验；关键参数为管理员服务和首次管理员配置；核心分支为数据库登录和首次引导登录。
 */
export class AuthService {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly authOptions: AuthServiceOptions;

  constructor(
    private readonly adminService: AdminService,
    private readonly bootstrapAdmin: BootstrapAdminConfig,
    options?: Partial<AuthServiceOptions>
  ) {
    this.authOptions = {
      adminTokenTtlMs: 24 * 60 * 60 * 1000,
      ...options
    };
  }

  /**
   * 管理员登录。
   * @param username 管理员用户名。
   * @param password 管理员密码。
   * @returns 登录成功后的 token、管理员信息和是否需要初始化数据库管理员。
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const hasAnyAdmin = await this.adminService.hasAnyAdmin();

    if (!hasAnyAdmin) {
      return this.loginWithBootstrapAdmin(username, password);
    }

    const admin = await this.adminService.findByUsername(username);

    if (!admin || !(await this.adminService.verifyPassword(admin, password))) {
      throw new Error('管理员账号或密码错误');
    }

    const session = this.createSession(admin.id, admin.username, false);

    return {
      ok: true,
      token: session.token,
      requiresSetup: false,
      admin: {
        id: admin.id,
        username: admin.username
      }
    };
  }

  /**
   * 校验内存 token。
   * @param token 待校验 token。
   * @returns token 有效时返回会话，否则返回 null。
   */
  verifyToken(token?: string): AuthSession | null {
    if (!token) {
      return null;
    }

    const session = this.sessions.get(token);

    if (!session) {
      return null;
    }

    if (this.isSessionExpired(session)) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  /**
   * 撤销指定管理员的所有 token。
   * @param adminId 管理员 ID。
   */
  revokeAdminTokens(adminId: string): void {
    for (const [token, session] of this.sessions.entries()) {
      if (session.adminId === adminId) {
        this.sessions.delete(token);
      }
    }
  }

  private loginWithBootstrapAdmin(username: string, password: string): LoginResult {
    if (username !== this.bootstrapAdmin.username || password !== this.bootstrapAdmin.password) {
      throw new Error('管理员账号或密码错误');
    }

    const session = this.createSession('bootstrap-admin', username, true);

    return {
      ok: true,
      token: session.token,
      requiresSetup: true,
      admin: {
        id: session.adminId,
        username
      }
    };
  }

  private createSession(adminId: string, username: string, isBootstrap: boolean): AuthSession {
    const token = crypto.randomUUID();
    const session = {
      token,
      adminId,
      username,
      isBootstrap,
      createdAt: this.getNow()
    };

    this.sessions.set(token, session);
    return session;
  }

  /**
   * 获取当前时间。
   * @returns 当前系统时间；测试场景可通过 now 选项注入固定时间。
   */
  private getNow(): Date {
    return this.authOptions.now?.() ?? new Date();
  }

  /**
   * 判断管理员会话是否超过配置有效期。
   * @param session 待检查的管理员会话。
   * @returns 超过 adminTokenTtlMs 时返回 true，否则返回 false。
   */
  private isSessionExpired(session: AuthSession): boolean {
    return this.getNow().getTime() - session.createdAt.getTime() > this.authOptions.adminTokenTtlMs;
  }
}
