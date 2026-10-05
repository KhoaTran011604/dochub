// OAuth của Outline (`/oauth/token`, `/oauth/revoke`) không nằm dưới `/api/` và
// dùng form-urlencoded, không phải JSON envelope → không đi qua outline-http-client.
// Không retry: refresh token xoay mỗi lần, gọi lại có thể làm mất grant.

export interface OutlineOAuthCredentials {
  /** `OUTLINE_URL` (hoặc URL nội bộ), không có "/" cuối. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Chỉ dùng trong test để thay `global.fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface OutlineOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

/** `code` là mã lỗi OAuth của Outline, vd `invalid_grant` (refresh token hết hạn/bị thu hồi). */
export class OutlineOAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "OutlineOAuthError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function postForm(
  credentials: OutlineOAuthCredentials,
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const fetchImpl = credentials.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    ...fields,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  let response: Response;
  try {
    response = await fetchImpl(`${credentials.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(credentials.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // Message gốc có thể chứa URL; không đính kèm body/secret.
    throw new OutlineOAuthError(
      `Outline ${path} call failed: ${error instanceof Error ? error.name : "unknown error"}`,
      0,
      undefined,
    );
  }
  const json: unknown = await response.json().catch(() => undefined);
  const payload = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : undefined;
    throw new OutlineOAuthError(`Outline ${path} returned HTTP ${response.status}`, response.status, code);
  }
  return payload;
}

function toTokens(payload: Record<string, unknown>, now: Date): OutlineOAuthTokens {
  const { access_token, refresh_token, expires_in, scope } = payload;
  if (typeof access_token !== "string" || typeof refresh_token !== "string") {
    throw new OutlineOAuthError("Outline /oauth/token response is missing tokens", 200, undefined);
  }
  const lifetimeSeconds = typeof expires_in === "number" ? expires_in : 3600;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000),
    scope: typeof scope === "string" ? scope : "",
  };
}

export async function exchangeAuthorizationCode(
  credentials: OutlineOAuthCredentials,
  input: { code: string; redirectUri: string; codeVerifier: string },
  now: Date = new Date(),
): Promise<OutlineOAuthTokens> {
  const payload = await postForm(credentials, "/oauth/token", {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  return toTokens(payload, now);
}

/** Refresh token luôn xoay: token mới trong kết quả thay thế hẳn token cũ. */
export async function refreshAccessToken(
  credentials: OutlineOAuthCredentials,
  refreshToken: string,
  now: Date = new Date(),
): Promise<OutlineOAuthTokens> {
  const payload = await postForm(credentials, "/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return toTokens(payload, now);
}

export async function revokeOAuthToken(
  credentials: OutlineOAuthCredentials,
  token: string,
): Promise<void> {
  await postForm(credentials, "/oauth/revoke", { token });
}
