/**
 * Bộ env hợp lệ tối thiểu cho test. Giá trị là dữ liệu giả cố định, không phải
 * secret thật. Test ghi đè từng biến cần kiểm.
 */
export function validBridgeEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    BRIDGE_PUBLIC_URL: "http://127.0.0.1:4001",
    BRIDGE_DATABASE_URL:
      "postgres://bridge_app:test@localhost:5432/hd_document_apps",
    BRIDGE_COOKIE_KEYS: "test-cookie-key-0123456789abcdef0123456789abcdef",
    BRIDGE_SIGNING_JWKS: JSON.stringify({ keys: [{ kty: "RSA" }] }),
    OUTLINE_URL: "http://127.0.0.1:3000",
    OIDC_CLIENT_ID: "outline",
    OIDC_CLIENT_SECRET: "test-client-secret-0123456789abcdef0123456789",
    SYSTEM_ADMIN_USERNAME: "system_admin",
    SYSTEM_ADMIN_EMAIL: "system-admin@hd-document.test",
    SYSTEM_ADMIN_PASSWORD_HASH:
      "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g",
    ERP_SSO_ISSUER: "test-erp",
    ERP_SSO_PUBLIC_KEY_PEM:
      "-----BEGIN PUBLIC KEY-----\\nAAAA\\n-----END PUBLIC KEY-----",
    SSO_ALLOWED_REFERRER_ORIGINS: "http://127.0.0.1:4000",
    ...overrides,
  };
}
