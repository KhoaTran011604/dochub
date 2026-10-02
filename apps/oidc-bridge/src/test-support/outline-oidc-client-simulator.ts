import { randomUUID } from "node:crypto";
import type { EnvironmentConfig } from "../config/environment-config.ts";

export interface OutlineOidcClientSimulator {
  /** URL mà Outline đưa trình duyệt tới khi bắt đầu đăng nhập. */
  authorizationUrl(): string;
  /** POST /token với `code` trong URL callback, như Outline làm sau callback. */
  exchangeCodeForAccessToken(callbackUrl: string): Promise<string>;
  /** GET /me: Outline gọi lúc đăng nhập và lặp lại vài phút 1 lần để kiểm phiên. */
  fetchUserinfo(
    accessToken: string,
  ): Promise<{ status: number; claims: Record<string, unknown> }>;
  /** Đổi `code` lấy claim (2 bước trên gộp lại). */
  exchangeCodeForClaims(callbackUrl: string): Promise<Record<string, unknown>>;
}

/** Đóng vai phía server của Outline (client OIDC `outline`) trong test tích hợp. */
export function createOutlineOidcClientSimulator(
  config: EnvironmentConfig,
  bridgeUrl: string,
): OutlineOidcClientSimulator {
  const redirectUri = `${config.OUTLINE_URL}/auth/oidc.callback`;

  const simulator: OutlineOidcClientSimulator = {
    authorizationUrl() {
      const url = new URL("/auth", bridgeUrl);
      url.search = new URLSearchParams({
        client_id: config.OIDC_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid profile email",
        state: randomUUID(),
      }).toString();
      return url.href;
    },

    async exchangeCodeForAccessToken(callbackUrl) {
      const code = new URL(callbackUrl).searchParams.get("code");
      if (!code) throw new Error(`no authorization code in ${callbackUrl}`);
      const response = await fetch(`${bridgeUrl}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        // client_secret_post: đúng cách Outline gọi.
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: config.OIDC_CLIENT_ID,
          client_secret: config.OIDC_CLIENT_SECRET,
        }),
      });
      const tokens = (await response.json()) as { access_token?: string };
      if (!tokens.access_token) {
        throw new Error(`token endpoint → ${response.status}`);
      }
      return tokens.access_token;
    },

    async fetchUserinfo(accessToken) {
      const response = await fetch(`${bridgeUrl}/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return {
        status: response.status,
        claims: (await response.json()) as Record<string, unknown>,
      };
    },

    async exchangeCodeForClaims(callbackUrl) {
      const accessToken =
        await simulator.exchangeCodeForAccessToken(callbackUrl);
      return (await simulator.fetchUserinfo(accessToken)).claims;
    },
  };
  return simulator;
}
