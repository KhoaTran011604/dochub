import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  exportJWK,
  importSPKI,
  type CryptoKey,
  type JWTVerifyGetKey,
} from "jose";

export interface ErpPublicKeySource {
  jwksUrl?: string | undefined;
  publicKeyPem?: string | undefined;
  /** Dùng khi import PEM (PEM không tự mang thuật toán). */
  algorithms: readonly string[];
}

export type ErpPublicKey = CryptoKey | JWTVerifyGetKey;

/**
 * Khóa công khai để verify JWT handoff.
 * - JWKS URL: jose tự cache và tải lại khi gặp `kid` lạ (ERP xoay khóa không
 *   cần restart bridge).
 * - PEM: 1 khóa cố định.
 * - Cả hai (dev: ERP thật/giả qua JWKS + khóa của CLI dev qua PEM): token mang
 *   `kid` đúng bằng thumbprint của khóa PEM dùng khóa PEM, còn lại hỏi JWKS.
 *   Production chỉ nên đặt 1 nguồn.
 */
export async function resolveErpPublicKey(
  source: ErpPublicKeySource,
): Promise<ErpPublicKey> {
  const remoteKeys = source.jwksUrl
    ? createRemoteJWKSet(new URL(source.jwksUrl), {
        timeoutDuration: 5_000,
        // `kid` lạ không được ép bridge gọi ERP liên tục.
        cooldownDuration: 30_000,
      })
    : undefined;

  const algorithm = source.algorithms[0];
  const pemKey =
    source.publicKeyPem && algorithm
      ? await importSPKI(source.publicKeyPem, algorithm, { extractable: true })
      : undefined;

  if (remoteKeys && pemKey) {
    const pemKeyId = await calculateJwkThumbprint(await exportJWK(pemKey));
    return (header, token) =>
      header.kid === pemKeyId ? pemKey : remoteKeys(header, token);
  }
  const key = remoteKeys ?? pemKey;
  if (!key) throw new Error("ERP SSO public key is not configured");
  return key;
}
