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
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
