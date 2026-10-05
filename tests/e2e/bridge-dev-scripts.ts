import { execFileSync } from "node:child_process";
import path from "node:path";
import { e2eEnvironment, REPO_ROOT } from "./e2e-environment.ts";

const BRIDGE_DIR = path.join(REPO_ROOT, "apps", "oidc-bridge");

/** Chạy 1 script dev của bridge (đóng vai ERP). Không qua shell → tham số an toàn. */
export function runBridgeDevScript(script: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", path.join("scripts", "dev", script), ...args],
    {
      cwd: BRIDGE_DIR,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        APP_DATABASE_URL: e2eEnvironment.appDatabaseUrl,
        ERP_SSO_ISSUER: e2eEnvironment.erpSsoIssuer,
        ERP_SSO_AUDIENCE: e2eEnvironment.erpSsoAudience,
        BRIDGE_PUBLIC_URL: e2eEnvironment.bridgeUrl,
      },
    },
  ).trim();
}

/** Link SSO 1 lần của user ERP (JWT handoff ký bằng khóa dev). */
export const signSsoLink = (erpUserId: string, returnTo: string) =>
  runBridgeDevScript("sign-dev-sso-handoff-link.ts", [
    "--erp-user-id",
    erpUserId,
    "--return-to",
    returnTo,
  ]);

const PERMISSION_API_DIR = path.join(REPO_ROOT, "apps", "outline-permission-api");

/** Ép 1 pending request hết hạn (TTL thật 7 ngày). Script nằm ở apps/outline-permission-api/integration. */
export function expirePendingRequest(requestId: string): void {
  execFileSync(
    process.execPath,
    ["--import", "tsx", path.join("integration", "expire-pending-request-cli.ts"), requestId],
    {
      cwd: PERMISSION_API_DIR,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", APP_DATABASE_URL: e2eEnvironment.appDatabaseUrl },
    },
  );
}
