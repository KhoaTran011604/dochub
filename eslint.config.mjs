import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      ".claude/**",
      "plans/**",
      "docs/**",
      "**/dist/**",
      "**/.next/**",
      "infra/backup-output/**",
      "tests/e2e/test-results/**",
      "tests/e2e/playwright-report/**",
    ],
  },
  eslint.configs.recommended,
  // Type-aware: bắt promise bị bỏ quên (no-floating-promises, no-misused-promises).
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Mỗi file dùng tsconfig.json gần nhất (root cho file config, package cho src).
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
);
