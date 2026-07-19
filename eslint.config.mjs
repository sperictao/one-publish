import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "src/generated",
      "src-tauri",
      "playwright-report",
      "test-results",
      "node_modules",
      ".pi",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 下划线前缀 = 有意丢弃（解构占位、接口占位参数）
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Node 环境文件：脚本、配置、e2e 测试
    files: [
      "scripts/**",
      "tests/**",
      "*.config.{js,cjs,mjs,ts}",
      "*.cjs",
      "*.mjs",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // TS 文件的未定义标识符由 TypeScript 编译器负责（typescript-eslint 官方建议）
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    // 残留 1 处（useTrayRecentPublish.ts）：标准修法 Error cause 需要 tsconfig lib >= ES2022，
    // 超出 lint 清理范围。tsconfig 升级后修复该处并删除本条降级。
    rules: {
      "preserve-caught-error": "warn",
    },
  },
  // 关闭与 prettier 冲突的纯风格规则（必须放最后）
  eslintConfigPrettier
);
