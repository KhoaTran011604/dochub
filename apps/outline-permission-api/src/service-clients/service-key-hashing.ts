import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SERVICE_KEY_PREFIX = "hdk";
const KEY_PATTERN = /^hdk_([0-9a-f]{16})_([0-9a-f]{64})$/;

export interface GeneratedServiceKey {
  clientId: string;
  /** Khóa đầy đủ `hdk_<clientId>_<secret>`, in ra đúng 1 lần cho người vận hành. */
  fullKey: string;
  keyHash: string;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Sinh service client mới: `clientId` 8 byte (lộ ra trong key), secret 32 byte entropy cao nên không cần hash chậm. */
export function generateServiceKey(): GeneratedServiceKey {
  const clientId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    clientId,
    fullKey: `${SERVICE_KEY_PREFIX}_${clientId}_${secret}`,
    keyHash: hashSecret(secret),
  };
}

/** Xoay secret, giữ nguyên `clientId`/scope/project_keys. */
export function rotateServiceKey(clientId: string): GeneratedServiceKey {
  const secret = randomBytes(32).toString("hex");
  return {
    clientId,
    fullKey: `${SERVICE_KEY_PREFIX}_${clientId}_${secret}`,
    keyHash: hashSecret(secret),
  };
}

export function parseServiceKey(key: string): { clientId: string; secret: string } | undefined {
  const match = KEY_PATTERN.exec(key);
  const clientId = match?.[1];
  const secret = match?.[2];
  if (!clientId || !secret) return undefined;
  return { clientId, secret };
}

/** So hằng thời gian để tránh lộ thông tin qua thời gian xử lý. */
export function secretMatchesHash(secret: string, keyHash: string): boolean {
  const computed = Buffer.from(hashSecret(secret), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(keyHash, "hex");
  } catch {
    return false;
  }
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
