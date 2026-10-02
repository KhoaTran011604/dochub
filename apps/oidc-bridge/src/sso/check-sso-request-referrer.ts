export type ReferrerCheck =
  | { ok: true }
  /** `origin`: origin đã gửi tới (không kèm path/query) để ghi audit khi cấu hình sai. */
  | {
      ok: false;
      reason: "referrer_missing" | "referrer_not_allowed";
      origin?: string;
    };

export interface ReferrerPolicy {
  required: boolean;
  /** Origin đã chuẩn hóa (`new URL(x).origin`). */
  allowedOrigins: readonly string[];
}

/**
 * Giảm login CSRF: link /sso chỉ được mở từ trang ERP. Link dán vào mail/chat
 * hoặc nhúng ở trang lạ sẽ không có Referer của ERP → bị chặn.
 * Không phải lớp chống giả mạo duy nhất (token vẫn 1 lần + sống ≤ 60s).
 */
export function checkSsoRequestReferrer(
  refererHeader: string | undefined,
  policy: ReferrerPolicy,
): ReferrerCheck {
  if (!policy.required) return { ok: true };
  if (!refererHeader) return { ok: false, reason: "referrer_missing" };

  let origin: string;
  try {
    origin = new URL(refererHeader).origin;
  } catch {
    return { ok: false, reason: "referrer_not_allowed" };
  }
  return policy.allowedOrigins.includes(origin)
    ? { ok: true }
    : { ok: false, reason: "referrer_not_allowed", origin };
}
