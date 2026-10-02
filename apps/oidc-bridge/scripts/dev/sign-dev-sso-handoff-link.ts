// DEV: đóng vai ERP, ký JWT handoff và in link SSO 1 click.
//   pnpm --filter @hd-document/oidc-bridge dev:sign-sso-link --erp-user-id u-001 \
//     --return-to http://localhost:3000/doc/abc
// Link sống 60 giây, dùng 1 lần. Mở link cần Referer thuộc
// SSO_ALLOWED_REFERRER_ORIGINS (hoặc đặt SSO_REQUIRE_REFERRER=false khi dev).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { calculateJwkThumbprint, exportJWK, importPKCS8, SignJWT } from "jose";
import {
  DEFAULT_DEV_ERP_PRIVATE_KEY_FILE,
  refuseToRunInProduction,
} from "./dev-erp-signing-key-file.ts";

refuseToRunInProduction("sign-dev-sso-handoff-link");

const { values } = parseArgs({
  options: {
    "erp-user-id": { type: "string" },
    "return-to": { type: "string" },
    "private-key-file": {
      type: "string",
      default: DEFAULT_DEV_ERP_PRIVATE_KEY_FILE,
    },
    "lifetime-seconds": { type: "string", default: "60" },
    issuer: {
      type: "string",
      default: process.env.ERP_SSO_ISSUER ?? "dev-erp",
    },
    audience: {
      type: "string",
      default: process.env.ERP_SSO_AUDIENCE ?? "hd-document-sso",
    },
    "bridge-url": {
      type: "string",
      default: process.env.BRIDGE_PUBLIC_URL ?? "http://localhost:4001",
    },
  },
});

const erpUserId = values["erp-user-id"];
if (!erpUserId) {
  console.error(
    "Usage: sign-dev-sso-handoff-link --erp-user-id <id> [--return-to <url>]",
  );
  process.exit(1);
}

const privateKey = await importPKCS8(
  readFileSync(values["private-key-file"], "utf8"),
  "ES256",
  {
    extractable: true,
  },
);
// kid = thumbprint của khóa (RFC 7638; chỉ tính trên phần công khai), giống
// cách ERP thật công bố JWKS.
const kid = await calculateJwkThumbprint(await exportJWK(privateKey));

const token = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", typ: "JWT", kid })
  .setIssuer(values.issuer)
  .setAudience(values.audience)
  .setSubject(erpUserId)
  .setJti(randomUUID())
  .setIssuedAt()
  .setExpirationTime(`${Number(values["lifetime-seconds"])}s`)
  .sign(privateKey);

const link = new URL("/sso", values["bridge-url"]);
link.searchParams.set("token", token);
if (values["return-to"]) link.searchParams.set("returnTo", values["return-to"]);
console.log(link.href);
