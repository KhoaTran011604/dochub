export interface ErpUserAutoProvisionInput {
  /** `sub` của IdP (= erpUserId trong permission API). */
  erpUserId: string;
  email: string;
  name: string;
}

export type ErpUserAutoProvisionResult =
  | { ok: true }
  /** Permission API trả 4xx (email trùng system_admin, sub không phải UUID...). */
  | { ok: false; reason: "provision_rejected"; detail: string }
  /** Không gọi được permission API hoặc nó trả 5xx. */
  | { ok: false; reason: "provision_unavailable"; detail?: string };

export type ErpUserAutoProvisioner = (
  input: ErpUserAutoProvisionInput,
) => Promise<ErpUserAutoProvisionResult>;

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Tự tạo user ERP ở lần SSO đầu bằng cách gọi `PUT /users/{sub}` của
 * outline-permission-api (service key scope `users:write`). Dùng lại đúng
 * đường provision của ERP: ghi `erp_users` + invite vào Outline (không SMTP),
 * nên `inviteRequired` của Outline vẫn bật và `outline_user_id` được lưu.
 */
export function createPermissionApiAutoProvisioner(settings: {
  baseUrl: string;
  serviceKey: string;
}): ErpUserAutoProvisioner {
  return async (input) => {
    const url = `${settings.baseUrl}/users/${encodeURIComponent(input.erpUserId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${settings.serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: input.email, name: input.name }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.error(
        "auto-provision: permission API unreachable:",
        error instanceof Error ? error.message : error,
      );
      return { ok: false, reason: "provision_unavailable" };
    }

    if (response.ok) return { ok: true };

    // Chỉ giữ mã lỗi cố định của API, không giữ body (có thể chứa email).
    const code = await readErrorCode(response);
    if (response.status >= 500) {
      return { ok: false, reason: "provision_unavailable", detail: code };
    }
    return { ok: false, reason: "provision_rejected", detail: code };
  };
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error?: { code?: unknown } }).error?.code
        : undefined;
    return typeof code === "string" ? code : `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
}
