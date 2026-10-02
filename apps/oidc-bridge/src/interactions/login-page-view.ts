import { escapeHtml, renderHtmlPage } from "../views/html-page-layout.ts";

export interface LoginPageModel {
  interactionUid: string;
  csrfToken: string;
  erpPortalUrl: string | undefined;
  /** Hiện 1 thông báo chung khi đăng nhập sai (không nói sai username hay mật khẩu). */
  showError: boolean;
}

/** Form đăng nhập của system_admin. User ERP không có mật khẩu ở đây. */
export function renderLoginPage(model: LoginPageModel): string {
  const error = model.showError
    ? `<p class="error" role="alert">Sai thông tin đăng nhập, hoặc tài khoản đang bị tạm khóa. Thử lại sau.</p>`
    : "";
  const erpHint = model.erpPortalUrl
    ? `Người dùng ERP: mở tài liệu từ <a href="${escapeHtml(model.erpPortalUrl)}">ERP</a>.`
    : "Người dùng ERP: mở tài liệu từ ERP.";

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
<p class="hint">${erpHint}</p>`,
  );
}
