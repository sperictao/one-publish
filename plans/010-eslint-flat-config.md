# Plan 010: 引入 ESLint（flat config）作为前端静态检查门禁

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 97d3d0c..HEAD -- package.json tsconfig.json .github/workflows/quality.yml`
> If these changed since this plan was written, compare against the live files
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none（但若与 Plan 008 都要改 `quality.yml`，先落地 008 可减少冲突）
- **Category**: dx
- **Planned at**: commit `97d3d0c`, 2026-07-14

## Why this matters

全仓无任何 lint 配置（无 `.eslintrc*`、`eslint.config.*`、`biome.json`）。
唯一的静态检查是 `tsc --noEmit`，它抓不到 React hooks 依赖数组错误、
浮空 Promise（unhandled rejection）、无意义的相等比较等一整类问题。审计中
发现的监听器卸载竞态（Plan 012）正是 `react-hooks/exhaustive-deps` 和
`no-floating-promises` 这类规则的目标。引入 ESLint 后，这些问题在编码期即被
拦截，而不是等运行时或人工 review。

**关键约束**：这是一个 42k 行的成熟前端。首次引入 lint 极可能报出大量存量
告警。本计划的目标是**建立零告警的绿色门禁**，而不是一次性修完所有历史问题。
因此策略是：配一套务实规则集，能自动修的自动修，剩余存量问题**先降级为
warning 且门禁只对 error 失败**，把逐类清理留给后续独立任务。

## Current state

- `package.json` devDependencies 已有 `typescript ^5.3.0`、`@types/react`、
  `@vitejs/plugin-react`，但**没有 eslint 及任何 plugin**。
- `tsconfig.json` 已开启 `"strict": true`、`"noUnusedLocals": true`、
  `"noUnusedParameters": true`、`"jsx": "react-jsx"`、`"target": "ES2020"`。
- 无 Prettier 配置——本计划**不引入 Prettier/格式化**，只做 lint，避免与
  既有代码风格冲突制造巨量 diff。
- `.github/workflows/quality.yml` 现有 `quality` job 步骤：install → tsc →
  test → check:i18n → check:design。lint 步骤应加在 tsc 之后。
- 源码根目录：`src/`（含 `src/**/__tests__`、`*.test.ts(x)`、`src/test/`
  测试工具）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 安装 | `pnpm add -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals` | exit 0 |
| Lint | `pnpm lint` | exit 0（0 error；warning 允许） |
| Lint 自动修 | `pnpm lint --fix` | exit 0 |
| Typecheck 回归 | `pnpm typecheck` | exit 0 |
| 测试回归 | `pnpm test` | all pass |

## Scope

**In scope**:
- `eslint.config.mjs`（新建，flat config）
- `package.json`（新增 devDependencies + `"lint"` 脚本；`pnpm add -D` 会自动改）
- `pnpm-lock.yaml`（由安装自动更新）
- `.github/workflows/quality.yml`（新增 lint 步骤）

**Out of scope** (do NOT touch):
- 任何 `src/**` 源码——**例外**：`pnpm lint --fix` 自动产生的安全修复
  （如删除未用 import）可以保留，但你不得手动改源码逻辑去消 warning。手动
  修复留给后续任务。
- 不引入 Prettier、不改代码格式化风格。
- 不改 `tsconfig.json`。

## Git workflow

- Branch: `advisor/010-eslint-flat-config`
- Commit 建议：`chore(dx): 引入 ESLint flat config 与 lint 门禁`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 安装依赖

`pnpm add -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals`

**Verify**: `pnpm exec eslint --version` → 打印版本号（v9.x）。

### Step 2: 新建 `eslint.config.mjs`

务实的 flat config：TS 推荐规则 + hooks 规则；把高噪声但非致命的规则设为
`warn`，把真正的正确性规则设为 `error`。目标形态：

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src/generated", "src-tauri", "playwright-report", "test-results", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      // 正确性类 → error
      "react-hooks/exhaustive-deps": "warn",       // 存量多，先 warn
      "@typescript-eslint/no-floating-promises": "off", // 需要 type-aware，见 Step 4 决策
      // 高噪声 → warn，留待后续清理
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
```

注意：`src/generated`（ts-rs 生成物）和 `src-tauri`（Rust）必须 ignore。

**Verify**: `pnpm exec eslint --print-config src/App.tsx > /dev/null` → exit 0
（配置可解析）。

### Step 3: 加 `lint` 脚本并跑首次全量

在 `package.json` scripts 加：`"lint": "eslint ."`。

先跑 `pnpm lint --fix` 让自动修复处理安全项，再跑 `pnpm lint` 看剩余。
**如果仍有 error（非 warning）**：逐条查看，把无法安全自动修且属高噪声的
规则从 `error` 降为 `warn`（记录在报告里），目标是 **0 error**。不要为消
warning 手改业务代码。

**Verify**: `pnpm lint` → exit 0（可有 warning，0 error）。

### Step 4: 决定是否启用 type-aware 的 no-floating-promises

`no-floating-promises` 能抓浮空 Promise（Plan 012 关注的问题之一），但它需要
type-aware linting（`parserOptions.projectService`），会显著拖慢 lint。
**本计划的默认决策：暂不启用**（保持 config 里的 `"off"`），在 Maintenance
notes 记录为后续可选增强。若你启用它并能保持 `pnpm lint` 0 error 且耗时
可接受，也可保留——但这是可选项，不是 done criteria。

**Verify**: 无论选哪条，`pnpm lint` 仍 → exit 0。

### Step 5: 回归 + 接入 CI

跑 `pnpm typecheck` 和 `pnpm test` 确认自动修复没破坏任何东西。然后在
`.github/workflows/quality.yml` 的 `quality` job 中，`pnpm exec tsc --noEmit`
之后加一步 `- run: pnpm lint`。

**Verify**: `pnpm typecheck` → exit 0；`pnpm test` → all pass；
`git diff .github/workflows/quality.yml` 显示新增 lint 步骤。

## Test plan

不新增测试。回归验证：`pnpm typecheck` + `pnpm test` 全绿，证明 `--fix` 的
自动改动（若有）未引入回归。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `eslint.config.mjs` 存在且 `pnpm exec eslint --print-config src/App.tsx` exit 0
- [ ] `package.json` 有 `"lint": "eslint ."` 脚本
- [ ] `pnpm lint` exits 0（0 error）
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` all pass
- [ ] `.github/workflows/quality.yml` 含 `pnpm lint` 步骤
- [ ] 无手动源码逻辑改动（除 `--fix` 自动产物）：`git diff src/` 若非空，仅含删除未用 import 一类的自动修复
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm lint --fix` 后 error 数量庞大（几十上百）且无法通过合理的规则降级
  降到 0 error——说明规则集过激进，报告现状请求指示，不要硬改业务代码。
- 自动修复导致 `pnpm test` 出现回归——回滚 `--fix` 改动并报告哪些文件受影响。
- 你发现需要修改 `src-tauri` 或 `src/generated`——它们在 ignore 列表，不该被 lint。

## Maintenance notes

- 本计划刻意把 `no-explicit-any`、`no-unused-vars`、`exhaustive-deps` 设为
  `warn`。后续可为每类各开一个独立清理任务，逐步升为 `error`。
- `no-floating-promises`（type-aware）是抓 Plan 012 类问题的利器但代价是速度，
  作为已知后续增强项。
- 未来若引入 Prettier，需与本 lint 配置用 `eslint-config-prettier` 协调，避免
  规则打架——那是另一个决策，不在此计划。
- Reviewer 应重点看：ignore 列表是否漏掉生成物/后端；CI lint 步骤是否真的会
  在 error 时失败。
