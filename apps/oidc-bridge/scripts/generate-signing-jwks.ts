// Sinh JWKS private (RS256) cho BRIDGE_SIGNING_JWKS: khóa bridge dùng ký id_token.
// Giữ nguyên giá trị này qua các lần restart/deploy; đổi khóa = mọi id_token cũ hết hiệu lực.
//   pnpm --filter @hd-document/oidc-bridge generate:signing-jwks
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("RS256", {
  modulusLength: 2048,
  extractable: true,
});
const jwk = await exportJWK(privateKey);
const jwks = {
  keys: [
    {
      ...jwk,
      kid: await calculateJwkThumbprint(jwk),
      alg: "RS256",
      use: "sig",
    },
  ],
};

// Nháy đơn để compose không đụng tới ký tự trong JSON.
console.log(`BRIDGE_SIGNING_JWKS='${JSON.stringify(jwks)}'`);
