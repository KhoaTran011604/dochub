import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

const readEnvFile = (file: string): Record<string, string | undefined> =>
  existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};

// Cấu hình stack đang chạy (infra/.env) + bí mật chỉ của E2E (tests/e2e/.env,
// xem .env.example). Biến môi trường của shell thắng cả hai.
const settings = {
  ...readEnvFile(path.join(REPO_ROOT, "infra", ".env")),
  ...readEnvFile(path.join(import.meta.dirname, ".env")),
  ...process.env,
};

function required(name: string): string {
  const value = settings[name];
  if (!value)
    throw new Error(`E2E: ${name} is not set (infra/.env or tests/e2e/.env)`);
  return value;
}

export const e2eEnvironment = {
  outlineUrl: required("OUTLINE_URL").replace(/\/+$/, ""),
  bridgeUrl: required("BRIDGE_PUBLIC_URL").replace(/\/+$/, ""),
  erpSsoIssuer: required("ERP_SSO_ISSUER"),
  erpSsoAudience: settings.ERP_SSO_AUDIENCE ?? "hd-document-sso",
  /** Referer mà trang ERP sẽ gửi khi user bấm link. */
  erpReferrer: `${required("SSO_ALLOWED_REFERRER_ORIGINS").split(",")[0]?.trim() ?? ""}/`,
  systemAdminUsername: required("E2E_SYSTEM_ADMIN_USERNAME"),
  systemAdminPassword: required("E2E_SYSTEM_ADMIN_PASSWORD"),
  /** Role owner, để CLI seed ghi `erp_users`. */
  appDatabaseUrl:
    settings.APP_DATABASE_URL ??
    `postgres://hd_document_apps:${required("APP_DB_PASSWORD")}@localhost:${settings.POSTGRES_HOST_PORT ?? "5432"}/hd_document_apps`,
};

/**
 * Cấu hình cho test tạo node (phase 5). Service key của test tạo bằng
 * `manage-service-client create e2e-test --scopes users:write,permissions:write,documents:create --project-keys "*"`
 * rồi đặt `E2E_PERMISSION_API_SERVICE_KEY` trong tests/e2e/.env. Thiếu key → spec tự skip.
 */
export const createNodeEnvironment = {
  permissionApiUrl: (
    settings.E2E_PERMISSION_API_URL ??
    `http://localhost:${settings.PERMISSION_API_HOST_PORT ?? "4100"}`
  ).replace(/\/+$/, ""),
  serviceKey: settings.E2E_PERMISSION_API_SERVICE_KEY,
  /** Token admin của Outline, chỉ để dọn doc test. */
  outlineAdminToken: settings.OUTLINE_ADMIN_API_TOKEN,
};
