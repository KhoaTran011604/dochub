import { errors, jwtVerify } from "jose";
import type { ErpPublicKey } from "./erp-public-key-resolver.ts";

export interface HandoffTokenPolicy {
  issuer: string;
  audience: string;
  /** Chỉ thuật toán bất đối xứng (config đã giới hạn ES256/RS256). */
  algorithms: string[];
  maxLifetimeSeconds: number;
}

export interface VerifiedHandoffToken {
  erpUserId: string;
  jti: string;
  expiresAt: Date;
}

export type HandoffTokenRejection =
  | "token_missing"
  | "token_expired"
  | "token_signature_invalid"
  | "token_claims_invalid"
  | "token_lifetime_too_long"
  | "token_malformed"
  | "erp_key_unavailable";

export type HandoffTokenVerification =
  | { ok: true; token: VerifiedHandoffToken }
  | { ok: false; reason: HandoffTokenRejection };

const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_TOKEN_LENGTH = 4096;
const MAX_IDENTIFIER_LENGTH = 200;

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_IDENTIFIER_LENGTH;

function rejectionFor(error: unknown): HandoffTokenRejection {
  if (error instanceof errors.JWTExpired) return "token_expired";
  if (error instanceof errors.JWTClaimValidationFailed)
    return "token_claims_invalid";
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JOSEAlgNotAllowed
  ) {
    return "token_signature_invalid";
  }
  if (
    error instanceof errors.JWKSTimeout ||
    !(error instanceof errors.JOSEError)
  ) {
    // Không tải được JWKS của ERP (mạng, ERP chết): lỗi phía hạ tầng, không phải token.
    return "erp_key_unavailable";
  }
  return "token_malformed";
}

/**
 * Xác thực JWT ngắn hạn do ERP ký. Chỉ trả về định danh (`sub`, `jti`): email
 * và tên không lấy từ token. Không log token; lý do từ chối là mã cố định.
 */
export async function verifyErpHandoffToken(
  rawToken: string | undefined,
  key: ErpPublicKey,
  policy: HandoffTokenPolicy,
): Promise<HandoffTokenVerification> {
  if (!rawToken) return { ok: false, reason: "token_missing" };
  if (rawToken.length > MAX_TOKEN_LENGTH)
    return { ok: false, reason: "token_malformed" };

  try {
    const options = {
      issuer: policy.issuer,
      audience: policy.audience,
      algorithms: policy.algorithms,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["sub", "jti", "iat", "exp"],
      // Chặn cả `iat` ở tương lai (token ký sẵn để dùng sau).
      maxTokenAge: policy.maxLifetimeSeconds,
    };
    // 2 overload của jose (khóa cố định / hàm chọn khóa theo `kid`).
    const { payload } =
      typeof key === "function"
        ? await jwtVerify(rawToken, key, options)
        : await jwtVerify(rawToken, key, options);

    const { sub, jti, iat, exp } = payload;
    if (
      !isIdentifier(sub) ||
      !isIdentifier(jti) ||
      iat === undefined ||
      exp === undefined
    ) {
      return { ok: false, reason: "token_claims_invalid" };
    }
    // Token sống dài là token có thể bị nhặt lại từ history/log của bên khác.
    if (exp - iat > policy.maxLifetimeSeconds) {
      return { ok: false, reason: "token_lifetime_too_long" };
    }
    return {
      ok: true,
      token: { erpUserId: sub, jti, expiresAt: new Date(exp * 1000) },
    };
  } catch (error) {
    return { ok: false, reason: rejectionFor(error) };
  }
}
