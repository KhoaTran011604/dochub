import { z } from "zod";

const httpUrl = z
  .url({ protocol: /^https?$/ })
  // Bỏ "/" cuối để nối path không lệch.
  .transform((value) => value.replace(/\/+$/, ""));

const booleanFlag = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** Compose truyền biến chưa đặt thành chuỗi rỗng: coi như không có. */
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

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

  /**
   * API tạo node với tác giả là user thật (phase 5). Thiếu 1 trong 4 biến
   * (PUBLIC_URL, OAUTH_CLIENT_ID/SECRET, TOKEN_SEAL_PASSWORD) = tắt cả nhóm route.
   * PUBLIC_URL: URL trình duyệt của user mở được tới service này (pendingUrl,
   * redirect URI `{PUBLIC_URL}/oauth/outline/callback` khai báo ở OAuth client).
   */
  PERMISSION_API_PUBLIC_URL: z.preprocess(emptyAsUndefined, httpUrl.optional()),
  OUTLINE_OAUTH_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  OUTLINE_OAUTH_CLIENT_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  /** Scope xin ở màn đồng ý (đã kiểm trên Outline 1.10.1); `read` cho API cây tài liệu, tự thêm nếu thiếu. */
  OUTLINE_OAUTH_SCOPE: z.preprocess(emptyAsUndefined, z.string().min(1).default("documents:create auth:read read")),
  /** Khóa niêm phong token Outline của user (iron-webcrypto), ≥ 32 ký tự. Đổi khóa = mọi user phải đồng ý lại. */
  TOKEN_SEAL_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  PENDING_REQUEST_TTL_DAYS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(90).default(7)),
  /** Link "quay lại ERP" trên dòng lỗi của route trình duyệt. */
  ERP_PORTAL_URL: z.preprocess(emptyAsUndefined, httpUrl.optional()),

  /** SMTP Configuration for sending emails */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** The "From" email address to use for sent emails */
  MAIL_FROM_EMAIL: z.string().default("HD Document <no-reply@hd-document.example.com>"),
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
