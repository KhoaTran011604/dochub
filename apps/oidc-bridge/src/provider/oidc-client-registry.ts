import type { ClientMetadata } from "oidc-provider";

export interface OutlineClientSettings {
  clientId: string;
  clientSecret: string;
  outlineUrl: string;
}

/**
 * Client duy nhất của bridge: Outline (first-party, confidential).
 * Redirect URI khớp tuyệt đối, không wildcard.
 */
export function buildOidcClients(
  settings: OutlineClientSettings,
): ClientMetadata[] {
  return [
    {
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      client_name: "Outline",
      redirect_uris: [`${settings.outlineUrl}/auth/oidc.callback`],
      // Outline gọi logout với post_logout_redirect_uri = URL gốc của nó.
      post_logout_redirect_uris: [settings.outlineUrl],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      // Outline (passport-oauth2) gửi client_id/client_secret trong body của
      // POST /token, không dùng header Basic. Đã đối chiếu source v1.10.1.
      token_endpoint_auth_method: "client_secret_post",
    },
  ];
}
