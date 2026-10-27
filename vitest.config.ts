import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: true,
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "test-results/**",
      ".claude/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/generated/**",
        "src/**/*.d.ts",
        "src/test/**",
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "src/i18n/**",
      ],
      thresholds: {
        // 全局下限含 UI 组件（由 e2e/capture 覆盖）——留余量容正常 UI 增长，
        // 只防大规模逻辑回退。
        statements: 78,
        branches: 65,
        functions: 76,
        lines: 78,
        // 逻辑层聚合下限（各 glob 当前水位 −5~10pt 余量）。
        "src/stores/**": {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
        "src/lib/**": {
          statements: 85,
          branches: 70,
          functions: 90,
          lines: 85,
        },
        "src/hooks/**": {
          statements: 80,
          branches: 65,
          functions: 80,
          lines: 80,
        },
        "src/features/**": {
          statements: 80,
          branches: 60,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
