import type { Context } from "koa";
import type { UpstreamLoginTransaction } from "./upstream-oidc-client.ts";

export const UPSTREAM_LOGIN_COOKIE_NAME = "hd_upstream_login";
/** Chỉ gửi tới callback; không tới /auth, /token, /interaction... */
export const UPSTREAM_LOGIN_COOKIE_PATH = "/upstream";
/** Đủ cho user gõ mật khẩu ở IdP; bằng TTL interaction của provider. */
const UPSTREAM_LOGIN_LIFETIME_SECONDS = 10 * 60;

/** Transaction + uid của interaction đang chờ ở bridge. */
export interface PendingUpstreamLogin extends UpstreamLoginTransaction {
  interactionUid: string;
}

const isPendingUpstreamLogin = (value: unknown): value is PendingUpstreamLogin =>
  typeof value === "object" &&
  value !== null &&
  ["interactionUid", "codeVerifier", "state", "nonce"].every(
    (key) =>
      typeof (value as Record<string, unknown>)[key] === "string" &&
      (value as Record<string, string>)[key] !== "",
  );

/** Lưu transaction trong cookie ký (keygrip của Koa). Không có bảng, không có session. */
export function setPendingUpstreamLogin(
  ctx: Context,
  pending: PendingUpstreamLogin,
): void {
  ctx.cookies.set(
    UPSTREAM_LOGIN_COOKIE_NAME,
    Buffer.from(JSON.stringify(pending)).toString("base64url"),
    {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.secure,
      path: UPSTREAM_LOGIN_COOKIE_PATH,
      maxAge: UPSTREAM_LOGIN_LIFETIME_SECONDS * 1000,
    },
  );
}

/** Đọc và xóa cookie (dùng 1 lần). undefined khi thiếu, sai chữ ký hoặc hỏng. */
export function takePendingUpstreamLogin(
  ctx: Context,
): PendingUpstreamLogin | undefined {
  const raw = ctx.cookies.get(UPSTREAM_LOGIN_COOKIE_NAME, { signed: true });
  if (!raw) return undefined;
  ctx.cookies.set(UPSTREAM_LOGIN_COOKIE_NAME, null, {
    signed: true,
    path: UPSTREAM_LOGIN_COOKIE_PATH,
  });
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    return isPendingUpstreamLogin(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
