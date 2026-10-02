import type { Context } from "koa";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );

const STYLE = `
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f5f7;color:#1f2933;margin:0;padding:48px 16px}
  main{max-width:360px;margin:0 auto;background:#fff;border-radius:8px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  h1{font-size:20px;margin:0 0 16px}
  p{font-size:14px;line-height:1.5;margin:12px 0}
  label{display:block;font-size:13px;margin:14px 0 4px}
  input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #c5ccd3;border-radius:6px;font-size:14px}
  button{margin-top:20px;width:100%;padding:10px;border:0;border-radius:6px;background:#1d4ed8;color:#fff;font-size:14px;cursor:pointer}
  .error{color:#b42318}
  .hint{color:#52606d;border-top:1px solid #e4e7eb;margin-top:22px;padding-top:14px}
`;

/** Khung HTML chung cho mọi trang bridge tự render. `bodyHtml` phải đã escape. */
export function renderHtmlPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;
}

export interface HtmlPageOptions {
  /** Origin mà chuỗi redirect sau khi submit form đi tới (Chromium áp `form-action` lên cả redirect). */
  formActionOrigins?: string[];
  /** Cho phép đúng các thẻ <script nonce="..."> mang nonce này. */
  scriptNonce?: string;
}

/** Gửi trang HTML của bridge kèm header bảo mật. */
export function sendHtmlPage(
  ctx: Context,
  status: number,
  html: string,
  options: HtmlPageOptions = {},
): void {
  ctx.status = status;
  ctx.type = "html";
  ctx.set("Cache-Control", "no-store");
  ctx.set("Referrer-Policy", "no-referrer");
  ctx.set("X-Content-Type-Options", "nosniff");
  ctx.set("X-Frame-Options", "DENY");
  ctx.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      ...(options.scriptNonce
        ? [`script-src 'nonce-${options.scriptNonce}'`]
        : []),
      `form-action ${["'self'", ...(options.formActionOrigins ?? [])].join(" ")}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
  );
  ctx.body = html;
}

/** Trang lỗi dạng text + link quay về ERP (nếu cấu hình). */
export function renderErrorPage(
  message: string,
  erpPortalUrl: string | undefined,
): string {
  const link = erpPortalUrl
    ? `<p><a href="${escapeHtml(erpPortalUrl)}">Quay lại ERP</a></p>`
    : "";
  return renderHtmlPage(
    "Không đăng nhập được",
    `<h1>Không đăng nhập được</h1><p>${escapeHtml(message)}</p>${link}`,
  );
}
