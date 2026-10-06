// Chỉ khai các field thật sự dùng (team.update, auth.info, oauthClients.*),
// đối chiếu schema Outline tag v1.10.1 (xem phase-03, mục Key Insights).

export interface OutlineTeamPreferences {
  publicBranding?: boolean;
  membersCanInvite?: boolean;
  membersCanCreateApiKey?: boolean;
  membersCanDeleteAccount?: boolean;
  viewersCanExport?: boolean;
  customTheme?: {
    accent?: string;
    accentText?: string;
  };
  mcp?: boolean;
  emailDisplay?: boolean;
  commenting?: boolean;
}

export interface OutlineTeam {
  id: string;
  name: string;
  avatarUrl: string | null;
  sharing: boolean;
  guestSignin: boolean;
  passkeysEnabled: boolean;
  memberCollectionCreate: boolean;
  memberTeamCreate: boolean;
  defaultUserRole: string;
  inviteRequired: boolean;
  allowedDomains: string[];
  preferences: OutlineTeamPreferences;
}

/** Body gửi cho `team.update`: mọi field optional, chỉ gửi field muốn đổi. */
export type OutlineTeamUpdateInput = Partial<
  Pick<
    OutlineTeam,
    | "name"
    | "avatarUrl"
    | "sharing"
    | "guestSignin"
    | "passkeysEnabled"
    | "memberCollectionCreate"
    | "memberTeamCreate"
    | "defaultUserRole"
    | "inviteRequired"
    | "allowedDomains"
  >
> & { preferences?: OutlineTeamPreferences };

export interface OutlineOAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  clientType: "public" | "confidential";
  published: boolean;
  description: string | null;
  developerName: string | null;
  developerUrl: string | null;
  avatarUrl: string | null;
  /** Chỉ có trong response của `oauthClients.create`, không có khi `list`/`update`. */
  clientSecret?: string;
  /** Mã công khai dùng ở /oauth/authorize và /oauth/token (khác `id` UUID). */
  clientId?: string;
}

export interface OutlineOAuthClientCreateInput {
  name: string;
  redirectUris: string[];
  clientType?: "public" | "confidential";
  published?: boolean;
  description?: string;
  developerName?: string;
  developerUrl?: string;
  avatarUrl?: string;
}

export type OutlineOAuthClientUpdateInput = Partial<
  Omit<OutlineOAuthClientCreateInput, "name">
> & { id: string };

export type OutlineUserRole = "admin" | "member" | "viewer" | "guest";

export interface OutlineUser {
  id: string;
  name: string;
  email: string;
  role: OutlineUserRole;
  isSuspended: boolean;
}

export interface OutlineUserInviteRequest {
  email: string;
  name: string;
  role?: OutlineUserRole;
}

export interface OutlineInviteUsersInput {
  invites: OutlineUserInviteRequest[];
  suppressEmail?: boolean;
}

/** Field `users[]` chỉ chứa user THỰC SỰ được mời; email đã tồn tại bị lọc ra. */
export interface OutlineInviteUsersResult {
  sent: string[];
  users: OutlineUser[];
}

/** Permission áp dụng cho cả collection và document. */
export type OutlinePermission = "read" | "read_write" | "admin";

export interface OutlineGroup {
  id: string;
  name: string;
  /** Quy ước nội bộ `<projectKey>:<role>` để tra ngược (xem `project-group-naming-convention`). */
  externalId: string | null;
}

export interface OutlineCollection {
  id: string;
  name: string;
  permission: OutlinePermission | null;
}

/** Node của `collections.documents`: không có nội dung doc. */
export interface OutlineNavigationNode {
  id: string;
  title: string;
  url: string;
  children: OutlineNavigationNode[];
}

export interface OutlineDocumentInfo {
  id: string;
  collectionId: string;
  url?: string;
}

/** Doc rút gọn từ `documents.list` / `userMemberships.list` (user token): đủ để dựng cây, không có nội dung. */
export interface OutlineDocumentSummary {
  id: string;
  title: string;
  /** Path tương đối `/doc/<slug>`, ghép với `OUTLINE_URL` khi trả ra ngoài. */
  url: string;
  collectionId: string | null;
  parentDocumentId: string | null;
}

/** `auth.info`: chỉ field dùng để kiểm danh tính token. */
export interface OutlineAuthInfo {
  user: { id: string };
}

export interface OutlineDocumentCreateInput {
  /** UUID do client cấp: gọi lại cùng id không tạo doc thứ 2 (idempotency). */
  id: string;
  title: string;
  text: string;
  collectionId: string;
  parentDocumentId?: string;
  publish: boolean;
}

/** `url` là path tương đối (`/doc/<slug>`), ghép với `OUTLINE_URL` khi trả cho ERP. */
export interface OutlineCreatedDocument {
  id: string;
  url: string;
  collectionId: string;
}
