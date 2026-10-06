import type Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { ApiError } from "../http/api-error.ts";
import {
  buildAuthorizeUrl,
  createAuthorizationRequest,
} from "../outline-oauth/outline-oauth-authorization-flow.ts";
import type { CompletePendingRequestAfterConsent } from "./complete-pending-request-after-consent.ts";
import type { PendingDocumentRequestRepository } from "./pending-document-request-repository.ts";

const STATE_COOKIE = "hd_outline_oauth_state";
const CALLBACK_PATH = "/oauth/outline/callback";
const STATE_COOKIE_MAX_AGE_MS = 10 * 60_000;

/** Route trình duyệt: không render trang, lỗi chỉ là 1 dòng text + link về ERP. */
function renderFailure(ctx: Context, status: number, message: string, erpPortalUrl: string | undefined): void {
  ctx.status = status;
  ctx.type = "text/plain";
  ctx.body = erpPortalUrl ? `${message} Back to ERP: ${erpPortalUrl}` : message;
}

/** Yêu cầu chỉ xin đồng ý đã xong: không có doc để mở, đưa user về trang chủ Outline. */
function redirectGranted(ctx: Context, outlineUrl: string): void {
  ctx.redirect(outlineUrl);
}

export function registerPendingDocumentRoutes(
  router: Router,
  deps: {
    pendingRepository: PendingDocumentRequestRepository;
    completeAfterConsent: CompletePendingRequestAfterConsent;
    outlineUrl: string;
    publicUrl: string;
    oauthClientId: string;
    oauthScope: string;
    erpPortalUrl?: string | undefined;
    now?: () => Date;
  },
): void {
  const now = deps.now ?? (() => new Date());
  const redirectUri = `${deps.publicUrl}${CALLBACK_PATH}`;
  const fail = (ctx: Context, error: unknown) => {
    if (error instanceof ApiError) return renderFailure(ctx, error.status, error.message, deps.erpPortalUrl);
    console.error(`${ctx.method} ${ctx.path} failed:`, error);
    renderFailure(ctx, 500, "Something went wrong.", deps.erpPortalUrl);
  };

  router.get("/pending/:id", async (ctx) => {
    try {
      const request = await deps.pendingRepository.findById(ctx.params.id ?? "");
      if (!request) return renderFailure(ctx, 404, "Request not found.", deps.erpPortalUrl);
      if (request.status === "completed" && request.documentUrl) return ctx.redirect(request.documentUrl);
      if (request.status === "completed") return redirectGranted(ctx, deps.outlineUrl);
      if (request.expiresAt.getTime() <= now().getTime()) {
        return renderFailure(ctx, 410, "This request expired.", deps.erpPortalUrl);
      }
      // state mới mỗi lần mở: mở lại link luôn khởi động lại luồng đồng ý sạch.
      const authorization = createAuthorizationRequest();
      await deps.pendingRepository.startAuthorization(request.id, authorization.state, authorization.codeVerifier);
      ctx.cookies.set(STATE_COOKIE, authorization.state, {
        httpOnly: true,
        sameSite: "lax",
        secure: deps.publicUrl.startsWith("https:"),
        secureProxy: true,
        path: CALLBACK_PATH,
        maxAge: STATE_COOKIE_MAX_AGE_MS,
      });
      ctx.redirect(
        buildAuthorizeUrl({
          outlineUrl: deps.outlineUrl,
          clientId: deps.oauthClientId,
          redirectUri,
          scope: deps.oauthScope,
          request: authorization,
        }),
      );
    } catch (error) {
      fail(ctx, error);
    }
  });

  router.get(CALLBACK_PATH, async (ctx) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(ctx.query);
    if (!query.success) {
      // Người dùng bấm Từ chối (error=access_denied) hoặc URL bị sửa.
      return renderFailure(ctx, 400, "Consent was not granted.", deps.erpPortalUrl);
    }
    try {
      const documentUrl = await deps.completeAfterConsent({
        ...query.data,
        cookieState: ctx.cookies.get(STATE_COOKIE),
      });
      ctx.cookies.set(STATE_COOKIE, null, { path: CALLBACK_PATH });
      if (documentUrl) ctx.redirect(documentUrl);
      else redirectGranted(ctx, deps.outlineUrl);
    } catch (error) {
      fail(ctx, error);
    }
  });
}
