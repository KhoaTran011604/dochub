import { z } from "zod";
import type { OutlineOAuthClientCreateInput } from "@hd-document/outline-api-client";

/** Tên cố định đã chốt ở phase-03, bước 5. */
export const PERMISSION_API_OAUTH_CLIENT_NAME = "hd-document-permission-api";

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .transform((value) => value.replace(/\/+$/, ""));

const oauthClientEnvSchema = z.object({
  PERMISSION_API_PUBLIC_URL: httpUrl,
});

/** OAuth client dùng cho permission API (phase 5) nhận token thay mặt user. */
export function loadDesiredOAuthClientSettings(
  source: Record<string, string | undefined> = process.env,
): OutlineOAuthClientCreateInput {
  const result = oauthClientEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid OAuth client environment:\n${problems}`);
  }

  return {
    name: PERMISSION_API_OAUTH_CLIENT_NAME,
    redirectUris: [`${result.data.PERMISSION_API_PUBLIC_URL}/oauth/outline/callback`],
    clientType: "confidential",
    published: true,
  };
}
