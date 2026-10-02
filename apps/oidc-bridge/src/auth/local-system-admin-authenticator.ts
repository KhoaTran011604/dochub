import { createHash, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

export interface SystemAdminCredentials {
  username: string;
  /** Hash argon2id (sinh bằng scripts/generate-system-admin-password-hash.ts). */
  passwordHash: string;
}

export type SystemAdminAuthenticator = (
  username: string,
  password: string,
) => Promise<boolean>;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** So sánh không lộ độ dài/vị trí khác nhau qua thời gian chạy. */
const constantTimeEquals = (left: string, right: string) =>
  timingSafeEqual(sha256(left), sha256(right));

export const normalizeUsername = (username: string) =>
  username.trim().toLowerCase();

/**
 * Xác thực tài khoản quản trị local duy nhất. Luôn chạy argon2 kể cả khi sai
 * username, để thời gian phản hồi không cho biết username nào tồn tại.
 */
export function createSystemAdminAuthenticator(
  credentials: SystemAdminCredentials,
): SystemAdminAuthenticator {
  const expectedUsername = normalizeUsername(credentials.username);

  return async (username, password) => {
    const usernameMatches = constantTimeEquals(
      normalizeUsername(username),
      expectedUsername,
    );
    const passwordMatches = await argon2
      .verify(credentials.passwordHash, password)
      // Hash hỏng → coi như sai mật khẩu, không để lộ lỗi ra form.
      .catch(() => false);
    return usernameMatches && passwordMatches;
  };
}
