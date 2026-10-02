import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createPostgresPool } from "@hd-document/app-database";
import argon2 from "argon2";
import {
  exportJWK,
  exportSPKI,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from "jose";
import type pg from "pg";
import {
  loadEnvironmentConfig,
  type EnvironmentConfig,
} from "../config/environment-config.ts";
import { createBridgeApplication } from "../create-bridge-application.ts";
import { CookieJarTestBrowser } from "./cookie-jar-test-browser.ts";
import {
  FAKE_PERMISSION_API_SERVICE_KEY,
  startFakePermissionApi,
  type FakePermissionApi,
} from "./fake-permission-api-server.ts";
import {
  FAKE_UPSTREAM_CLIENT_ID,
  startFakeUpstreamIdp,
  type FakeUpstreamIdp,
} from "./fake-upstream-idp-server.ts";
import { findFreeTcpPort } from "./find-free-tcp-port.ts";
import {
  createOutlineOidcClientSimulator,
  type OutlineOidcClientSimulator,
} from "./outline-oidc-client-simulator.ts";
import { validBridgeEnvironment } from "./valid-bridge-environment.ts";

/** Test tích hợp cần Postgres thật đã migrate: role owner (seed) + role bridge_app (app). */
export const integrationDatabaseAvailable = Boolean(
  process.env.APP_DATABASE_URL && process.env.BRIDGE_DATABASE_URL,
);

export const ERP_REFERRER = "http://erp.test.invalid/portal";
export const OUTLINE_URL = "http://outline.test.invalid";
export const ADMIN_PASSWORD = "integration-test-admin-password";

export interface BridgeTestHarness extends OutlineOidcClientSimulator {
  config: EnvironmentConfig;
  baseUrl: string;
  /** Role owner: seed `erp_users`, đọc audit, dọn dữ liệu test. */
  ownerPool: pg.Pool;
  /** Chỉ có khi dựng với `{ upstream: true }`. */
  fakeIdp: FakeUpstreamIdp | undefined;
  /** Chỉ có khi dựng với `{ autoProvision: true }` (cần `upstream`). */
  fakePermissionApi: FakePermissionApi | undefined;
  /** Prefix của mọi erp_user_id tạo trong lần chạy này (được dọn ở `stop`). */
  runId: string;
  newBrowser(): CookieJarTestBrowser;
  seedErpUser(overrides?: { email?: string; status?: string }): Promise<string>;
  signHandoffToken(
    erpUserId: string,
    overrides?: { key?: CryptoKey; jti?: string },
  ): Promise<string>;
  ssoUrl(token: string, returnTo?: string): string;
  /** Dừng rồi dựng lại app trên cùng port + database (mô phỏng restart bridge). */
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export async function startBridgeTestHarness(
  options: { upstream?: boolean; autoProvision?: boolean } = {},
): Promise<BridgeTestHarness> {
  const runId = `it-${randomBytes(6).toString("hex")}`;
  const erpKeys = await generateKeyPair("ES256", { extractable: true });
  const signingKeys = await generateKeyPair("RS256", { extractable: true });
  const port = await findFreeTcpPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const fakeIdp = options.upstream
    ? await startFakeUpstreamIdp(`${baseUrl}/upstream/callback`)
    : undefined;
  const ownerPool = createPostgresPool(process.env.APP_DATABASE_URL);
  const fakePermissionApi =
    options.upstream && options.autoProvision
      ? await startFakePermissionApi(ownerPool)
      : undefined;

  const config = loadEnvironmentConfig(
    validBridgeEnvironment({
      UPSTREAM_OIDC_ISSUER_URL: fakeIdp?.issuerUrl,
      UPSTREAM_OIDC_CLIENT_ID: fakeIdp ? FAKE_UPSTREAM_CLIENT_ID : undefined,
      PERMISSION_API_INTERNAL_URL: fakePermissionApi?.baseUrl,
      PERMISSION_API_SERVICE_KEY: fakePermissionApi
        ? FAKE_PERMISSION_API_SERVICE_KEY
        : undefined,
      PORT: String(port),
      BRIDGE_PUBLIC_URL: baseUrl,
      BRIDGE_DATABASE_URL: process.env.BRIDGE_DATABASE_URL,
      BRIDGE_SIGNING_JWKS: JSON.stringify({
        keys: [
          {
            ...(await exportJWK(signingKeys.privateKey)),
            kid: runId,
            alg: "RS256",
          },
        ],
      }),
      OUTLINE_URL,
      SYSTEM_ADMIN_USERNAME: `admin-${runId}`,
      SYSTEM_ADMIN_EMAIL: `admin-${runId}@hd-document.test`,
      SYSTEM_ADMIN_PASSWORD_HASH: await argon2.hash(ADMIN_PASSWORD, {
        type: argon2.argon2id,
      }),
      ERP_SSO_PUBLIC_KEY_PEM: await exportSPKI(erpKeys.publicKey),
      SSO_ALLOWED_REFERRER_ORIGINS: new URL(ERP_REFERRER).origin,
    }),
  );

  const bridgePool = createPostgresPool(config.BRIDGE_DATABASE_URL);
  let server: Server;
  const listen = async () => {
    const application = await createBridgeApplication(config, bridgePool);
    server = await new Promise<Server>((resolve) => {
      const listening = application.listen(port, "127.0.0.1", () =>
        resolve(listening),
      );
    });
  };
  const close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  await listen();

  return {
    config,
    baseUrl,
    ownerPool,
    fakeIdp,
    fakePermissionApi,
    runId,
    newBrowser: () => new CookieJarTestBrowser(baseUrl),

    async seedErpUser(overrides = {}) {
      const erpUserId = `${runId}-${randomBytes(4).toString("hex")}`;
      await ownerPool.query(
        `INSERT INTO permission_api.erp_users (erp_user_id, email, display_name, status)
         VALUES ($1, $2, $3, $4)`,
        [
          erpUserId,
          overrides.email ?? `${erpUserId}@hd-document.test`,
          `User ${erpUserId}`,
          overrides.status ?? "active",
        ],
      );
      return erpUserId;
    },

    signHandoffToken: (erpUserId, overrides = {}) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer(config.ERP_SSO_ISSUER ?? "")
        .setAudience(config.ERP_SSO_AUDIENCE)
        .setSubject(erpUserId)
        .setJti(overrides.jti ?? randomUUID())
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(overrides.key ?? erpKeys.privateKey),

    ssoUrl(token, returnTo) {
      const url = new URL("/sso", baseUrl);
      url.searchParams.set("token", token);
      if (returnTo !== undefined) url.searchParams.set("returnTo", returnTo);
      return url.href;
    },

    ...createOutlineOidcClientSimulator(config, baseUrl),

    async restart() {
      await close();
      await listen();
    },

    async stop() {
      await close();
      await fakeIdp?.stop();
      await fakePermissionApi?.stop();
      // Chỉ dọn dữ liệu của lần chạy này (database dev dùng chung).
      await ownerPool.query(
        `DELETE FROM bridge.sso_handoffs WHERE erp_user_id LIKE $1`,
        [`${runId}-%`],
      );
      await ownerPool.query(
        `DELETE FROM permission_api.erp_users WHERE erp_user_id LIKE $1`,
        [`${runId}-%`],
      );
      await Promise.all([ownerPool.end(), bridgePool.end()]);
    },
  };
}
