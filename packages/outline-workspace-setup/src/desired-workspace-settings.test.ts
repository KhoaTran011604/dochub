import { describe, expect, it } from "vitest";
import { loadDesiredWorkspaceSettings } from "./desired-workspace-settings.ts";

describe("loadDesiredWorkspaceSettings", () => {
  it("builds the fixed settings plus name from env", () => {
    const desired = loadDesiredWorkspaceSettings({ WORKSPACE_NAME: "HD Document" });

    expect(desired).toEqual({
      name: "HD Document",
      sharing: false,
      guestSignin: false,
      passkeysEnabled: false,
      memberCollectionCreate: false,
      memberTeamCreate: false,
      defaultUserRole: "member",
      inviteRequired: true,
      preferences: {
        publicBranding: true,
        membersCanInvite: false,
        membersCanCreateApiKey: false,
        membersCanDeleteAccount: false,
        mcp: false,
      },
    });
  });

  it("includes avatarUrl only when WORKSPACE_LOGO_URL is set", () => {
    const desired = loadDesiredWorkspaceSettings({
      WORKSPACE_NAME: "HD Document",
      WORKSPACE_LOGO_URL: "https://cdn.example.com/logo.png",
    });

    expect(desired.avatarUrl).toBe("https://cdn.example.com/logo.png");
  });

  it("includes customTheme only when WORKSPACE_ACCENT_COLOR is set", () => {
    const desired = loadDesiredWorkspaceSettings({
      WORKSPACE_NAME: "HD Document",
      WORKSPACE_ACCENT_COLOR: "#1A2B3C",
    });

    expect(desired.preferences?.customTheme).toEqual({
      accent: "#1A2B3C",
      accentText: "#FFFFFF",
    });
  });

  it("treats an empty string the same as unset", () => {
    const desired = loadDesiredWorkspaceSettings({
      WORKSPACE_NAME: "HD Document",
      WORKSPACE_LOGO_URL: "",
      WORKSPACE_ACCENT_COLOR: "",
    });

    expect(desired.avatarUrl).toBeUndefined();
    expect(desired.preferences?.customTheme).toBeUndefined();
  });

  it("throws with a readable message when WORKSPACE_NAME is missing", () => {
    expect(() => loadDesiredWorkspaceSettings({})).toThrow(/WORKSPACE_NAME/);
  });

  it("rejects an accent color that is not a 6-digit hex", () => {
    expect(() =>
      loadDesiredWorkspaceSettings({
        WORKSPACE_NAME: "HD Document",
        WORKSPACE_ACCENT_COLOR: "blue",
      }),
    ).toThrow(/WORKSPACE_ACCENT_COLOR/);
  });
});
