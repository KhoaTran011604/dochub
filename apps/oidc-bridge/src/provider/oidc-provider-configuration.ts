import { randomBytes } from "node:crypto";
import Provider, { type Configuration, type FindAccount } from "oidc-provider";
import type pg from "pg";
import type { EnvironmentConfig } from "../config/environment-config.ts";
import {
  renderErrorPage,
  renderHtmlPage,
  sendHtmlPage,
} from "../views/html-page-layout.ts";
import { createLoadExistingGrant } from "./load-existing-grant-for-first-party-client.ts";
import { buildOidcClients } from "./oidc-client-registry.ts";
import { createPostgresOidcStorageAdapterFactory } from "./postgres-oidc-storage-adapter.ts";

/** Tên cookie khai rõ để /sso xóa đúng cookie session (xem sso-handoff-route). */
export const BRIDGE_COOKIE_NAMES = {
  session: "hd_bridge_session",
  interaction: "hd_bridge_interaction",
  resume: "hd_bridge_resume",
} as const;

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

/**
 * Session của bridge không có giá trị lâu dài: user ERP lần nào cũng vào bằng
 * handoff, system_admin gõ lại mật khẩu. Ngắn để máy dùng chung ít rủi ro.
 */
const SESSION_TTL_SECONDS = 10 * MINUTE;

/**
 * Outline cứ ≥5 phút lại gọi /me bằng access token đã lưu; nhận 401 là thu mọi
 * phiên của user đó (ValidateSSOAccessTask, v1.10.1). Vì vậy token phải sống
 * bằng cookie phiên của Outline (3 tháng) và KHÔNG gắn với session bridge.
 * Thu quyền sớm vẫn được: user không còn active → findAccount trả undefined → 401.
 */
const OUTLINE_TOKEN_TTL_SECONDS = 90 * DAY;

export function createOidcProvider(
  config: EnvironmentConfig,
  pool: pg.Pool,
  findAccount: FindAccount,
): Provider {
  const outlineOrigin = new URL(config.OUTLINE_URL).origin;
  const cookieOptions = { httpOnly: true, sameSite: "lax" } as const;

  const configuration: Configuration = {
    adapter: createPostgresOidcStorageAdapterFactory(pool),
    clients: buildOidcClients({
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      outlineUrl: config.OUTLINE_URL,
    }),
    jwks: config.BRIDGE_SIGNING_JWKS,
    findAccount,
    loadExistingGrant: createLoadExistingGrant(
      (clientId) => clientId === config.OIDC_CLIENT_ID,
    ),
    // Claim phát theo scope; Outline đọc ở userinfo (/me).
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name", "preferred_username"],
    },
    cookies: {
      keys: config.BRIDGE_COOKIE_KEYS,
      names: BRIDGE_COOKIE_NAMES,
      // `secure` do provider tự bật khi request là HTTPS (kể cả qua proxy tin cậy).
      long: cookieOptions,
      short: cookieOptions,
    },
    ttl: {
      Session: SESSION_TTL_SECONDS,
      Interaction: SESSION_TTL_SECONDS,
      AuthorizationCode: MINUTE,
      AccessToken: OUTLINE_TOKEN_TTL_SECONDS,
      Grant: OUTLINE_TOKEN_TTL_SECONDS,
      IdToken: 60 * MINUTE,
    },
    expiresWithSession: () => false,
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    features: {
      // Màn login mẫu của thư viện: không bao giờ bật.
      devInteractions: { enabled: false },
      rpInitiatedLogout: {
        enabled: true,
        // Outline gọi tới khi user bấm đăng xuất. Tự submit để không thêm 1 màn hỏi.
        logoutSource: (ctx, form) => {
          const nonce = randomBytes(16).toString("base64");
          sendHtmlPage(
            ctx,
            200,
            renderHtmlPage(
              "Đăng xuất",
              `<h1>Đang đăng xuất…</h1>${form}
<input type="hidden" name="logout" value="yes" form="op.logoutForm">
<button type="submit" form="op.logoutForm">Đăng xuất</button>
<script nonce="${nonce}">document.getElementById("op.logoutForm").submit()</script>`,
            ),
            { formActionOrigins: [outlineOrigin], scriptNonce: nonce },
          );
        },
        postLogoutSuccessSource: (ctx) => {
          sendHtmlPage(
            ctx,
            200,
            renderHtmlPage(
              "Đã đăng xuất",
              `<h1>Đã đăng xuất</h1><p>Bạn có thể đóng tab này.</p>`,
            ),
          );
        },
      },
    },
    renderError: (ctx, out) => {
      // Chỉ mã lỗi chuẩn OAuth; chi tiết nằm ở log server.
      sendHtmlPage(
        ctx,
        ctx.status,
        renderErrorPage(
          `Yêu cầu đăng nhập không hợp lệ hoặc đã hết hạn (${out.error}). Mở lại tài liệu từ đầu.`,
          config.ERP_PORTAL_URL,
        ),
      );
    },
  };

  const provider = new Provider(config.BRIDGE_PUBLIC_URL, configuration);
  provider.proxy = config.TRUST_PROXY;
  return provider;
}
