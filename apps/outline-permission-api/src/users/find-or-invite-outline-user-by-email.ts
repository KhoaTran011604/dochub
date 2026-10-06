import { findUserByEmail, inviteUsers, type OutlineHttpClient, type OutlineUser } from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";

/**
 * Tìm user Outline theo email; chưa có thì mời (tạo tài khoản `member`, không gửi mail Outline).
 * Dùng chung cho mời theo email ở mức node và mức collection — người nhận đăng nhập SSO là dùng được.
 */
export async function findOrInviteOutlineUserByEmail(client: OutlineHttpClient, email: string): Promise<OutlineUser> {
  const existing = await findUserByEmail(client, email);
  if (existing) return existing;

  const invited = await inviteUsers(client, {
    invites: [{ email, name: email.split("@")[0] ?? email, role: "member" }],
    suppressEmail: true,
  });
  const user = invited.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
  if (!user) throw notFound("USER_NOT_IN_OUTLINE", `Cannot create Outline account for "${email}".`);
  return user;
}
