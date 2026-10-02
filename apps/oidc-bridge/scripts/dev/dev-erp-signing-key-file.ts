import path from "node:path";

/** Dừng ngay nếu lỡ chạy công cụ dev ở production (khóa dev không được tồn tại ở đó). */
export function refuseToRunInProduction(scriptName: string): void {
  if (process.env.NODE_ENV === "production") {
    console.error(
      `${scriptName} is a development tool and refuses to run with NODE_ENV=production.`,
    );
    process.exit(1);
  }
}

/** Private key của "ERP giả" (PKCS8 PEM). Thư mục .dev-keys/ đã gitignore. */
export const DEFAULT_DEV_ERP_PRIVATE_KEY_FILE = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".dev-keys",
  "dev-erp-sso-signing-private-key.pem",
);
