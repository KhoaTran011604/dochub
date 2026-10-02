import * as oidc from "openid-client";

export interface UpstreamOidcSettings {
  issuerUrl: string;
  clientId: string;
  clientSecret: string | undefined;
  scopes: string;
  /** `${BRIDGE_PUBLIC_URL}/upstream/callback`, phải đăng ký đúng chuỗi ở IdP. */
  redirectUri: string;
}

/** Trạng thái 1 lần đăng nhập, nằm trong cookie ký cho tới khi IdP gọi callback. */
export interface UpstreamLoginTransaction {
  codeVerifier: string;
  state: string;
  nonce: string;
}

export type UpstreamLoginRejection =
  /** IdP trả `error=` (user từ chối, client sai cấu hình...). */
  | "idp_denied"
  /** state/nonce/iss sai, thiếu code, đổi code thất bại, id_token không hợp lệ. */
  | "callback_invalid"
  /** Không tới được IdP (discovery / token endpoint). */
  | "idp_unavailable";

/** Hồ sơ trong id_token của IdP (chỉ dùng để tự provision user lần đầu). */
export interface UpstreamUserProfile {
  email: string | undefined;
  emailVerified: boolean | undefined;
  name: string | undefined;
}

export type UpstreamLoginCompletion =
  | { ok: true; sub: string; profile: UpstreamUserProfile }
  | { ok: false; reason: UpstreamLoginRejection; detail?: string };

export interface UpstreamOidcClient {
  /** Sinh PKCE/state/nonce và URL authorize của IdP. */
  startLogin(): Promise<{
    authorizationUrl: string;
    transaction: UpstreamLoginTransaction;
  }>;
  /** Đổi `code` ở callback lấy `id_token`, kiểm chữ ký/nonce/state/iss, trả `sub`. Chỉ dùng query của `callbackUrl`. */
  completeLogin(
    callbackUrl: URL,
    transaction: UpstreamLoginTransaction,
  ): Promise<UpstreamLoginCompletion>;
}

/**
 * Bridge làm relying party của IdP thật (authorization code + PKCE S256).
 * Discovery chạy lười ở lần dùng đầu và được cache; lỗi thì lần sau thử lại,
 * để bridge vẫn khởi động được (form system_admin) khi IdP đang chết.
 */
export function createUpstreamOidcClient(
  settings: UpstreamOidcSettings,
): UpstreamOidcClient {
  const issuer = new URL(settings.issuerUrl);
  let configuration: Promise<oidc.Configuration> | undefined;

  const discover = () => {
    configuration ??= oidc
      .discovery(
        issuer,
        settings.clientId,
        undefined,
        settings.clientSecret === undefined
          ? oidc.None()
          : oidc.ClientSecretBasic(settings.clientSecret),
        {
          // openid-client chỉ cho HTTPS; IdP HTTP chỉ có ở test/dev local.
          execute:
            issuer.protocol === "http:" ? [oidc.allowInsecureRequests] : [],
        },
      )
      .catch((error: unknown) => {
        configuration = undefined;
        throw error;
      });
    return configuration;
  };

  return {
    async startLogin() {
      const config = await discover();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: settings.redirectUri,
        scope: settings.scopes,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return {
        authorizationUrl: url.href,
        transaction: { codeVerifier, state, nonce },
      };
    },

    async completeLogin(callbackUrl, transaction) {
      let config: oidc.Configuration;
      try {
        config = await discover();
      } catch {
        return { ok: false, reason: "idp_unavailable" };
      }
      // `redirect_uri` gửi lên token endpoint lấy từ config, không từ Host header
      // của request (sau reverse proxy có thể khác BRIDGE_PUBLIC_URL).
      const currentUrl = new URL(settings.redirectUri);
      currentUrl.search = callbackUrl.search;
      try {
        const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
          pkceCodeVerifier: transaction.codeVerifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        const sub = claims?.sub;
        if (!sub) return { ok: false, reason: "callback_invalid" };
        let profile = readUserProfile(claims);
        // Một số IdP chỉ trả email/name ở userinfo, không nằm trong id_token.
        if (!profile.email) {
          profile = readUserProfile(
            await oidc.fetchUserInfo(config, tokens.access_token, sub),
          );
        }
        return { ok: true, sub, profile };
      } catch (error) {
        return { ok: false, ...classifyCallbackError(error) };
      }
    },
  };
}

/** Chỉ lấy claim đúng kiểu; IdP thiếu claim thì để undefined, không đoán. */
function readUserProfile(
  claims: oidc.IDToken | oidc.UserInfoResponse,
): UpstreamUserProfile {
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  return {
    email: text(claims.email),
    emailVerified:
      typeof claims.email_verified === "boolean"
        ? claims.email_verified
        : undefined,
    name: text(claims.name),
  };
}

/** Lý do dạng mã cố định + mã lỗi OAuth (nếu có); không bao giờ kèm code/token. */
function classifyCallbackError(error: unknown): {
  reason: UpstreamLoginRejection;
  detail?: string;
} {
  // Message của openid-client là chuỗi cố định (vd. 'JWT "nonce" claim missing'),
  // không chứa code/token; cần để biết IdP trả sai ở đâu.
  if (error instanceof Error) {
    console.error(
      `upstream callback rejected: ${error.name}${"code" in error ? ` ${String(error.code)}` : ""}: ${error.message}`,
    );
  }
  if (error instanceof oidc.AuthorizationResponseError) {
    return { reason: "idp_denied", detail: error.error };
  }
  if (error instanceof oidc.ResponseBodyError) {
    return { reason: "callback_invalid", detail: error.error };
  }
  if (error instanceof oidc.ClientError) {
    return { reason: "callback_invalid", detail: error.code };
  }
  // fetch thất bại (mạng, DNS, TLS) không phải lỗi của openid-client.
  return { reason: "idp_unavailable" };
}
