import { z } from "zod";
import { createOutlineHttpClient, type OutlineHttpClient } from "@hd-document/outline-api-client";

// Dùng chung bởi 2 CLI: áp team settings và đăng ký OAuth client.
const outlineAdminConnectionEnvSchema = z.object({
  OUTLINE_URL: z.url({ protocol: /^https?$/ }),
  /** API key tạo bằng tay trong Settings → API của Outline (system_admin). Không log. */
  OUTLINE_ADMIN_API_TOKEN: z.string().min(1),
});

export function loadOutlineAdminHttpClient(
  source: Record<string, string | undefined> = process.env,
): OutlineHttpClient {
  const result = outlineAdminConnectionEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Outline admin connection environment:\n${problems}`);
  }
  return createOutlineHttpClient({
    baseUrl: result.data.OUTLINE_URL,
    token: result.data.OUTLINE_ADMIN_API_TOKEN,
  });
}
