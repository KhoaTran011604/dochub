import type { OutlineTeam, OutlineTeamUpdateInput } from "@hd-document/outline-api-client";

export interface TeamSettingsFieldChange {
  field: string;
  current: unknown;
  desired: unknown;
}

export interface TeamSettingsDiff {
  changes: TeamSettingsFieldChange[];
  /** Chỉ chứa field thật sự đổi; rỗng → không gọi `team.update`. */
  patch: OutlineTeamUpdateInput;
}

/**
 * So `current` (đọc từ `auth.info`) với `desired`. Chỉ field có mặt trong
 * `desired` mới được xét, nên script luôn idempotent: chạy lại khi đã khớp
 * không tạo diff, không gọi `team.update`.
 */
export function computeTeamSettingsDiff(
  current: OutlineTeam,
  desired: OutlineTeamUpdateInput,
): TeamSettingsDiff {
  const changes: TeamSettingsFieldChange[] = [];
  const patch: OutlineTeamUpdateInput = {};

  const diffTopLevel = <K extends keyof OutlineTeamUpdateInput>(field: K) => {
    if (!(field in desired)) return;
    const desiredValue = desired[field];
    const currentValue = current[field as keyof OutlineTeam];
    if (currentValue !== desiredValue) {
      changes.push({ field, current: currentValue, desired: desiredValue });
      patch[field] = desiredValue;
    }
  };

  diffTopLevel("name");
  diffTopLevel("avatarUrl");
  diffTopLevel("sharing");
  diffTopLevel("guestSignin");
  diffTopLevel("passkeysEnabled");
  diffTopLevel("memberCollectionCreate");
  diffTopLevel("memberTeamCreate");
  diffTopLevel("defaultUserRole");
  diffTopLevel("inviteRequired");

  const desiredPreferences = desired.preferences;
  if (desiredPreferences) {
    const currentPreferences = current.preferences;
    const preferencePatch: NonNullable<OutlineTeamUpdateInput["preferences"]> = {};

    const diffPreference = <
      K extends keyof NonNullable<OutlineTeamUpdateInput["preferences"]>,
    >(
      field: K,
    ) => {
      if (!(field in desiredPreferences)) return;
      const desiredValue = desiredPreferences[field];
      const currentValue = currentPreferences[field];
      if (currentValue !== desiredValue) {
        changes.push({
          field: `preferences.${field}`,
          current: currentValue,
          desired: desiredValue,
        });
        preferencePatch[field] = desiredValue;
      }
    };

    diffPreference("publicBranding");
    diffPreference("membersCanInvite");
    diffPreference("membersCanCreateApiKey");
    diffPreference("membersCanDeleteAccount");
    diffPreference("mcp");

    const desiredTheme = desiredPreferences.customTheme;
    if (desiredTheme) {
      const currentTheme = currentPreferences.customTheme ?? {};
      const accentChanged =
        desiredTheme.accent !== undefined && desiredTheme.accent !== currentTheme.accent;
      const accentTextChanged =
        desiredTheme.accentText !== undefined &&
        desiredTheme.accentText !== currentTheme.accentText;

      // Gửi cả 2 field cùng lúc khi 1 trong 2 đổi: chưa rõ Outline merge hay
      // ghi đè cả `customTheme`, gửi lẻ 1 field có thể xóa mất field kia.
      if (accentChanged || accentTextChanged) {
        if (accentChanged) {
          changes.push({
            field: "preferences.customTheme.accent",
            current: currentTheme.accent,
            desired: desiredTheme.accent,
          });
        }
        if (accentTextChanged) {
          changes.push({
            field: "preferences.customTheme.accentText",
            current: currentTheme.accentText,
            desired: desiredTheme.accentText,
          });
        }
        preferencePatch.customTheme = {
          ...(desiredTheme.accent !== undefined ? { accent: desiredTheme.accent } : {}),
          ...(desiredTheme.accentText !== undefined
            ? { accentText: desiredTheme.accentText }
            : {}),
        };
      }
    }

    if (Object.keys(preferencePatch).length > 0) {
      patch.preferences = preferencePatch;
    }
  }

  return { changes, patch };
}
