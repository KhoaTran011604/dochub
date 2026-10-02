// Áp cấu hình workspace mong muốn (tên, logo, màu, các toggle bảo mật) vào
// Outline bằng `team.update`. Idempotent: không có diff thì thoát 0, không
// gọi update.
//   pnpm --filter @hd-document/outline-workspace-setup apply-workspace-settings
import { getCurrentTeam, updateTeam } from "@hd-document/outline-api-client";
import { computeTeamSettingsDiff } from "./compute-team-settings-diff.ts";
import { loadDesiredWorkspaceSettings } from "./desired-workspace-settings.ts";
import { loadOutlineAdminHttpClient } from "./outline-admin-connection-env.ts";

try {
  const client = loadOutlineAdminHttpClient();
  const desired = loadDesiredWorkspaceSettings();
  const current = await getCurrentTeam(client);
  const { changes, patch } = computeTeamSettingsDiff(current, desired);

  if (changes.length === 0) {
    console.log("Workspace settings already match desired state. No changes.");
    process.exit(0);
  }

  console.log(`Applying ${changes.length} change(s):`);
  for (const change of changes) {
    console.log(
      `  - ${change.field}: ${JSON.stringify(change.current)} -> ${JSON.stringify(change.desired)}`,
    );
  }
  await updateTeam(client, patch);
  console.log("Workspace settings applied.");
} catch (error) {
  console.error(
    "Apply workspace settings failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
