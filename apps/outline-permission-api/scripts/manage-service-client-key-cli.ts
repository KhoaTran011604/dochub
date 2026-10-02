// Quản lý service key của ERP: create | rotate | revoke. Key đầy đủ chỉ in ra
// đúng 1 lần (không lưu secret, chỉ lưu băm) — dán ngay vào hệ thống ERP.
//   pnpm --filter @hd-document/outline-permission-api manage-service-client \
//     create erp-prod --scopes users:write,permissions:write --project-keys "*"
import pg from "pg";
import { createServiceClientRepository } from "../src/service-clients/service-client-repository.ts";
import { generateServiceKey, rotateServiceKey } from "../src/service-clients/service-key-hashing.ts";

const VALID_SCOPES = new Set(["users:write", "permissions:write", "documents:create"]);

function parseListFlag(args: string[], flag: string): string[] | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireDatabaseUrl(): string {
  const url = process.env.PERMISSION_API_DATABASE_URL;
  if (!url) throw new Error("PERMISSION_API_DATABASE_URL is not set");
  return url;
}

async function main(): Promise<void> {
  const [command, name, ...rest] = process.argv.slice(2);
  if (!command || !name) {
    console.error(
      'Usage: manage-service-client <create|rotate|revoke> <name> [--scopes a,b] [--project-keys x,y|"*"]',
    );
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: requireDatabaseUrl() });
  const repository = createServiceClientRepository(pool);

  try {
    if (command === "create") {
      const existing = await repository.findActiveByName(name);
      if (existing) {
        throw new Error(
          `Service client "${name}" already exists (id ${existing.id}). Use "rotate" to get a new key.`,
        );
      }
      const scopes = parseListFlag(rest, "--scopes") ?? [];
      const projectKeys = parseListFlag(rest, "--project-keys") ?? [];
      for (const scope of scopes) {
        if (!VALID_SCOPES.has(scope)) {
          throw new Error(`Unknown scope "${scope}". Valid: ${[...VALID_SCOPES].join(", ")}`);
        }
      }
      if (scopes.length === 0) throw new Error("--scopes is required (comma-separated).");
      if (projectKeys.length === 0) {
        throw new Error('--project-keys is required (comma-separated, or "*" for all projects).');
      }

      const generated = generateServiceKey();
      await repository.create({
        id: generated.clientId,
        name,
        keyHash: generated.keyHash,
        scopes,
        projectKeys,
      });
      console.log(`Created service client "${name}" (id ${generated.clientId}).`);
      console.log(`Key: ${generated.fullKey}`);
      console.log("Copy it now: the secret is not stored and cannot be shown again.");
    } else if (command === "rotate") {
      const existing = await repository.findActiveByName(name);
      if (!existing) throw new Error(`No active service client named "${name}".`);
      const rotated = rotateServiceKey(existing.id);
      await repository.updateKeyHash(existing.id, rotated.keyHash);
      console.log(`Rotated key for service client "${name}" (id ${existing.id}).`);
      console.log(`Key: ${rotated.fullKey}`);
      console.log("Copy it now: the old key stops working immediately and cannot be recovered.");
    } else if (command === "revoke") {
      const existing = await repository.findActiveByName(name);
      if (!existing) throw new Error(`No active service client named "${name}".`);
      await repository.revoke(existing.id);
      console.log(`Revoked service client "${name}" (id ${existing.id}).`);
    } else {
      throw new Error(`Unknown command "${command}". Use create, rotate, or revoke.`);
    }
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error("manage-service-client failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
