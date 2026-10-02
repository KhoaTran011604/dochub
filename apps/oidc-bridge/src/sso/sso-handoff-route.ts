import type { Context, Middleware } from "koa";
import type { ErpUserDirectoryReader } from "../accounts/erp-user-directory-reader.ts";
import type { AuthAuditLogger } from "../audit/auth-audit-logger.ts";
import { erpAccountId } from "../provider/find-account-and-claims.ts";
import { BRIDGE_COOKIE_NAMES } from "../provider/oidc-provider-configuration.ts";
import { renderErrorPage, sendHtmlPage } from "../views/html-page-layout.ts";
import {
  checkSsoRequestReferrer,
  type ReferrerPolicy,
} from "./check-sso-request-referrer.ts";
import type { ErpPublicKey } from "./erp-public-key-resolver.ts";
import {
  HANDOFF_LIFETIME_SECONDS,
  type SsoHandoffRepository,
} from "./sso-handoff-repository.ts";
import {
  validateReturnToUrl,
  type ReturnToAllowList,
} from "./validate-return-to-url.ts";
import {
  verifyErpHandoffToken,
  type HandoffTokenPolicy,
} from "./verify-erp-handoff-token.ts";

export const SSO_HANDOFF_COOKIE_NAME = "hd_sso_handoff";
/** Cookie chỉ gửi tới các route đăng nhập, không tới /auth, /token... */
export const SSO_HANDOFF_COOKIE_PATH = "/interaction";

export interface SsoHandoffRouteDependencies {
  erpPublicKey: ErpPublicKey;
  tokenPolicy: HandoffTokenPolicy;
  referrerPolicy: ReferrerPolicy;
  returnToAllowList: ReturnToAllowList;
  handoffs: SsoHandoffRepository;
  readErpUser: ErpUserDirectoryReader;
  audit: AuthAuditLogger;
  erpPortalUrl: string | undefined;
}

const firstQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** Cookie mang handoff_id (không mang danh tính) tới /interaction; dùng chung cho /sso và callback IdP. */
export function setSsoHandoffCookie(ctx: Context, handoffId: string): void {
  ctx.cookies.set(SSO_HANDOFF_COOKIE_NAME, handoffId, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.secure,
    path: SSO_HANDOFF_COOKIE_PATH,
    maxAge: HANDOFF_LIFETIME_SECONDS * 1000,
  });
}

/**
 * GET /sso?token=<jwt>&returnTo=<url>: đổi JWT 1 lần của ERP lấy cookie
 * handoff, rồi đưa trình duyệt về `returnTo`. Outline chưa có phiên sẽ tự đi
 * vòng OIDC về /interaction, nơi handoff được dùng để đăng nhập không mật khẩu.
 *
 * Từ chối ở mức token/Referer mà `returnTo` hợp lệ → vẫn 302 về `returnTo`
 * nhưng KHÔNG kèm handoff: user đang có phiên Outline đi tiếp (F5, bấm lại link
 * cũ không vỡ), user chưa có phiên dừng ở form đăng nhập.
 */
export function createSsoHandoffRoute(
  deps: SsoHandoffRouteDependencies,
): Middleware {
  return async (ctx: Context) => {
    ctx.set("Cache-Control", "no-store");
    // Token nằm trên URL: không để lộ sang trang kế tiếp qua header Referer.
    ctx.set("Referrer-Policy", "no-referrer");

    const requestInfo = {
      ip: ctx.ip,
      userAgent: ctx.get("user-agent") || undefined,
    };
    const reject = (
      reason: string,
      subject?: string,
      detail: Record<string, string> = {},
    ) =>
      deps.audit({
        event: "sso_handoff",
        outcome: "rejected",
        subject,
        ...requestInfo,
        detail: { reason, ...detail },
      });
    const errorPage = (status: number, message: string) =>
      sendHtmlPage(ctx, status, renderErrorPage(message, deps.erpPortalUrl));

    const returnTo = validateReturnToUrl(
      firstQueryValue(ctx.query.returnTo),
      deps.returnToAllowList,
    );
    if (!returnTo.ok) {
      await reject(returnTo.reason);
      errorPage(400, "Đường dẫn quay về không hợp lệ. Mở lại tài liệu từ ERP.");
      return;
    }

    const referrer = checkSsoRequestReferrer(
      ctx.get("referer") || undefined,
      deps.referrerPolicy,
    );
    if (!referrer.ok) {
      await reject(
        referrer.reason,
        undefined,
        referrer.origin ? { referrerOrigin: referrer.origin } : {},
      );
      ctx.redirect(returnTo.url);
      return;
    }

    const verification = await verifyErpHandoffToken(
      firstQueryValue(ctx.query.token),
      deps.erpPublicKey,
      deps.tokenPolicy,
    );
    if (!verification.ok) {
      await reject(verification.reason);
      ctx.redirect(returnTo.url);
      return;
    }
    const { erpUserId, jti, expiresAt } = verification.token;
    const subject = erpAccountId(erpUserId);

    const lookup = await deps.readErpUser(erpUserId);
    if (!lookup.found) {
      await reject(lookup.reason, subject, { jti });
      errorPage(
        403,
        "Tài khoản của bạn chưa được cấp quyền vào hệ thống tài liệu.",
      );
      return;
    }

    const handoff = await deps.handoffs.create({
      jti,
      erpUserId,
      tokenExpiresAt: expiresAt,
      ip: ctx.ip,
    });
    if (!handoff.created) {
      await reject("token_replayed", subject, { jti });
      ctx.redirect(returnTo.url);
      return;
    }

    // Bridge đang giữ session của account khác thì provider sẽ trả luôn account
    // đó và bỏ qua handoff. Xóa cookie session → luôn vào /interaction.
    ctx.cookies.set(BRIDGE_COOKIE_NAMES.session, null, { signed: true });
    setSsoHandoffCookie(ctx, handoff.handoffId);

    await deps.audit({
      event: "sso_handoff",
      outcome: "success",
      subject,
      ...requestInfo,
      detail: { jti },
    });
    ctx.redirect(returnTo.url);
  };
}
