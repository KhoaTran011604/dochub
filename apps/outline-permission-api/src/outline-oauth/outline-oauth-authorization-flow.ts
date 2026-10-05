import { createHash, randomBytes } from "node:crypto";

export interface OAuthAuthorizationRequest {
  /** Chuỗi ngẫu nhiên 1 lần, ràng buộc với trình duyệt bằng cookie. */
  state: string;
  /** Giữ ở server tới callback; chỉ gửi `codeChallenge` (S256) lên Outline. */
  codeVerifier: string;
  codeChallenge: string;
}

const base64Url = (bytes: Buffer) => bytes.toString("base64url");

export function createAuthorizationRequest(): OAuthAuthorizationRequest {
  const codeVerifier = base64Url(randomBytes(32));
  return {
    state: base64Url(randomBytes(24)),
    codeVerifier,
    codeChallenge: base64Url(createHash("sha256").update(codeVerifier).digest()),
  };
}

/** URL màn đồng ý của Outline. Dùng `OUTLINE_URL` public: trình duyệt của user phải mở được. */
export function buildAuthorizeUrl(input: {
  outlineUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  request: OAuthAuthorizationRequest;
}): string {
  const url = new URL("/oauth/authorize", input.outlineUrl);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.scope,
    state: input.request.state,
    code_challenge: input.request.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
