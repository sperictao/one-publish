# Plan 005: 清退已完成使命的 Geist 原型页与死代码（需维护者确认）

> **Executor instructions**: 本计划是**破坏性清理**，执行前确认操作者已明确批准
> （plans/README.md 状态从 TODO 改为 APPROVED 即视为批准）。Follow this plan
> step by step；触发 STOP conditions 时停下上报。完成后更新 `plans/README.md`。
>
> **Drift check (run first)**: `git diff --stat 4603006..HEAD -- src/components/prototype/ src/components/publish/ParameterEditor.tsx src/App.tsx`
> 若上述文件已变动，先比对"Current state"再继续；不一致即 STOP。

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW（均无生产引用；风险在"以为无引用而实际有"）
- **Depends on**: none（但建议在 004 之后执行，删除后可顺手收窄 004 的扫描排除项）
- **Category**: tech-debt
- **Planned at**: commit `4603006`, 2026-07-12

## Why this matters

两块代码已失去存在理由，却持续产生维护税：
1. `src/components/prototype/GeistWorkbenchPrototype.tsx`（639 行）是重设计前的视觉验证原型（任务 PRD 原文："development-only visual prototype that proves a richer Geist workbench direction"）。生产工作台重设计已全部落地，原型完成使命；它内部大量不合规样式会被每一轮设计审计重复扫到（Plan 004 已被迫为它开整目录排除项）。
2. `src/components/publish/ParameterEditor.tsx` 在生产代码中零引用（仅自引用），2026-07 的文案修复轮已确认其死代码身份。

## Current state（reviewer 亲读，基于工作分支 d3c9326 的 worktree）

- `src/components/prototype/` 含**两个**文件（计划初稿只提到一个）：`GeistWorkbenchPrototype.tsx` 与 `geistPrototypeVariant.ts`（后者导出 `isGeistPrototypeVariant`）。整目录删除。
- `src/App.tsx` 的原型挂载有 5 处纠缠（行号基于 d3c9326，先读文件按内容匹配）：
  1. **line 3** import：`import { isGeistPrototypeVariant } from "@/components/prototype/geistPrototypeVariant";` → 删
  2. **line 29-32** lazy 声明：`const GeistWorkbenchPrototype = lazy(async () => { ... });` → 删
  3. **line 42-50** state 初始化：`const [showGeistPrototype, setShowGeistPrototype] = useState(() => { ...variant 判断... });` → 删
  4. **line 52-64** effect：监听 `popstate` 同步 `showGeistPrototype` 的整个 `useEffect(...)` → 删
  5. **line 80-88** 渲染分支：`if (showGeistPrototype && !import.meta.env.PROD) { return (...GeistWorkbenchPrototype...); }` → 删
- **保留判断**：`Suspense`、`lazy`、`useEffect`、`useState` 这些 import 在删除后**仍被 App 其它逻辑使用**（多个 lazy 组件、其它 state/effect）——**不要动 import 行的这些符号**，只删 `isGeistPrototypeVariant` 那一行 import。删除后跑 tsc，若报某符号未使用（如 `useState`/`useEffect` 恰好只服务原型），再按 tsc 提示删对应 import；以 tsc 为准，不要预先猜。
- `ParameterEditor` 引用面：`grep -rln "ParameterEditor" src` → 仅 `src/components/publish/ParameterEditor.tsx` 自身（已确认零生产引用）。
- `paramEditorEmpty`/`paramEditorType` 两个 i18n 键：删除 ParameterEditor 后成为孤儿——`node scripts/check-i18n-coverage.mjs` 会否报未使用取决于脚本实现；按其实际行为决定是否删键（见 Step 4）。

## 原 Current state（保留作背景）

- `src/App.tsx:29-30`：
  ```ts
  const GeistWorkbenchPrototype = lazy(async () => {
    const mod = await import("@/components/prototype/GeistWorkbenchPrototype");
  ```
  周边应有 dev-only 挂载条件（形如 `import.meta.env.DEV && showPrototype` 或 hash 路由判断）。执行时以 `grep -n "GeistWorkbenchPrototype\|prototype" src/App.tsx` 找齐 lazy 声明、挂载 JSX 与开关状态三部分。
- `src/components/prototype/` 目录只含该原型文件（执行时 `ls` 确认）。
- `ParameterEditor` 引用面（截至规划时）：`grep -rln "ParameterEditor" src` → 仅 `src/components/publish/ParameterEditor.tsx` 自身。它在 commit 4603006 中刚接入 `common.paramEditorEmpty` / `common.paramEditorType` 两个 i18n 键——删除组件后这两个键成为孤儿。
- `scripts/check-i18n-coverage.mjs` 会校验 key 使用情况（执行时验证：删除后跑 `pnpm check:i18n`，若报未使用 key 则一并删键；若不报则保留键位也无害，按脚本行为决定）。
- 相关提交语义：仓库遵循"升级默认破坏式，不留 deprecated 尸体"的清理惯例（见 git log 中 `refactor(ui)!: 移除设置页强调色功能`）。

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| 引用核查  | `grep -rn "GeistWorkbenchPrototype" src tests 2>/dev/null` | 删除后 0 命中 |
| 引用核查  | `grep -rn "ParameterEditor" src tests 2>/dev/null` | 删除后 0 命中 |
| Typecheck | `pnpm typecheck`         | exit 0              |
| 全量测试  | `pnpm test`              | 全部通过            |
| i18n      | `pnpm check:i18n`        | 100%，exit 0        |
| e2e（可选）| `pnpm e2e`              | 基线通过            |

## Scope

**In scope**:
- 删除 `src/components/prototype/`（整目录）
- 删除 `src/components/publish/ParameterEditor.tsx`
- `src/App.tsx`（仅移除原型的 lazy 声明、挂载 JSX、及仅服务于它的开关 state/快捷键）
- `src/i18n/zh.json` / `src/i18n/en.json`（仅当 check:i18n 报孤儿键时删 `paramEditorEmpty`/`paramEditorType`）
- `.github/workflows/` 不动；若 Plan 004 已合入，可同步删除其脚本里 `src/components/prototype` 排除项（`scripts/check-geist-compliance.mjs`）

**Out of scope**:
- `StringParameter/BooleanParameter/ArrayParameter/MapParameter` —— 它们被 `ReadonlyParameterFieldsSection` 生产引用，**不是**死代码。
- 其他任何"顺手清理"。

## Git workflow

- Branch: `advisor/005-retire-prototype-dead-code`
- Commit 例：`refactor(ui)!: 移除已完成使命的 Geist 工作台原型与死代码`（含 `!`，正文列出删除物与不再支持的入口，匹配仓库 BREAKING 记录惯例）
- 不 push、不开 PR，除非操作者指示。

## Steps

### Step 1: 确认零引用（前置证据）
运行两条引用核查 grep（排除待删文件自身）。任何生产/测试引用命中 → STOP。

**Verify**: 除待删文件自身外 0 命中

### Step 2: 移除 App.tsx 挂载
按"Current state"的 grep 找齐三部分并删除；连带删除仅为原型服务的 state、快捷键分支、Suspense 包装。

**Verify**: `pnpm typecheck` → exit 0

### Step 3: 删除文件
`git rm -r src/components/prototype src/components/publish/ParameterEditor.tsx`

**Verify**: `pnpm typecheck` → exit 0；两条引用核查 grep 0 命中

### Step 4: i18n 孤儿键
跑 `pnpm check:i18n`：若报 `paramEditorEmpty`/`paramEditorType` 未使用则从 zh/en 同步删除后复跑至 100%；若不报则不动。

**Verify**: `pnpm check:i18n` → 100%，exit 0

### Step 5: 回归
**Verify**: `pnpm test` → 全部通过（若存在 ParameterEditor 的测试文件，随组件一并删除并在 commit 正文记录）

## Test plan

- 无新增测试；全量回归 + 引用核查 grep 即验证。

## Done criteria

- [ ] `src/components/prototype/` 与 `ParameterEditor.tsx` 不存在
- [ ] 引用核查 grep 0 命中
- [ ] `pnpm typecheck && pnpm test && pnpm check:i18n` exit 0
- [ ] commit message 含 `!` 与删除清单
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 操作者未批准（README 状态仍为 TODO）。
- 任一引用核查发现待删代码的真实引用。
- App.tsx 中原型开关与其他功能共用 state（说明拆除影响面超预期）。

## Maintenance notes

- 若未来需要新的视觉试验场，建议以 Storybook/独立 demo 路由重建，而不是恢复此原型——它的 token 已过时。
- 合入后可回访 Plan 004 脚本删除 prototype 排除项（本计划 Scope 已含）。
