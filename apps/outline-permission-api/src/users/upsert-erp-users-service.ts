import {
  findUserByEmail,
  inviteUsers,
  type OutlineHttpClient,
} from "@hd-document/outline-api-client";
import { ApiError, forbidden } from "../http/api-error.ts";
import { EmailAlreadyInUseError, type ErpUserRepository } from "./erp-user-repository.ts";

export interface ErpUserUpsertInput {
  erpUserId: string;
  email: string;
  name: string;
}

export interface ErpUserUpsertResult {
  erpUserId: string;
  outlineUserId: string;
  status: "active" | "deactivated";
}

export type ErpUserBatchResult =
  | ({ ok: true } & ErpUserUpsertResult)
  | { ok: false; erpUserId: string; error: { code: string; message: string } };

export interface UpsertErpUsersService {
  upsertOne(input: ErpUserUpsertInput): Promise<ErpUserUpsertResult>;
  upsertBatch(inputs: ErpUserUpsertInput[]): Promise<ErpUserBatchResult[]>;
}

function assertNotSystemAdminEmail(email: string, systemAdminEmail: string): void {
  if (email.toLowerCase() === systemAdminEmail.toLowerCase()) {
    throw forbidden(
      "SYSTEM_ADMIN_EMAIL_RESERVED",
      "This email is reserved for system_admin and cannot be provisioned.",
    );
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof EmailAlreadyInUseError) return "EMAIL_ALREADY_IN_USE";
  return "UPSERT_FAILED";
}

/**
 * `erp_users` đã có → chỉ cập nhật email/tên (không gọi Outline: Outline tự
 * ghi đè email ở lần login kế). Chưa có → tra `users.list` theo email, thiếu
 * thì `users.invite` (role `member`, `suppressEmail: true`) — xem phase-04,
 * mục Key Insights + Giả định.
 */
export function createUpsertErpUsersService(deps: {
  repository: ErpUserRepository;
  outlineClient: OutlineHttpClient;
  systemAdminEmail: string;
}): UpsertErpUsersService {
  async function resolveOutlineUserId(email: string, name: string): Promise<string> {
    const existing = await findUserByEmail(deps.outlineClient, email);
    if (existing) return existing.id;
    const invited = await inviteUsers(deps.outlineClient, {
      invites: [{ email, name, role: "member" }],
      suppressEmail: true,
    });
    const match = invited.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
    if (!match) throw new Error(`users.invite did not return a user for "${email}"`);
    return match.id;
  }

  /** 1 lần `users.invite` cho cả lô (giới hạn 20 invite/request); tra lại riêng email nào thiếu trong response. */
  async function resolveOutlineUserIdsForNewUsers(
    inputs: ErpUserUpsertInput[],
  ): Promise<Map<string, string>> {
    const byEmail = new Map<string, string>();
    if (inputs.length === 0) return byEmail;
    const invited = await inviteUsers(deps.outlineClient, {
      invites: inputs.map((input) => ({ email: input.email, name: input.name, role: "member" as const })),
      suppressEmail: true,
    });
    for (const user of invited.users) byEmail.set(user.email.toLowerCase(), user.id);
    for (const input of inputs) {
      const key = input.email.toLowerCase();
      if (byEmail.has(key)) continue;
      const found = await findUserByEmail(deps.outlineClient, input.email);
      if (found) byEmail.set(key, found.id);
    }
    return byEmail;
  }

  async function upsertOne(input: ErpUserUpsertInput): Promise<ErpUserUpsertResult> {
    assertNotSystemAdminEmail(input.email, deps.systemAdminEmail);
    const existing = await deps.repository.findByErpUserId(input.erpUserId);
    if (existing) {
      const updated = await deps.repository.updateProfile(input.erpUserId, input.email, input.name);
      return {
        erpUserId: updated.erpUserId,
        outlineUserId: updated.outlineUserId ?? "",
        status: updated.status,
      };
    }
    const outlineUserId = await resolveOutlineUserId(input.email, input.name);
    const created = await deps.repository.insert({
      erpUserId: input.erpUserId,
      email: input.email,
      displayName: input.name,
      outlineUserId,
    });
    return { erpUserId: created.erpUserId, outlineUserId, status: created.status };
  }

  async function upsertBatch(inputs: ErpUserUpsertInput[]): Promise<ErpUserBatchResult[]> {
    const resultByErpUserId = new Map<string, ErpUserBatchResult>();
    const eligible: ErpUserUpsertInput[] = [];

    for (const input of inputs) {
      if (input.email.toLowerCase() === deps.systemAdminEmail.toLowerCase()) {
        resultByErpUserId.set(input.erpUserId, {
          ok: false,
          erpUserId: input.erpUserId,
          error: {
            code: "SYSTEM_ADMIN_EMAIL_RESERVED",
            message: "This email is reserved for system_admin and cannot be provisioned.",
          },
        });
      } else {
        eligible.push(input);
      }
    }

    const existingRows = await Promise.all(
      eligible.map((input) => deps.repository.findByErpUserId(input.erpUserId)),
    );
    const newInputs = eligible.filter((_, index) => !existingRows[index]);
    const outlineUserIdByEmail = await resolveOutlineUserIdsForNewUsers(newInputs);

    for (let index = 0; index < eligible.length; index += 1) {
      const input = eligible[index];
      const existing = existingRows[index];
      if (!input) continue;
      try {
        if (existing) {
          const updated = await deps.repository.updateProfile(input.erpUserId, input.email, input.name);
          resultByErpUserId.set(input.erpUserId, {
            ok: true,
            erpUserId: updated.erpUserId,
            outlineUserId: updated.outlineUserId ?? "",
            status: updated.status,
          });
          continue;
        }
        const outlineUserId = outlineUserIdByEmail.get(input.email.toLowerCase());
        if (!outlineUserId) throw new Error(`no Outline user resolved for "${input.email}"`);
        const created = await deps.repository.insert({
          erpUserId: input.erpUserId,
          email: input.email,
          displayName: input.name,
          outlineUserId,
        });
        resultByErpUserId.set(input.erpUserId, {
          ok: true,
          erpUserId: created.erpUserId,
          outlineUserId,
          status: created.status,
        });
      } catch (error) {
        resultByErpUserId.set(input.erpUserId, {
          ok: false,
          erpUserId: input.erpUserId,
          error: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    return inputs.map(
      (input) =>
        resultByErpUserId.get(input.erpUserId) ?? {
          ok: false,
          erpUserId: input.erpUserId,
          error: { code: "UPSERT_FAILED", message: "No result computed for this user." },
        },
    );
  }

  return { upsertOne, upsertBatch };
}
