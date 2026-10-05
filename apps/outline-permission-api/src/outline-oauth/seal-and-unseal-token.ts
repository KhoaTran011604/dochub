import { defaults, seal, unseal } from "iron-webcrypto";

export interface TokenSealer {
  seal(token: string): Promise<string>;
  /** Ném lỗi nếu sai khóa hoặc dữ liệu bị sửa. */
  unseal(sealed: string): Promise<string>;
}

/**
 * Niêm phong token Outline của user bằng iron-webcrypto (mã hóa + chống sửa),
 * không tự viết mã hóa. `ttl: 0` = bản niêm phong không tự hết hạn; hạn của
 * token do Outline quyết định.
 */
export function createTokenSealer(password: string): TokenSealer {
  const options = { ...defaults, ttl: 0 };
  return {
    seal: (token) => seal({ token }, password, options),
    async unseal(sealed) {
      const data = (await unseal(sealed, password, options)) as { token?: unknown };
      if (typeof data.token !== "string") throw new Error("sealed token payload is malformed");
      return data.token;
    },
  };
}
