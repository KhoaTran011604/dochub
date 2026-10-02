import { randomUUID } from "node:crypto";
import type Router from "@koa/router";
import type { Context } from "koa";
import type { ErpUserAutoProvisioner } from "../accounts/erp-user-auto-provisioner.ts";
import type {
  ErpUserDirectoryReader,
  ErpUserLookup,
} from "../accounts/erp-user-directory-reader.ts";
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
import type {
  UpstreamOidcClient,
  UpstreamUserProfile,
} from "./upstream-oidc-client.ts";

export const UPSTREAM_CALLBACK_PATH = "/upstream/callback";
const IDP_UNAVAILABLE_MESSAGE =
  "Hệ thống đăng nhập (IdP) tạm thời không phản hồi. Thử lại sau ít phút.";
const NOT_PROVISIONED_MESSAGE =
  "Tài khoản của bạn chưa được cấp quyền vào hệ thống tài liệu.";

export interface UpstreamLoginDependencies {
  upstream: UpstreamOidcClient;
  handoffs: SsoHandoffRepository;
  readErpUser: ErpUserDirectoryReader;
  /** Có = user IdP chưa có trong `erp_users` được tự tạo ở lần đăng nhập đầu. */
  autoProvision: ErpUserAutoProvisioner | undefined;
  audit: AuthAuditLogger;
  erpPortalUrl: string | undefined;
}

type ProvisionOutcome =
  | { ok: true; lookup: ErpUserLookup }
  | { ok: false; status: number; message: string; reason: string; detail?: string };

/**
 * User IdP biết nhưng `erp_users` chưa có: tạo qua permission API bằng email/tên
 * trong id_token (IdP ký, không phải input từ trình duyệt), rồi tra lại. Chỉ
 * nhận email đã verify: Outline khớp account theo email.
 */
async function provisionFirstLogin(
  deps: UpstreamLoginDependencies,
  sub: string,
  profile: UpstreamUserProfile,
): Promise<ProvisionOutcome> {
  if (!deps.autoProvision) {
    return { ok: false, status: 403, message: NOT_PROVISIONED_MESSAGE, reason: "unknown_user" };
  }
  if (!profile.email || profile.emailVerified === false) {
    return {
      ok: false,
      status: 403,
      message: NOT_PROVISIONED_MESSAGE,
      reason: "profile_unusable",
      detail: profile.email ? "email_unverified" : "email_missing",
    };
  }
  const provisioned = await deps.autoProvision({
    erpUserId: sub,
    email: profile.email,
    name: profile.name ?? profile.email,
  });
  if (!provisioned.ok) {
    const unavailable = provisioned.reason === "provision_unavailable";
    return {
      ok: false,
      status: unavailable ? 503 : 403,
      message: unavailable
        ? "Hệ thống cấp quyền tạm thời không phản hồi. Thử lại sau ít phút."
        : NOT_PROVISIONED_MESSAGE,
      reason: provisioned.reason,
      detail: provisioned.detail,
    };
  }
  return { ok: true, lookup: await deps.readErpUser(sub) };
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
    let lookup = await deps.readErpUser(completion.sub);
    let provisionedNow = false;
    if (!lookup.found && lookup.reason === "unknown_user") {
      const outcome = await provisionFirstLogin(deps, completion.sub, completion.profile);
      if (!outcome.ok) {
        return reject(outcome.status, outcome.message, outcome.reason, subject, {
          code: outcome.detail,
        });
      }
      lookup = outcome.lookup;
      provisionedNow = true;
    }
    if (!lookup.found) {
      return reject(403, NOT_PROVISIONED_MESSAGE, lookup.reason, subject);
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
      detail: provisionedNow ? { autoProvisioned: true } : {},
    });
    ctx.redirect(`/interaction/${encodeURIComponent(pending.interactionUid)}`);
  });
}
