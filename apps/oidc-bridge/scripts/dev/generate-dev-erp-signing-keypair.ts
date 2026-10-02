// DEV: sinh cặp khóa ES256 đóng vai ERP. Private key ghi ra .dev-keys/ (đã
// gitignore); public key in ra để dán vào infra/.env.
//   pnpm --filter @hd-document/oidc-bridge dev:generate-erp-keypair
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import {
  DEFAULT_DEV_ERP_PRIVATE_KEY_FILE,
  refuseToRunInProduction,
} from "./dev-erp-signing-key-file.ts";

refuseToRunInProduction("generate-dev-erp-signing-keypair");

if (
  existsSync(DEFAULT_DEV_ERP_PRIVATE_KEY_FILE) &&
  !process.argv.includes("--force")
) {
  console.error(
    `${DEFAULT_DEV_ERP_PRIVATE_KEY_FILE} already exists. Pass --force to replace it ` +
      "(then update ERP_SSO_PUBLIC_KEY_PEM and restart the bridge).",
  );
  process.exit(1);
}

const { privateKey, publicKey } = await generateKeyPair("ES256", {
  extractable: true,
});

mkdirSync(path.dirname(DEFAULT_DEV_ERP_PRIVATE_KEY_FILE), { recursive: true });
writeFileSync(DEFAULT_DEV_ERP_PRIVATE_KEY_FILE, await exportPKCS8(privateKey), {
  mode: 0o600,
});

const publicKeyOneLine = (await exportSPKI(publicKey))
  .trim()
  .replace(/\n/g, "\\n");
console.log(`Private key written to ${DEFAULT_DEV_ERP_PRIVATE_KEY_FILE}`);
console.log("Put this in infra/.env (and leave ERP_SSO_JWKS_URL empty):\n");
console.log(`ERP_SSO_PUBLIC_KEY_PEM='${publicKeyOneLine}'`);
