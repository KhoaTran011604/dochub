export interface ReturnToAllowList {
  /** Mọi path trên origin này đều được. */
  outlineUrl: string;
  /** Chỉ path bắt đầu bằng `/pending/` (phase 5). Chưa cấu hình thì bỏ qua. */
  permissionApiPublicUrl?: string | undefined;
}

export type ReturnToValidation =
  | { ok: true; url: string }
  | { ok: false; reason: "return_to_malformed" | "return_to_not_allowed" };

const PENDING_PATH_PREFIX = "/pending/";

/**
 * Chống open redirect: `returnTo` phải là URL tuyệt đối có origin nằm trong
 * allow-list. So sánh trên kết quả của `new URL()` (đã chuẩn hóa `\`, `..`,
 * `%2e`), không so chuỗi thô. Trả về URL đã chuẩn hóa để redirect.
 */
export function validateReturnToUrl(
  rawReturnTo: string | undefined,
  allowList: ReturnToAllowList,
): ReturnToValidation {
  const outlineOrigin = new URL(allowList.outlineUrl).origin;
  if (rawReturnTo === undefined || rawReturnTo === "") {
    return { ok: true, url: `${outlineOrigin}/` };
  }

  let target: URL;
  try {
    // Không truyền base: URL tương đối và `//host` không parse được → từ chối.
    target = new URL(rawReturnTo);
  } catch {
    return { ok: false, reason: "return_to_malformed" };
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, reason: "return_to_not_allowed" };
  }
  // `https://outline@evil.example/` trông giống Outline với người đọc log.
  if (target.username !== "" || target.password !== "") {
    return { ok: false, reason: "return_to_not_allowed" };
  }

  if (target.origin === outlineOrigin) return { ok: true, url: target.href };

  if (
    allowList.permissionApiPublicUrl &&
    target.origin === new URL(allowList.permissionApiPublicUrl).origin &&
    target.pathname.startsWith(PENDING_PATH_PREFIX)
  ) {
    return { ok: true, url: target.href };
  }

  return { ok: false, reason: "return_to_not_allowed" };
}
