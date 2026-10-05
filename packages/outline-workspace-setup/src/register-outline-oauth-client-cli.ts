// Đăng ký (hoặc cập nhật `redirectUris` của) OAuth client dùng cho permission
// API (phase 5). `clientSecret` chỉ in ra đúng 1 lần lúc tạo mới — dán ngay
// vào infra/.env, không ghi lại được lần 2.
//   pnpm --filter @hd-document/outline-workspace-setup register-oauth-client
import {
  createOAuthClient,
  findOAuthClientByName,
  updateOAuthClient,
} from "@hd-document/outline-api-client";
import {
  loadDesiredOAuthClientSettings,
  PERMISSION_API_OAUTH_CLIENT_NAME,
} from "./desired-oauth-client-settings.ts";
import { loadOutlineAdminHttpClient } from "./outline-admin-connection-env.ts";

function redirectUrisMatch(current: string[], desired: string[]): boolean {
  return (
    current.length === desired.length &&
    current.every((uri, index) => uri === desired[index])
  );
}

try {
  const client = loadOutlineAdminHttpClient();
  const desired = loadDesiredOAuthClientSettings();
  const existing = await findOAuthClientByName(
    client,
    PERMISSION_API_OAUTH_CLIENT_NAME,
  );

  if (!existing) {
    const created = await createOAuthClient(client, desired);
    console.log(`Created OAuth client "${created.name}".`);
    console.log(`OUTLINE_OAUTH_CLIENT_ID=${created.clientId ?? created.id}`);
    console.log(`OUTLINE_OAUTH_CLIENT_SECRET=${created.clientSecret ?? ""}`);
    console.log("Copy both lines into infra/.env now: the secret is not shown again.");
    process.exit(0);
  }

  if (redirectUrisMatch(existing.redirectUris, desired.redirectUris)) {
    console.log(`OAuth client "${existing.name}" already registered. No changes.`);
    console.log(`OUTLINE_OAUTH_CLIENT_ID=${existing.id}`);
    process.exit(0);
  }

  const updated = await updateOAuthClient(client, {
    id: existing.id,
    redirectUris: desired.redirectUris,
  });
  console.log(`Updated redirectUris for OAuth client "${updated.name}".`);
  console.log(`OUTLINE_OAUTH_CLIENT_ID=${updated.id}`);
} catch (error) {
  console.error(
    "Register OAuth client failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
