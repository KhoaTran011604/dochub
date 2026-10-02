import type { Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";
import Provider from "oidc-provider";
import { createLoadExistingGrant } from "../provider/load-existing-grant-for-first-party-client.ts";
import { findFreeTcpPort } from "./find-free-tcp-port.ts";

export const FAKE_UPSTREAM_CLIENT_ID = "hd-dochub";

export interface FakeUpstreamIdp {
  issuerUrl: string;
  /** `sub` mà IdP sẽ "đăng nhập" ở lượt authorize kế tiếp (không có form). */
  currentSub: string;
  stop(): Promise<void>;
}

/**
 * IdP OIDC giả cho test tích hợp: `oidc-provider` in-memory, 1 public client
 * (PKCE), tự đăng nhập `currentSub` không cần form, không consent. Phát
 * `id_token` RS256 với email/name như IdP thật.
 */
export async function startFakeUpstreamIdp(
  bridgeCallbackUrl: string,
): Promise<FakeUpstreamIdp> {
  const port = await findFreeTcpPort();
  const issuerUrl = `http://127.0.0.1:${port}`;
  const signingKeys = await generateKeyPair("RS256", { extractable: true });
  const idp: FakeUpstreamIdp = {
    issuerUrl,
    currentSub: "idp-user",
    stop: () => Promise.resolve(),
  };

  const provider = new Provider(issuerUrl, {
    clients: [
      {
        client_id: FAKE_UPSTREAM_CLIENT_ID,
        redirect_uris: [bridgeCallbackUrl],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
      },
    ],
    jwks: {
      keys: [
        {
          ...(await exportJWK(signingKeys.privateKey)),
          alg: "RS256",
          kid: "fake-upstream-idp",
        },
      ],
    },
    cookies: {
      keys: ["fake-upstream-idp-cookie-key-0123456789abcdef"],
      // Tên khác bridge: CookieJarTestBrowser lưu cookie theo tên, không theo host.
      names: {
        session: "idp_session",
        interaction: "idp_interaction",
        resume: "idp_resume",
      },
    },
    findAccount: (_ctx, sub) => ({
      accountId: sub,
      claims: () => ({
        sub,
        email: `${sub}@idp.test`,
        email_verified: true,
        name: `IdP ${sub}`,
      }),
    }),
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name"],
    },
    loadExistingGrant: createLoadExistingGrant(() => true),
    interactions: { url: () => "/login" },
    features: { devInteractions: { enabled: false } },
  });

  // Thay màn đăng nhập: hoàn tất interaction ngay với `currentSub`.
  provider.use(async (ctx, next) => {
    if (ctx.path !== "/login") {
      await next();
      return;
    }
    await provider.interactionFinished(
      ctx.req,
      ctx.res,
      { login: { accountId: idp.currentSub } },
      { mergeWithLastSubmission: false },
    );
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = provider.listen(port, "127.0.0.1", () =>
      resolve(listening),
    );
  });
  idp.stop = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return idp;
}
