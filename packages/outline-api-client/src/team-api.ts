import type { OutlineHttpClient } from "./outline-http-client.ts";
import type { OutlineTeam, OutlineTeamUpdateInput } from "./outline-api-types.ts";

interface AuthInfoResponse {
  team: OutlineTeam;
}

/** `auth.info`: chỉ dùng để đọc `team` hiện tại (không có endpoint `team.info`). */
export async function getCurrentTeam(
  client: OutlineHttpClient,
): Promise<OutlineTeam> {
  const { team } = await client.request<AuthInfoResponse>("auth.info");
  return team;
}

export async function updateTeam(
  client: OutlineHttpClient,
  input: OutlineTeamUpdateInput,
): Promise<OutlineTeam> {
  return client.request<OutlineTeam>("team.update", input);
}
