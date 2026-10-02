import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type Router from "@koa/router";
import type { RouterContext } from "@koa/router";
import type Provider from "oidc-provider";
import type { ErpUserDirectoryReader } from "../accounts/erp-user-directory-reader.ts";
import type { AuthAuditLogger } from "../audit/auth-audit-logger.ts";
import {
  normalizeUsername,
  type SystemAdminAuthenticator,
} from "../auth/local-system-admin-authenticator.ts";
import type { LoginRateLimiter } from "../auth/login-rate-limiter-and-lockout.ts";
import { SYSTEM_ADMIN_ACCOUNT_ID } from "../provider/find-account-and-claims.ts";
import type { SsoHandoffRepository } from "../sso/sso-handoff-repository.ts";
import {
  UPSTREAM_RETURN_QUERY,
  type RedirectToUpstreamLogin,
} from "../upstream/upstream-login-routes.ts";
import { renderErrorPage, sendHtmlPage } from "../views/html-page-layout.ts";
import { consumeSsoHandoffCookie } from "./consume-sso-handoff-cookie.ts";
import { renderLoginPage } from "./login-page-view.ts";
import { readUrlEncodedFormBody } from "./read-url-encoded-form-body.ts";

export interface LoginInteractionDependencies {
  provider: Provider;
  handoffs: SsoHandoffRepository;
  readErpUser: ErpUserDirectoryReader;
  authenticateSystemAdmin: SystemAdminAuthenticator;
  rateLimiter: LoginRateLimiter;
  audit: AuthAuditLogger;
  /** Khóa bí mật để sinh CSRF token (khóa ký cookie hiện hành). */
  csrfSecret: string;
  outlineOrigin: string;
  erpPortalUrl: string | undefined;
  /** Có IdP thật: user không có handoff được đưa sang IdP; form admin chỉ còn ở /admin. */
  redirectToUpstreamLogin: RedirectToUpstreamLogin | undefined;
}

const MAX_PASSWORD_LENGTH = 1024;
const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function registerLoginInteractionRoutes(
  router: Router,
  deps: LoginInteractionDependencies,
): void {
  // Token gắn với uid của interaction; uid lại gắn với cookie interaction của
  // đúng trình duyệt này → trang khác không tự submit form thay user được.
  const csrfTokenFor = (uid: string) =>
    createHmac("sha256", deps.csrfSecret)
      .update(`login-csrf:${uid}`)
      .digest("base64url");

  const requestInfo = (ctx: RouterContext) => ({
    ip: ctx.ip,
    userAgent: ctx.get("user-agent") || undefined,
  });

  const showExpired = (ctx: RouterContext) =>
    sendHtmlPage(
      ctx,
      400,
      renderErrorPage(
        "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Mở lại tài liệu từ đầu.",
        deps.erpPortalUrl,
      ),
    );

  const showForm = (
    ctx: RouterContext,
    uid: string,
    status: number,
    showError: boolean,
  ) =>
    sendHtmlPage(
      ctx,
      status,
      renderLoginPage({
        interactionUid: uid,
        csrfToken: csrfTokenFor(uid),
        erpPortalUrl: deps.erpPortalUrl,
        outlineUrl: deps.outlineOrigin,
        showError,
      }),
      { formActionOrigins: [deps.outlineOrigin] },
    );

  /** Interaction đang chờ đăng nhập của đúng trình duyệt này, hoặc undefined. */
  const loadLoginInteraction = async (
    ctx: RouterContext,
  ): Promise<string | undefined> => {
    try {
      const details = await deps.provider.interactionDetails(ctx.req, ctx.res);
      return details.uid === ctx.params.uid && details.prompt.name === "login"
        ? details.uid
        : undefined;
    } catch {
      return undefined; // Thiếu cookie interaction hoặc đã hết hạn.
    }
  };

  const finishLogin = async (ctx: RouterContext, accountId: string) => {
    const returnTo = await deps.provider.interactionResult(
      ctx.req,
      ctx.res,
      // remember: false → cookie session của bridge mất khi đóng trình duyệt.
      { login: { accountId, remember: false } },
      { mergeWithLastSubmission: false },
    );
    ctx.status = 303;
    ctx.redirect(returnTo);
  };

  router.get("/interaction/:uid", async (ctx) => {
    const uid = await loadLoginInteraction(ctx);
    if (!uid) return showExpired(ctx);

    const accountId = await consumeSsoHandoffCookie(ctx, deps);
    if (accountId) return finishLogin(ctx, accountId);
    if (!deps.redirectToUpstreamLogin) return showForm(ctx, uid, 200, false);
    // Vừa từ callback IdP về mà handoff không dùng được: báo lỗi, không đi IdP lần nữa.
    if (ctx.query[UPSTREAM_RETURN_QUERY] !== undefined) return showExpired(ctx);
    return deps.redirectToUpstreamLogin(ctx, uid);
  });

  // Break-glass: form system_admin vẫn vào được khi IdP thật đang chết.
  router.get("/interaction/:uid/admin", async (ctx) => {
    const uid = await loadLoginInteraction(ctx);
    if (!uid) return showExpired(ctx);
    showForm(ctx, uid, 200, false);
  });

  router.post("/interaction/:uid/login", async (ctx) => {
    const uid = await loadLoginInteraction(ctx);
    if (!uid) return showExpired(ctx);

    const form = await readUrlEncodedFormBody(ctx.req);
    const expectedCsrf = Buffer.from(csrfTokenFor(uid));
    const givenCsrf = Buffer.from(form?.csrf ?? "");
    if (
      givenCsrf.length !== expectedCsrf.length ||
      !timingSafeEqual(givenCsrf, expectedCsrf)
    ) {
      return showExpired(ctx);
    }

    const username = normalizeUsername(form?.username ?? "");
    const password = form?.password ?? "";
    // Bảng lockout không lưu chuỗi user gõ (có thể là mật khẩu gõ nhầm ô).
    const usernameKey = sha256Hex(username);
    const reject = async (reason: string, status: number) => {
      await deps.audit({
        event: "admin_login",
        outcome: "rejected",
        ...requestInfo(ctx),
        detail: { reason },
      });
      showForm(ctx, uid, status, true);
    };

    if (await deps.rateLimiter.isBlocked(usernameKey, ctx.ip))
      return reject("locked_out", 429);

    const authenticated =
      password.length <= MAX_PASSWORD_LENGTH &&
      (await deps.authenticateSystemAdmin(username, password));
    if (!authenticated) {
      await deps.rateLimiter.recordFailure(usernameKey, ctx.ip);
      return reject("invalid_credentials", 401);
    }

    await deps.rateLimiter.recordSuccess(usernameKey, ctx.ip);
    await deps.audit({
      event: "admin_login",
      outcome: "success",
      subject: SYSTEM_ADMIN_ACCOUNT_ID,
      ...requestInfo(ctx),
    });
    return finishLogin(ctx, SYSTEM_ADMIN_ACCOUNT_ID);
  });
}
