import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import type { Context } from "koa";
import type { ErpUserDirectoryReader } from "../accounts/erp-user-directory-reader.ts";
import type { AuthAuditLogger } from "../audit/auth-audit-logger.ts";
import { erpAccountId } from "../provider/find-account-and-claims.ts";
import {
  HANDOFF_LIFETIME_SECONDS,
  type SsoHandoffRepository,
} from "../sso/sso-handoff-repository.ts";
import { setSsoHandoffCookie } from "../sso/sso-handoff-route.ts";
import { renderErrorPage, sendHtmlPage } from "../views/html-page-layout.ts";
import {
  setPendingUpstreamLogin,
  takePendingUpstreamLogin,
} from "./upstream-login-transaction-cookie.ts";
import type { UpstreamOidcClient } from "./upstream-oidc-client.ts";

export const UPSTREAM_CALLBACK_PATH = "/upstream/callback";
const IDP_UNAVAILABLE_MESSAGE =
  "Hệ thống đăng nhập (IdP) tạm thời không phản hồi. Thử lại sau ít phút.";

export interface UpstreamLoginDependencies {
  upstream: UpstreamOidcClient;
  handoffs: SsoHandoffRepository;
  readErpUser: ErpUserDirectoryReader;
  audit: AuthAuditLogger;
  erpPortalUrl: string | undefined;
}

/** Đưa trình duyệt sang IdP; gọi từ nút SSO (GET /interaction/:uid/upstream). */
export type RedirectToUpstreamLogin = (
  ctx: Context,
  interactionUid: string,
) => Promise<void>;

export function createRedirectToUpstreamLogin(
  deps: UpstreamLoginDependencies,
): RedirectToUpstreamLogin {
  return async (ctx, interactionUid) => {
    try {
      const { authorizationUrl, transaction } =
        await deps.upstream.startLogin();
      setPendingUpstreamLogin(ctx, { interactionUid, ...transaction });
      ctx.set("Cache-Control", "no-store");
      ctx.redirect(authorizationUrl);
    } catch (error) {
      console.error(
        "upstream IdP discovery failed:",
        error instanceof Error ? error.message : error,
      );
      sendHtmlPage(
        ctx,
        503,
        renderErrorPage(IDP_UNAVAILABLE_MESSAGE, deps.erpPortalUrl),
      );
    }
  };
}

/**
 * GET /upstream/callback?code&state: IdP trả user về. Kết quả thành công được
 * ghi thành handoff 1 lần (cùng bảng/cookie với /sso) rồi quay lại
 * /interaction/:uid — nơi cookie interaction của provider mới gửi tới — để
 * hoàn tất đăng nhập bằng đường có sẵn. Handoff không dùng được thì trang
 * đăng nhập hiện lại (không tự quay sang IdP → không lặp).
 */
export function registerUpstreamCallbackRoute(
  router: Router,
  deps: UpstreamLoginDependencies,
): void {
  router.get(UPSTREAM_CALLBACK_PATH, async (ctx) => {
    ctx.set("Cache-Control", "no-store");
    ctx.set("Referrer-Policy", "no-referrer");
    const requestInfo = {
      ip: ctx.ip,
      userAgent: ctx.get("user-agent") || undefined,
    };
    const reject = async (
      status: number,
      message: string,
      reason: string,
      subject?: string,
      detail: Record<string, string | undefined> = {},
    ) => {
      await deps.audit({
        event: "upstream_login",
        outcome: "rejected",
        subject,
        ...requestInfo,
        detail: { reason, ...detail },
      });
      sendHtmlPage(ctx, status, renderErrorPage(message, deps.erpPortalUrl));
    };

    const pending = takePendingUpstreamLogin(ctx);
    if (!pending) {
      return reject(
        400,
        "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Mở lại tài liệu từ đầu.",
        "transaction_missing",
      );
    }

    // URL đầy đủ như IdP gửi (có code, state, iss); openid-client tự đối chiếu.
    const callbackUrl = new URL(ctx.href);
    const completion = await deps.upstream.completeLogin(callbackUrl, pending);
    if (!completion.ok) {
      return reject(
        completion.reason === "idp_unavailable" ? 503 : 400,
        completion.reason === "idp_unavailable"
          ? IDP_UNAVAILABLE_MESSAGE
          : "Đăng nhập qua IdP không thành công. Mở lại tài liệu từ đầu.",
        completion.reason,
        undefined,
        { idpError: completion.detail },
      );
    }

    const subject = erpAccountId(completion.sub);
    const lookup = await deps.readErpUser(completion.sub);
    if (!lookup.found) {
      return reject(
        403,
        "Tài khoản của bạn chưa được cấp quyền vào hệ thống tài liệu.",
        lookup.reason,
        subject,
      );
    }

    const handoff = await deps.handoffs.create({
      jti: `upstream:${randomUUID()}`,
      erpUserId: completion.sub,
      tokenExpiresAt: new Date(Date.now() + HANDOFF_LIFETIME_SECONDS * 1000),
      ip: ctx.ip,
    });
    if (!handoff.created) {
      return reject(500, "Không tạo được phiên đăng nhập. Thử lại.", "handoff_not_created", subject);
    }
    setSsoHandoffCookie(ctx, handoff.handoffId);

    await deps.audit({
      event: "upstream_login",
      outcome: "success",
      subject,
      ...requestInfo,
    });
    ctx.redirect(`/interaction/${encodeURIComponent(pending.interactionUid)}`);
  });
}
