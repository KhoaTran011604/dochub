import { describe, expect, it } from "vitest";
import {
  loadDesiredOAuthClientSettings,
  PERMISSION_API_OAUTH_CLIENT_NAME,
} from "./desired-oauth-client-settings.ts";

describe("loadDesiredOAuthClientSettings", () => {
  it("builds a confidential, published client with the permission API callback", () => {
    const desired = loadDesiredOAuthClientSettings({
      PERMISSION_API_PUBLIC_URL: "https://permission-api.example.com/",
    });

    expect(desired).toEqual({
      name: PERMISSION_API_OAUTH_CLIENT_NAME,
      redirectUris: ["https://permission-api.example.com/oauth/outline/callback"],
      clientType: "confidential",
      published: true,
    });
  });

  it("throws with a readable message when PERMISSION_API_PUBLIC_URL is missing", () => {
    expect(() => loadDesiredOAuthClientSettings({})).toThrow(
      /PERMISSION_API_PUBLIC_URL/,
    );
  });
});
