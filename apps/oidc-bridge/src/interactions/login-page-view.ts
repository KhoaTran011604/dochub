import { escapeHtml, renderHtmlPage } from "../views/html-page-layout.ts";

/**
 * Đường dẫn trên ERP nhận user từ nút "Đăng nhập qua ERP" (hợp đồng với ERP):
 * ERP hiển thị 1 trang rồi điều hướng (window.location) sang `/sso` của bridge,
 * để header Referer là origin của ERP. ERP trả 302 thẳng sẽ bị bridge từ chối
 * (`referrer_not_allowed`).
 */
export const ERP_SSO_START_PATH = "/sso/start";

export interface LoginPageModel {
  interactionUid: string;
  csrfToken: string;
  erpPortalUrl: string | undefined;
  /** URL Outline mà ERP sẽ đưa user về sau khi ký handoff. */
  outlineUrl: string;
  /** Hiện 1 thông báo chung khi đăng nhập sai (không nói sai username hay mật khẩu). */
  showError: boolean;
}

/** Link sang trang bắt đầu SSO của ERP; undefined khi chưa cấu hình ERP_PORTAL_URL. */
export function buildErpSsoStartUrl(
  erpPortalUrl: string | undefined,
  outlineUrl: string,
): string | undefined {
  if (!erpPortalUrl) return undefined;
  // Config đã bỏ "/" cuối của ERP_PORTAL_URL; nối chuỗi để giữ base path (vd. /portal).
  const url = new URL(`${erpPortalUrl}${ERP_SSO_START_PATH}`);
  url.searchParams.set("returnTo", outlineUrl);
  return url.toString();
}

/** Form đăng nhập của system_admin. User ERP không có mật khẩu ở đây. */
export function renderLoginPage(model: LoginPageModel): string {
  const error = model.showError
    ? `<p class="error" role="alert">Sai thông tin đăng nhập, hoặc tài khoản đang bị tạm khóa. Thử lại sau.</p>`
    : "";
  const ssoStartUrl = buildErpSsoStartUrl(model.erpPortalUrl, model.outlineUrl);
  const erpSection = ssoStartUrl
    ? `<a class="button-link" href="${escapeHtml(ssoStartUrl)}">Đăng nhập qua ERP</a>
<p class="hint">Người dùng ERP: bấm nút trên, hoặc mở tài liệu từ <a href="${escapeHtml(model.erpPortalUrl ?? "")}">ERP</a>.</p>`
    : `<p class="hint">Người dùng ERP: mở tài liệu từ ERP.</p>`;

  return renderHtmlPage(
    "Đăng nhập quản trị",
    `<h1>Đăng nhập quản trị</h1>
${error}
<form method="post" action="/interaction/${encodeURIComponent(model.interactionUid)}/login" autocomplete="off">
  <input type="hidden" name="csrf" value="${escapeHtml(model.csrfToken)}">
  <label for="username">Tên đăng nhập</label>
  <input id="username" name="username" type="text" required autofocus maxlength="100" autocapitalize="none">
  <label for="password">Mật khẩu</label>
  <input id="password" name="password" type="password" required maxlength="1024">
  <button type="submit">Đăng nhập</button>
</form>
<div class="divider">hoặc</div>
${erpSection}`,
  );
}
