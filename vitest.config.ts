import { defineConfig } from "vitest/config";

// Vitest 4+ bỏ file vitest.workspace.ts; danh sách project khai báo ở đây.
// `pnpm vitest` ở root chạy mọi package; `pnpm -r test` chạy từng package.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
  },
});
