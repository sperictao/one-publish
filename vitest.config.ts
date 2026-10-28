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
        // 只防大规模逻辑回退。当前水位 87.5/77.4/83.4/88.0。
        statements: 82,
        branches: 70,
        functions: 78,
        lines: 82,
        // 逻辑层聚合下限（各 glob 当前水位 −5~10pt 余量）。
        // 水位：stores 99.2/98.2/97.8/99.2, lib 99.0/94.1/99.1/99.0,
        // hooks 99.6/92.9/99.4/99.7, features ~98.9/~89/~99/~99.
        "src/stores/**": {
          statements: 95,
          branches: 90,
          functions: 92,
          lines: 95,
        },
        "src/lib/**": {
          statements: 95,
          branches: 88,
          functions: 95,
          lines: 95,
        },
        "src/hooks/**": {
          statements: 95,
          branches: 85,
          functions: 95,
          lines: 95,
        },
        "src/features/**": {
          statements: 95,
          branches: 80,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
