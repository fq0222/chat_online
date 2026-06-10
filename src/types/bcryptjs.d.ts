declare module 'bcryptjs' {
  /**
   * 生成密码摘要。
   * @param password 明文密码。
   * @param saltRounds 加盐轮数。
   * @returns bcrypt 密码摘要。
   */
  export function hash(password: string, saltRounds: number): Promise<string>;

  /**
   * 校验明文密码和摘要是否匹配。
   * @param password 明文密码。
   * @param hash bcrypt 密码摘要。
   * @returns 匹配时返回 true。
   */
  export function compare(password: string, hash: string): Promise<boolean>;

  const bcrypt: {
    hash: typeof hash;
    compare: typeof compare;
  };

  export default bcrypt;
}
