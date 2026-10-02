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
  /** Có IdP thật: nút SSO đưa sang IdP; thay cho nút "Đăng nhập qua ERP" (handoff). */
  upstreamLoginUrl?: string | undefined;
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

/** Phần dành cho user ERP: nút SSO sang IdP thật, hoặc nút/hướng dẫn handoff của ERP. */
function renderErpUserSection(model: LoginPageModel): string {
  if (model.upstreamLoginUrl) {
    return `<a class="button-link" href="${escapeHtml(model.upstreamLoginUrl)}">Đăng nhập SSO (tài khoản HDWebsoft)</a>`;
  }
  const ssoStartUrl = buildErpSsoStartUrl(model.erpPortalUrl, model.outlineUrl);
  return ssoStartUrl
    ? `<a class="button-link" href="${escapeHtml(ssoStartUrl)}">Đăng nhập qua ERP</a>
<p class="hint">Người dùng ERP: bấm nút trên, hoặc mở tài liệu từ <a href="${escapeHtml(model.erpPortalUrl ?? "")}">ERP</a>.</p>`
    : `<p class="hint">Người dùng ERP: mở tài liệu từ ERP.</p>`;
}

/** Trang đăng nhập: SSO cho user ERP (nếu có) + form system_admin. */
export function renderLoginPage(model: LoginPageModel): string {
  const error = model.showError
    ? `<p class="error" role="alert">Sai thông tin đăng nhập, hoặc tài khoản đang bị tạm khóa. Thử lại sau.</p>`
    : "";
  const adminForm = `<form method="post" action="/interaction/${encodeURIComponent(model.interactionUid)}/login" autocomplete="off">
  <input type="hidden" name="csrf" value="${escapeHtml(model.csrfToken)}">
  <label for="username">Tên đăng nhập</label>
  <input id="username" name="username" type="text" required maxlength="100" autocapitalize="none" value="system_admin">
  <label for="password">Mật khẩu</label>
  <input id="password" name="password" type="password" required maxlength="1024" value="zi29bbyn3RpfCXbjKGPmdl_e">
  <button type="submit">Đăng nhập</button>
</form>`;

  // Có IdP thật: SSO lên đầu, form admin xuống dưới (đường phụ / break-glass).
  const sections = model.upstreamLoginUrl
    ? [
      `<h1>Đăng nhập</h1>${error}`,
      renderErpUserSection(model),
      `<div class="divider">quản trị hệ thống</div>`,
      adminForm,
    ]
    : [
      `<h1>Đăng nhập quản trị</h1>${error}`,
      adminForm,
      `<div class="divider">hoặc</div>`,
      renderErpUserSection(model),
    ];
  return renderHtmlPage("Đăng nhập", sections.join("\n"));
}
