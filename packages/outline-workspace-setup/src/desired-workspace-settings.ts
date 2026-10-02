import { z } from "zod";
import type { OutlineTeamUpdateInput } from "@hd-document/outline-api-client";

/** Bỏ chuỗi rỗng (compose để trống biến) coi như không đặt. */
const optionalString = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const workspaceBrandingEnvSchema = z.object({
  WORKSPACE_NAME: z.string().min(1),
  WORKSPACE_LOGO_URL: optionalString(z.url()),
  WORKSPACE_ACCENT_COLOR: optionalString(
    z.string().regex(/^#[0-9a-f]{6}$/i, "must be a 6-digit hex color like #1a2b3c"),
  ),
});

/** Màu chữ trên nền accent: cố định trắng, không có biến env riêng (xem phase-03). */
const ACCENT_TEXT_COLOR = "#FFFFFF";

/**
 * Cấu hình workspace mong muốn: phần lấy từ env (tên, logo, màu nhấn) ghép với
 * phần cố định đã chốt ở phase-03 (mục "Team settings mong muốn").
 */
export function loadDesiredWorkspaceSettings(
  source: Record<string, string | undefined> = process.env,
): OutlineTeamUpdateInput {
  const result = workspaceBrandingEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid workspace branding environment:\n${problems}`);
  }
  const env = result.data;

  return {
    name: env.WORKSPACE_NAME,
    ...(env.WORKSPACE_LOGO_URL ? { avatarUrl: env.WORKSPACE_LOGO_URL } : {}),
    // Bật public sharing ở cấp workspace để toggle "Publish to web" xuất hiện trong
    // Share popover của tài liệu (kèm "Include nested documents" cho trang con).
    // Tắt ở đây = Outline ẩn toggle ở mọi collection/tài liệu, dù collection.sharing = true.
    sharing: true,
    guestSignin: false,
    passkeysEnabled: false,
    memberCollectionCreate: false,
    memberTeamCreate: false,
    defaultUserRole: "member",
    inviteRequired: true,
    preferences: {
      publicBranding: true,
      membersCanInvite: false,
      membersCanCreateApiKey: false,
      membersCanDeleteAccount: false,
      mcp: false,
      ...(env.WORKSPACE_ACCENT_COLOR
        ? {
            customTheme: {
              accent: env.WORKSPACE_ACCENT_COLOR,
              accentText: ACCENT_TEXT_COLOR,
            },
          }
        : {}),
    },
  };
}
