import type { Context } from "koa";
import type { ErpUserDirectoryReader } from "../accounts/erp-user-directory-reader.ts";
import type { AuthAuditLogger } from "../audit/auth-audit-logger.ts";
import { erpAccountId } from "../provider/find-account-and-claims.ts";
import type { SsoHandoffRepository } from "../sso/sso-handoff-repository.ts";
import {
  SSO_HANDOFF_COOKIE_NAME,
  SSO_HANDOFF_COOKIE_PATH,
} from "../sso/sso-handoff-route.ts";

export interface SsoHandoffConsumerDependencies {
  handoffs: SsoHandoffRepository;
  readErpUser: ErpUserDirectoryReader;
  audit: AuthAuditLogger;
}

/**
 * Dùng handoff trong cookie (nếu có) đúng 1 lần. Trả accountId (`erp:<id>`) khi
 * hợp lệ; undefined khi không có cookie, handoff lạ/hết hạn/đã dùng, hoặc user
 * không còn active. Cookie luôn bị xóa sau lần đọc đầu.
 */
export async function consumeSsoHandoffCookie(
  ctx: Context,
  deps: SsoHandoffConsumerDependencies,
): Promise<string | undefined> {
  const handoffId = ctx.cookies.get(SSO_HANDOFF_COOKIE_NAME, { signed: true });
  if (!handoffId) return undefined;
  ctx.cookies.set(SSO_HANDOFF_COOKIE_NAME, null, {
    signed: true,
    path: SSO_HANDOFF_COOKIE_PATH,
  });

  const requestInfo = {
    ip: ctx.ip,
    userAgent: ctx.get("user-agent") || undefined,
  };
  const erpUserId = await deps.handoffs.consume(handoffId);
  if (!erpUserId) {
    await deps.audit({
      event: "sso_login",
      outcome: "rejected",
      ...requestInfo,
      detail: { reason: "handoff_expired_or_used" },
    });
    return undefined;
  }

  // Kiểm lại: user có thể vừa bị deactivate giữa /sso và đây.
  const lookup = await deps.readErpUser(erpUserId);
  const subject = erpAccountId(erpUserId);
  await deps.audit({
    event: "sso_login",
    outcome: lookup.found ? "success" : "rejected",
    subject,
    ...requestInfo,
    detail: lookup.found ? {} : { reason: lookup.reason },
  });
  return lookup.found ? subject : undefined;
}
