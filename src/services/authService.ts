import crypto from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
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
  jwtSecret: string;
  now?: () => Date;
};

type AdminJwtPayload = JwtPayload & {
  kind: 'admin';
  adminId: string;
  username: string;
  adminVersion: string;
  issuedAtMs: number;
};

type BootstrapJwtPayload = JwtPayload & {
  kind: 'bootstrap';
  username: string;
  issuedAtMs: number;
};

type VerifiedJwtPayload = AdminJwtPayload | BootstrapJwtPayload;
type UnsignedAdminJwtPayload = {
  kind: 'admin';
  adminId: string;
  username: string;
  adminVersion: string;
  issuedAtMs: number;
};
type UnsignedBootstrapJwtPayload = {
  kind: 'bootstrap';
  username: string;
  issuedAtMs: number;
};
type UnsignedJwtPayload = UnsignedAdminJwtPayload | UnsignedBootstrapJwtPayload;

/**
 * 管理员鉴权服务。
 * 职责：处理登录、JWT token 生成与校验；关键参数为管理员服务、首次管理员配置和 jwtSecret；核心分支为数据库登录、首次引导登录和资料变更后的旧 token 失效。
 */
export class AuthService {
  private readonly revokedAfterByAdminId = new Map<string, number>();
  private readonly authOptions: AuthServiceOptions;

  constructor(
    private readonly adminService: AdminService,
    private readonly bootstrapAdmin: BootstrapAdminConfig,
    options?: Partial<AuthServiceOptions>
  ) {
    this.authOptions = {
      adminTokenTtlMs: 24 * 60 * 60 * 1000,
      jwtSecret: 'development-only-jwt-secret-change-before-production',
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

    const session = this.createAdminSession(admin);

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
   * 校验 JWT token。
   * @param token 待校验 token。
   * @returns token 有效时返回会话，否则返回 null。
   */
  async verifyToken(token?: string): Promise<AuthSession | null> {
    if (!token) {
      return null;
    }

    const payload = this.verifyJwtPayload(token);

    if (!payload) {
      return null;
    }

    if (payload.kind === 'bootstrap') {
      return this.verifyBootstrapPayload(token, payload);
    }

    return this.verifyAdminPayload(token, payload);
  }

  /**
   * 撤销指定管理员的所有 token。
   * @param adminId 管理员 ID。
   */
  revokeAdminTokens(adminId: string): void {
    this.revokedAfterByAdminId.set(adminId, this.getNow().getTime());
  }

  private loginWithBootstrapAdmin(username: string, password: string): LoginResult {
    if (username !== this.bootstrapAdmin.username || password !== this.bootstrapAdmin.password) {
      throw new Error('管理员账号或密码错误');
    }

    const session = this.createBootstrapSession(username);

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

  /**
   * 创建数据库管理员 JWT 会话。
   * @param admin 管理员记录；核心分支会把管理员版本摘要写入 payload，用于资料变更后拒绝旧 token。
   * @returns 可返回给前端的鉴权会话。
   */
  private createAdminSession(admin: AdminRecord): AuthSession {
    const issuedAt = this.getNow();
    const token = this.signJwt({
      kind: 'admin',
      adminId: admin.id,
      username: admin.username,
      adminVersion: this.createAdminVersion(admin),
      issuedAtMs: issuedAt.getTime()
    });

    return {
      token,
      adminId: admin.id,
      username: admin.username,
      isBootstrap: false,
      createdAt: issuedAt
    };
  }

  /**
   * 创建首次引导管理员 JWT 会话。
   * @param username 首次管理员用户名。
   * @returns 可用于初始化管理员的短期会话。
   */
  private createBootstrapSession(username: string): AuthSession {
    const issuedAt = this.getNow();
    const token = this.signJwt({
      kind: 'bootstrap',
      username,
      issuedAtMs: issuedAt.getTime()
    });

    return {
      token,
      adminId: 'bootstrap-admin',
      username,
      isBootstrap: true,
      createdAt: issuedAt
    };
  }

  /**
   * 签发 JWT。
   * @param payload 业务 payload；核心分支会使用 HS256 和配置的 jwtSecret，并按 adminTokenTtlMs 写入过期时间。
   * @returns 签名后的 JWT 字符串。
   */
  private signJwt(payload: UnsignedJwtPayload): string {
    const issuedAtSeconds = Math.floor(payload.issuedAtMs / 1000);

    return jwt.sign(
      {
        ...payload,
        iat: issuedAtSeconds
      },
      this.authOptions.jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: Math.max(1, Math.floor(this.authOptions.adminTokenTtlMs / 1000))
      }
    );
  }

  /**
   * 验证 JWT 签名和过期时间。
   * @param token 待校验 token。
   * @returns 结构合法且签名有效时返回 payload，否则返回 null。
   */
  private verifyJwtPayload(token: string): VerifiedJwtPayload | null {
    try {
      const payload = jwt.verify(token, this.authOptions.jwtSecret, {
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.getNow().getTime() / 1000)
      });

      if (typeof payload === 'string' || !this.isKnownPayload(payload)) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 校验首次引导 token 的业务状态。
   * @param token 原始 JWT。
   * @param payload 已验签的首次引导 payload。
   * @returns 数据库尚未初始化管理员时返回会话，否则返回 null。
   */
  private async verifyBootstrapPayload(token: string, payload: BootstrapJwtPayload): Promise<AuthSession | null> {
    if (await this.adminService.hasAnyAdmin()) {
      return null;
    }

    return {
      token,
      adminId: 'bootstrap-admin',
      username: payload.username,
      isBootstrap: true,
      createdAt: new Date(payload.issuedAtMs)
    };
  }

  /**
   * 校验管理员 token 的业务状态。
   * @param token 原始 JWT。
   * @param payload 已验签的管理员 payload。
   * @returns 管理员存在且版本未变化时返回会话，否则返回 null。
   */
  private async verifyAdminPayload(token: string, payload: AdminJwtPayload): Promise<AuthSession | null> {
    const revokedAfter = this.revokedAfterByAdminId.get(payload.adminId);

    if (revokedAfter && payload.issuedAtMs <= revokedAfter) {
      return null;
    }

    const admin = await this.adminService.findById(payload.adminId);

    if (!admin || this.createAdminVersion(admin) !== payload.adminVersion) {
      return null;
    }

    return {
      token,
      adminId: admin.id,
      username: admin.username,
      isBootstrap: false,
      createdAt: new Date(payload.issuedAtMs)
    };
  }

  /**
   * 判断 JWT payload 是否为当前服务支持的结构。
   * @param payload jsonwebtoken 解析出的对象。
   * @returns 字段完整且类型匹配时返回 true。
   */
  private isKnownPayload(payload: JwtPayload): payload is VerifiedJwtPayload {
    if (payload.kind === 'bootstrap') {
      return typeof payload.username === 'string' && typeof payload.issuedAtMs === 'number';
    }

    return (
      payload.kind === 'admin' &&
      typeof payload.adminId === 'string' &&
      typeof payload.username === 'string' &&
      typeof payload.adminVersion === 'string' &&
      typeof payload.issuedAtMs === 'number'
    );
  }

  /**
   * 生成管理员版本摘要。
   * @param admin 管理员记录。
   * @returns 由用户名、密码摘要和更新时间派生的 HMAC 摘要；核心分支用于资料变化后拒绝旧 JWT，且不泄露密码摘要原文。
   */
  private createAdminVersion(admin: AdminRecord): string {
    const updatedAt = admin.updatedAt ?? admin.createdAt;

    return crypto
      .createHmac('sha256', this.authOptions.jwtSecret)
      .update(`${admin.id}:${admin.username}:${admin.passwordHash}:${updatedAt.toISOString()}`)
      .digest('hex');
  }

  /**
   * 获取当前时间。
   * @returns 当前系统时间；测试场景可通过 now 选项注入固定时间。
   */
  private getNow(): Date {
    return this.authOptions.now?.() ?? new Date();
  }

}
