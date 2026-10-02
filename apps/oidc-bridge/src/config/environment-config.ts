import { z } from "zod";

/** Thuật toán bất đối xứng chấp nhận cho JWT handoff của ERP. Không bao giờ `none`/HS*. */
const ERP_SSO_ALGORITHMS = ["ES256", "RS256"] as const;

const httpUrl = z
  .url({ protocol: /^https?$/ })
  // Bỏ "/" cuối để nối path và so origin không lệch.
  .transform((value) => value.replace(/\/+$/, ""));

const commaList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const booleanFlag = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const optional = <T extends z.ZodType>(schema: T) =>
  // Compose truyền biến chưa đặt thành chuỗi rỗng → coi như không có.
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4001),
    /** URL trình duyệt dùng để vào bridge; cũng là `issuer` của OIDC. */
    BRIDGE_PUBLIC_URL: httpUrl,
    /** Kết nối bằng role `bridge_app` (không phải owner). */
    BRIDGE_DATABASE_URL: z.string().min(1),
    /** Khóa ký cookie (keygrip). Nhiều khóa cách nhau dấu phẩy: khóa đầu để ký, còn lại để xoay. */
    BRIDGE_COOKIE_KEYS: z
      .string()
      .transform(commaList)
      .pipe(z.array(z.string().min(32)).min(1)),
    /** JWKS private (JSON) để ký id_token; sinh bằng scripts/generate-signing-jwks.ts. */
    BRIDGE_SIGNING_JWKS: z.string().transform((value, context) => {
      try {
        return z
          .object({ keys: z.array(z.record(z.string(), z.unknown())).min(1) })
          .parse(JSON.parse(value));
      } catch {
        context.addIssue({
          code: "custom",
          message: "must be a JSON JWKS with at least 1 key",
        });
        return z.NEVER;
      }
    }),
    /** true khi chạy sau reverse proxy: tin X-Forwarded-* (IP thật, HTTPS). */
    TRUST_PROXY: booleanFlag.default(false),

    OUTLINE_URL: httpUrl,
    OIDC_CLIENT_ID: z.string().min(1).default("outline"),
    OIDC_CLIENT_SECRET: z.string().min(32),

    SYSTEM_ADMIN_USERNAME: z.string().min(1).max(100),
    SYSTEM_ADMIN_EMAIL: z.email(),
    SYSTEM_ADMIN_DISPLAY_NAME: z.string().min(1).default("System Admin"),
    SYSTEM_ADMIN_PASSWORD_HASH: z.string().startsWith("$argon2id$"),

    ERP_SSO_ISSUER: z.string().min(1),
    ERP_SSO_AUDIENCE: z.string().min(1).default("hd-document-sso"),
    ERP_SSO_ALGORITHMS: z
      .string()
      .default("ES256")
      .transform(commaList)
      .pipe(z.array(z.enum(ERP_SSO_ALGORITHMS)).min(1)),
    ERP_SSO_JWKS_URL: optional(httpUrl),
    /** PEM SPKI; trong env xuống dòng viết là `\n`. */
    ERP_SSO_PUBLIC_KEY_PEM: optional(
      z.string().transform((value) => value.replace(/\\n/g, "\n")),
    ),
    SSO_TOKEN_MAX_LIFETIME_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(600)
      .default(120),
    /** Tắt chỉ khi ERP không gửi được Referer (xem phase 2, mục login CSRF). */
    SSO_REQUIRE_REFERRER: booleanFlag.default(true),
    SSO_ALLOWED_REFERRER_ORIGINS: z
      .string()
      .default("")
      .transform(commaList)
      .pipe(z.array(httpUrl.transform((value) => new URL(value).origin))),

    PERMISSION_API_PUBLIC_URL: optional(httpUrl),
    ERP_PORTAL_URL: optional(httpUrl),
  })
  .superRefine((env, context) => {
    // Production: đặt đúng 1 nguồn khóa. Cả hai chỉ để dev (xem erp-public-key-resolver).
    if (!env.ERP_SSO_JWKS_URL && !env.ERP_SSO_PUBLIC_KEY_PEM) {
      context.addIssue({
        code: "custom",
        path: ["ERP_SSO_JWKS_URL"],
        message: "set ERP_SSO_JWKS_URL or ERP_SSO_PUBLIC_KEY_PEM",
      });
    }
    if (
      env.SSO_REQUIRE_REFERRER &&
      env.SSO_ALLOWED_REFERRER_ORIGINS.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["SSO_ALLOWED_REFERRER_ORIGINS"],
        message: "required while SSO_REQUIRE_REFERRER=true",
      });
    }
    if (env.ERP_SSO_PUBLIC_KEY_PEM && env.ERP_SSO_ALGORITHMS.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["ERP_SSO_ALGORITHMS"],
        message: "a PEM key has exactly one algorithm",
      });
    }
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
      .map(
        (issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`Invalid oidc-bridge environment:\n${problems}`);
  }
  return result.data;
}
