import type { Configuration } from "oidc-provider";

/** Scope Outline xin; grant ngầm chỉ cấp đúng các scope này. */
export const FIRST_PARTY_SCOPES = "openid profile email";

/**
 * Bỏ màn đồng ý (consent) cho client first-party: chưa có grant thì tự tạo.
 * Client khác (nếu sau này có) vẫn đi qua consent mặc định của provider.
 * Mẫu theo tài liệu oidc-provider, mục `loadExistingGrant`.
 */
export function createLoadExistingGrant(
  isFirstParty: (clientId: string) => boolean,
): NonNullable<Configuration["loadExistingGrant"]> {
  return async (ctx) => {
    const { client, session, result, provider } = ctx.oidc;
    if (!client || !session) return undefined;

    const grantId =
      result?.consent?.grantId ?? session.grantIdFor(client.clientId);
    if (grantId) {
      const existing = await provider.Grant.find(grantId);
      if (existing) return existing;
    }

    if (!isFirstParty(client.clientId) || !session.accountId) return undefined;

    const grant = new provider.Grant({
      clientId: client.clientId,
      accountId: session.accountId,
    });
    grant.addOIDCScope(FIRST_PARTY_SCOPES);
    await grant.save();
    return grant;
  };
}
