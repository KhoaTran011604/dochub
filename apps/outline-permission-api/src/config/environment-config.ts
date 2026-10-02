import { z } from "zod";

const httpUrl = z
  .url({ protocol: /^https?$/ })
  // Bỏ "/" cuối để nối path không lệch.
  .transform((value) => value.replace(/\/+$/, ""));

const booleanFlag = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  /** Kết nối bằng role `permission_api_app` (không phải owner). */
  PERMISSION_API_DATABASE_URL: z.string().min(1),
  /** true khi chạy sau reverse proxy: tin X-Forwarded-* (IP thật cho audit log). */
  TRUST_PROXY: booleanFlag.default(false),

  /** URL public của Outline: dùng để tạo link trả cho ERP. */
  OUTLINE_URL: httpUrl,
  /**
   * URL mà service này gọi Outline API (trong mạng compose là
   * `http://outline:3000`). Bỏ trống = dùng OUTLINE_URL.
   */
  OUTLINE_INTERNAL_URL: httpUrl.optional(),
  /** API key của `system_admin` (Settings → API). Không log, không trả về. */
  OUTLINE_ADMIN_API_TOKEN: z.string().min(1),
  /** Không bao giờ suspend hay đổi quyền account mang email này qua API. */
  SYSTEM_ADMIN_EMAIL: z.email(),
});

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

/**
 * Đọc + kiểm env, sai thì ném lỗi ngay lúc khởi động. Thông báo chỉ nêu TÊN
 * biến và lý do, không in giá trị (nhiều biến là secret).
 */
export function loadEnvironmentConfig(
  source: Record<string, string | undefined> = process.env,
): EnvironmentConfig {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid outline-permission-api environment:\n${problems}`);
  }
  return result.data;
}
