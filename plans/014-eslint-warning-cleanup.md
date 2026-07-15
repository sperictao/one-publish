# Plan 014: 清理 ESLint 存量 warning 的机械类，并将已清零规则升回 error

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: 本计划基准是 `advisor/010-eslint-flat-config`
> 分支尖端 `64ab5e6`。执行前确认 `eslint.config.mjs` 存在且 `pnpm lint`
> exit 0——不存在则 STOP（Plan 010 尚未合并）。然后重跑本计划 Step 1 的
> 统计命令，以当下分布为准（下表为 2026-07-14 快照）。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED（无用变量删除偶尔会暴露真 bug——那是收益不是风险，但需测试兜底）
- **Depends on**: plans/010-eslint-flat-config.md 已合并进当前分支
- **Category**: tech-debt
- **Planned at**: commit `64ab5e6`（advisor/010 分支），2026-07-14
- **Origin**: Plan 010 执行期存量（185 warning）

## Why this matters

Plan 010 为让门禁起步为绿，把存量问题降为 warning。warning 不修会永远躺着，
并淹没新增告警。审计核实后发现存量分三类，本计划只做前两类：

1. **配置产物（≈51 个，一行配置消除）**：`no-undef` 的全部实例是
  `'React'`(19)/`'window'`(13)/`'HTMLElement'`(8)/`'document'`(6)/`'JSX'`(2)
  等——TS 项目的类型检查器本就负责未定义标识符，typescript-eslint 官方建议
  对 TS 文件**直接关闭 no-undef**（globals 配置补丁是治标）。这不是 51 处
  代码债，是 1 处配置债。
2. **机械可修类（≈56 个）**：`no-unused-vars`(41)、`no-useless-escape`(6)、
  `no-empty-object-type`(4)、`no-useless-assignment`(3)、
  `preserve-caught-error`(2)、`no-empty`(1)、`no-control-regex`(1)——修法
  唯一、不改行为语义，适合批量清理后把规则升回 error。
3. **语义审慎类（不在本计划）**：`react-hooks/exhaustive-deps`(19)、
  `no-explicit-any`(9) 及 react-hooks v7 新规则（refs 等）——每处修复都可能
  改变运行时行为，需要逐个人工判断，留给维护者或未来的专项计划。

## Current state

- `eslint.config.mjs`（repo 根，Plan 010 产物）关键结构：`ignores` 数组 →
  `js.configs.recommended` → `tseslint.configs.recommended` → src 块
  （browser globals + react-hooks 规则）→ 测试块 → Node 环境块（scripts/
  tests/configs）→ 末尾"存量降噪"全局块（`no-empty`、`no-undef`、
  `no-useless-assignment` 等全部 `"warn"`）。
- 2026-07-14 warning 分布快照（执行时以 Step 1 重跑为准）：

```
 51 no-undef                              ← 配置产物，Step 2 消除
 41 @typescript-eslint/no-unused-vars     ← Step 3
 19 react-hooks/exhaustive-deps           ← 不动（语义类）
  9 @typescript-eslint/no-explicit-any    ← 不动（语义类）
  6 no-useless-escape                     ← Step 3
  4 @typescript-eslint/no-empty-object-type ← Step 3
  3 no-useless-assignment                 ← Step 3
  2 preserve-caught-error                 ← Step 3
  1 no-empty                              ← Step 3
  1 no-control-regex                      ← Step 3
```

（注：Plan 010 报告还提到 react-hooks/refs(38) 等 v7 规则 warning；若 Step 1
重跑出现它们，一律归入语义审慎类，不动。）

- 仓库验证命令与惯例：conventional commits；测试 vitest（282 个），
  `pnpm typecheck` 含契约检查。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 分布统计 | `pnpm lint 2>/dev/null \| grep -oE "warning  .*  [A-Za-z@/-]+$" \| awk '{print $NF}' \| sort \| uniq -c \| sort -rn` | 每规则计数 |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| 单测 | `pnpm test` | all pass |

## Scope

**In scope**:
- `eslint.config.mjs`（关闭 TS 文件的 no-undef；已清零规则从 warn 升 error/移出降噪块）
- `src/**`、`scripts/**`、`tests/**` 中**仅**为消除 Step 3 所列机械类 warning
  的最小代码改动

**Out of scope** (do NOT touch):
- 任何 `react-hooks/exhaustive-deps`、`react-hooks/refs`、
  `react-hooks/set-state-in-effect`、`react-hooks/preserve-manual-memoization`、
  `@typescript-eslint/no-explicit-any` 的修复——语义风险，明确不做。
- 不重构、不重命名、不"顺手改进"任何相邻代码。
- `src/generated`、`src-tauri`（本就在 ignore 列表）。

## Git workflow

- Branch: `advisor/014-eslint-warning-cleanup`
- Commit 建议：按步骤分提交——`chore(lint): 对 TS 文件关闭 no-undef`、
  `chore(lint): 清理机械类 lint 存量并升回 error`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 重跑分布统计，固定本次执行清单

跑上表"分布统计"命令，记录到报告。以实际输出划分：机械类（上文 Step 3
清单中出现的规则）与语义类（exhaustive-deps/any/react-hooks v7 系）。

**Verify**: 统计输出已记录。

### Step 2: 消除 no-undef 配置产物

在 `eslint.config.mjs` 中为所有 TS 文件关闭 no-undef（typescript-eslint
官方推荐做法——TS 编译器负责该职责）。加一个块：

```js
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
```

同时把末尾降噪块里的 `"no-undef": "warn"` 删掉。若统计中仍有 **JS 文件**的
no-undef（如 `process`），给对应文件所在目录的块补 `globals.node`。

**Verify**: 分布统计命令 → `no-undef` 计数为 0；`pnpm lint` → exit 0。

### Step 3: 逐规则清理机械类

按规则分批（一规则一批，便于回归归因），对每处 warning 做**最小修复**：

- `@typescript-eslint/no-unused-vars`(41)：删除未用的变量/import/参数。
  例外判断：若"未用"标识符是**故意保留**的（如解构丢弃 `_`、接口占位参数），
  改用规则约定的下划线前缀（需在配置里为该规则加
  `{ "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }`——允许）。
  **删除前确认它真的无副作用引用**（import 有副作用的模块不能删整行）。
- `no-useless-escape`(6)：删多余反斜杠。
- `@typescript-eslint/no-empty-object-type`(4)：`{}` 类型按上下文换成
  `object`、`Record<string, never>` 或具体类型——选让 typecheck 通过的最小项。
- `no-useless-assignment`(3)/`no-empty`(1)/`no-control-regex`(1)/
  `preserve-caught-error`(2)：按规则文档的标准修法处理；`no-empty` 的空块
  若是故意的（如忽略特定异常），补一行说明注释即可满足规则。

每清完一个规则跑一次 `pnpm test`（快，5 秒），全绿再进下一个规则。

**Verify**（每规则一次）: 分布统计 → 该规则计数 0；`pnpm test` → all pass。

### Step 4: 已清零规则升回 error

把 Step 2/3 清零的规则从降噪块删除（回到各 config 预设的默认 error 级），
或显式设 `"error"`。**语义类规则保持 warn 不动。**

**Verify**: `pnpm lint` → exit 0（0 error；剩余 warning 应只含语义类规则）；
分布统计输出与"语义类清单"一致。

### Step 5: 全量回归

**Verify**: `pnpm typecheck` → exit 0；`pnpm test` → all pass（282+）；
`pnpm lint` → exit 0。

## Test plan

不新增测试（清理不引入新行为）。每规则批次后跑 `pnpm test` 定位回归；
最终全量 `pnpm typecheck` + `pnpm test`。若删除某个"未用"变量导致测试失败，
说明它并非未用——恢复该处，记入报告（那是一个真发现）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] 分布统计中 `no-undef` 与全部机械类规则计数为 0
- [ ] 机械类规则已不在降噪 warn 块中（即恢复 error 级）
- [ ] 剩余 warning 只含语义类规则（exhaustive-deps / no-explicit-any / react-hooks v7 系）
- [ ] `pnpm lint` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` all pass
- [ ] 报告列出：每规则清理数、下划线改名数、发现的"假未用"（若有）
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- Drift check 发现 eslint.config.mjs 不存在或 `pnpm lint` 基线非 exit 0。
- 某个"未用变量"删除后测试失败且原因不明——恢复并报告，不要连带改测试。
- 清理中发现某处 warning 的正确修复需要改动行为逻辑（不再是机械修）——跳过
  该处、留在 warn、记入报告。
- 你发现自己在修 exhaustive-deps 或 any——立即停手，那是明确的 out of scope。

## Maintenance notes

- 剩余语义类 warning（exhaustive-deps 19、any 9、react-hooks v7 若干）需要
  人工逐处判断，适合维护者带上下文修或未来开专项计划——修一个验一个，
  不适合批量。
- 升回 error 后，新代码再犯这些规则会直接红门禁——预期行为。
- Reviewer 重点看：删除的 import 是否有副作用模块；`_` 前缀改名是否只用于
  真占位。
