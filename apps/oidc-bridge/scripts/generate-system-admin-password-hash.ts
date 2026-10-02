// Sinh hash argon2id cho SYSTEM_ADMIN_PASSWORD_HASH.
// Mật khẩu đọc từ stdin (không qua tham số: tham số lộ trong history và `ps`):
//   printf '%s' 'mật-khẩu-dài-ngẫu-nhiên' | pnpm --filter @hd-document/oidc-bridge generate:admin-password-hash
import { text } from "node:stream/consumers";
import argon2 from "argon2";

const MIN_PASSWORD_LENGTH = 16;

const password = (await text(process.stdin)).replace(/\r?\n$/, "");
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters (read from stdin).`,
  );
  process.exit(1);
}

// Tham số tối thiểu OWASP khuyến nghị cho argon2id.
const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

// Nháy đơn: hash chứa `$`, compose sẽ nội suy nếu không bọc.
console.log(`SYSTEM_ADMIN_PASSWORD_HASH='${hash}'`);
