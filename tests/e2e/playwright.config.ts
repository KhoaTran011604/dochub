import { defineConfig, devices } from "@playwright/test";

// Chạy trên stack compose đang bật (infra/README.md, mục E2E). Test dùng chung
// 1 user và trạng thái đăng nhập nên chạy tuần tự.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
});
