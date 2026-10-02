import { describe, expect, it } from "vitest";
import type { OutlineTeam } from "@hd-document/outline-api-client";
import { computeTeamSettingsDiff } from "./compute-team-settings-diff.ts";

function buildCurrentTeam(overrides: Partial<OutlineTeam> = {}): OutlineTeam {
  return {
    id: "team-1",
    name: "Old Name",
    avatarUrl: null,
    sharing: true,
    guestSignin: true,
    passkeysEnabled: true,
    memberCollectionCreate: true,
    memberTeamCreate: true,
    defaultUserRole: "viewer",
    inviteRequired: false,
    allowedDomains: [],
    preferences: {
      publicBranding: false,
      membersCanInvite: true,
      membersCanCreateApiKey: true,
      membersCanDeleteAccount: true,
      mcp: true,
    },
    ...overrides,
  };
}

describe("computeTeamSettingsDiff", () => {
  it("reports every mismatched field and builds a minimal patch", () => {
    const current = buildCurrentTeam();
    const { changes, patch } = computeTeamSettingsDiff(current, {
      name: "HD Document",
      sharing: false,
      inviteRequired: true,
      preferences: { publicBranding: true },
    });

    expect(changes.map((change) => change.field).sort()).toEqual(
      ["inviteRequired", "name", "preferences.publicBranding", "sharing"].sort(),
    );
    expect(patch).toEqual({
      name: "HD Document",
      sharing: false,
      inviteRequired: true,
      preferences: { publicBranding: true },
    });
  });

  it("returns no changes when current already matches desired", () => {
    const current = buildCurrentTeam({
      name: "HD Document",
      sharing: false,
      preferences: {
        publicBranding: true,
        membersCanInvite: true,
        membersCanCreateApiKey: true,
        membersCanDeleteAccount: true,
        mcp: true,
      },
    });

    const { changes, patch } = computeTeamSettingsDiff(current, {
      name: "HD Document",
      sharing: false,
      preferences: { publicBranding: true },
    });

    expect(changes).toEqual([]);
    expect(patch).toEqual({});
  });

  it("ignores fields not present in desired", () => {
    const current = buildCurrentTeam({ guestSignin: true });
    const { changes } = computeTeamSettingsDiff(current, { name: current.name });

    expect(changes).toEqual([]);
  });

  it("sends both customTheme fields together when only accent changed", () => {
    // Tránh Outline ghi đè mất accentText nếu `team.update` không deep-merge customTheme.
    const current = buildCurrentTeam({
      preferences: {
        publicBranding: true,
        membersCanInvite: false,
        membersCanCreateApiKey: false,
        membersCanDeleteAccount: false,
        mcp: false,
        customTheme: { accent: "#000000", accentText: "#FFFFFF" },
      },
    });

    const { changes, patch } = computeTeamSettingsDiff(current, {
      preferences: {
        customTheme: { accent: "#1A2B3C", accentText: "#FFFFFF" },
      },
    });

    expect(changes).toEqual([
      {
        field: "preferences.customTheme.accent",
        current: "#000000",
        desired: "#1A2B3C",
      },
    ]);
    expect(patch).toEqual({
      preferences: { customTheme: { accent: "#1A2B3C", accentText: "#FFFFFF" } },
    });
  });
});
