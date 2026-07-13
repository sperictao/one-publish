# Plan 004: 建立 Geist 合规检查脚本并接入 CI 质量门禁

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4603006..HEAD -- scripts/ package.json .github/workflows/`
> 若 `scripts/check-geist-compliance.mjs` 已存在或 workflows 已有质量 job，STOP 并上报现状。

## Status

- **Priority**: P1（锁住 001–003 的全部成果）
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/002-workbench-panels-geist-cleanup.md, plans/003-dialog-style-recipe-consolidation.md, plans/006-row-components-addendum.md, plans/007-gate-prerun-addendum.md（否则脚本起跑即红）
- **Category**: dx
- **Planned at**: commit `4603006`, 2026-07-12

## Why this matters

仓库当前**没有任何机制**阻止规范偏差回流：无 ESLint（根目录无任何 eslint 配置文件），唯一的 CI workflow（`.github/workflows/build-release.yml`）只做构建发布，不跑 typecheck/test。刚刚人工修掉的 200+ 处偏差（`rounded-lg` 控件、`text-sm`、手写 tracking、`hover:bg-accent`、opacity 禁用…）随时可以被下一个 PR 原样写回来。本计划按仓库已有的自研检查脚本模式（`scripts/check-i18n-coverage.mjs`）新增一个静态扫描器，并建一条 PR 质量门禁把 typecheck / test / check:i18n / check:design 全部挂上。

## Current state

- 自研检查脚本的既有范式：`scripts/check-i18n-coverage.mjs` —— ESM、`node:fs` 读文件、发现违规打印 `file:line -> 内容` 后 `process.exit(1)`。**新脚本照抄这个交互风格**。
- `package.json` scripts 现有：`typecheck`、`test`、`check:i18n`、`check:contracts` 等；新增 `check:design`。
- CI 安装步骤约定（照抄 `build-release.yml:47-62`）：`actions/checkout@v5` → `pnpm/action-setup@v5`（version "10.10.0"）→ `actions/setup-node@v5`（node "20"）→ `pnpm install --frozen-lockfile --ignore-scripts`。
- 需要封禁的模式（均为本轮人工修复过的真实偏差类别）：见 Step 1 的 `BANNED` 清单。
- 已知合法例外（脚本必须放行，写进允许清单）：
  - `src/components/layout/SettingsDialog.tsx` 下载进度条的 `animate-pulse`（不确定进度指示，spinner 同类豁免）。
  - `bg-black/50` 弹窗遮罩（dialog.tsx / app-dialog-shell.tsx）。
  - `bg-background/80` 加载遮罩（PublishRunCard.tsx）。
  - `src/components/prototype/**` 整目录（dev-only 原型，Plan 005 决定去留前先排除）。
  - `src/generated/**`、`**/__tests__/**`。

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| 新脚本    | `pnpm check:design`      | `Geist compliance: OK (N files scanned)`，exit 0 |
| Typecheck | `pnpm typecheck`         | exit 0              |
| 全量测试  | `pnpm test`              | 全部通过            |
| i18n      | `pnpm check:i18n`        | 100%，exit 0        |

## Scope

**In scope**:
- `scripts/check-geist-compliance.mjs`（新建）
- `package.json`（仅新增 `"check:design"` script 行）
- `.github/workflows/quality.yml`（新建）

**Out of scope**:
- 任何 `src/**` 源码——若扫描发现违规，说明 002/003 未完成或有漂移，STOP 上报而不是顺手修。
- `build-release.yml`（发布流水线不动）。
- 引入 ESLint/新依赖——脚本零依赖，与 check-i18n 同栈。

## Git workflow

- Branch: `advisor/004-geist-compliance-gate`
- Commit 例：`feat(dx): 新增 Geist 合规扫描与 CI 质量门禁`
- 不 push、不开 PR，除非操作者指示。

## Steps

### Step 1: 编写 `scripts/check-geist-compliance.mjs`

结构照 `scripts/check-i18n-coverage.mjs`。核心逻辑：递归收集 `src/**/*.{tsx,ts}`（排除 `__tests__`、`src/generated`、`src/components/prototype`、`*.test.*`），逐行匹配封禁模式，命中且不在允许清单则记违规；结尾全量打印并 exit 1，否则打印 OK。

```js
const BANNED = [
  // [名称, 正则, 说明]
  ["bare-rounded",      /(?<![-\w])rounded(?![-\w])/,        "裸 rounded=4px，不在 Geist 圆角家族，用 rounded-sm"],
  ["rounded-lg-or-xl",  /rounded-(lg|xl|2xl|3xl)\b/,          "16px+ 仅限全屏面，控件/井用 rounded-sm，模态用 rounded-md"],
  ["stock-text-size",   /text-(xs|sm|base|lg|xl|2xl)\b/,      "禁 Tailwind 原生字号，用 text-label-*/copy-*/heading-*/button-*"],
  ["arbitrary-text",    /text-\[\d+px\]/,                     "禁任意值字号，用 typography token"],
  ["hand-tracking",     /tracking-\[/,                        "禁手写字距（heading token 自带的除外）"],
  ["hand-leading",      /leading-\[/,                         "禁任意值行高，行高由 typography token 提供"],
  ["accent-as-hover",   /hover:bg-(accent|muted)\b/,          "悬停用 gray-alpha 阶梯（hover:bg-gray-alpha-100）"],
  ["opacity-disabled",  /disabled:opacity-\d+/,               "禁用态用 gray-100 底 + gray-700 字 + cursor-not-allowed"],
  ["stock-palette",     /\b(bg|text|border)-(slate|zinc|stone|neutral|sky|indigo|violet|rose|orange|lime|emerald|cyan|fuchsia)-\d+/, "禁 Tailwind 原生调色板，用 Geist token"],
  ["raw-hex-class",     /(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/, "禁 className 里的裸 hex"],
  ["important-size",    /!(h|w|size)-/,                       "禁 !important 尺寸覆盖"],
  ["offscale-height",   /(?<![-\w])(h|size)-(9|11)\b/,        "36/44px 不在控件刻度（28px 行内小操作钮与装饰 chip 为合法家族，不封）"],
  ["decorative-anim",   /animate-(pulse|bounce|ping)\b/,      "循环动画仅限进行中指示（允许清单放行）"],
];

const ALLOWLIST = [
  // file 后缀匹配 + 模式名；理由必须写在这里
  { file: "src/components/layout/SettingsDialog.tsx", rule: "decorative-anim", reason: "下载进度条不确定态，spinner 同类豁免" },
  { file: "src/components/ui/switch.tsx", rule: "opacity-disabled", reason: "Radix Switch 整体禁用惯例，非文字降调" },
  { file: "src/components/publish/PublishRunCard.tsx", rule: "opacity-disabled", reason: "取消钮 disabled:opacity-100 是保持不透明，非降调" },
];
```

> **白名单实现提示**：`opacity-disabled` 正则 `/disabled:opacity-\d+/` 会同时打中
> `disabled:opacity-100`（合规，PublishRunCard:293）和真降调 `disabled:opacity-70`。
> 白名单按 (file 后缀, rule) 放行会连 `disabled:opacity-70` 一起放过——因此 Plan 007
> 必须先把 PublishRunCard 的 `disabled:opacity-70` 修掉，白名单才只放行 293 行的 `-100`。
> 若执行 004 时 PublishRunCard 仍有 `disabled:opacity-70`，STOP 并报"007 未先行"。

注意实现细节：
- 只扫描**字符串字面量所在行**即可（逐行正则足够，i18n 脚本同粒度）；不必解析 AST。
- `bare-rounded` 的负向断言已避免误伤 `rounded-sm`/`rounded-full`/`geist-scrollbar` 等；先在本仓库全量跑通再定稿正则。
- 违规输出格式与 check-i18n 一致：`Source contains N Geist violations:` + `file:line -> [rule] 行内容截断到 120 字符`。

**Verify**: `node scripts/check-geist-compliance.mjs` → `Geist compliance: OK`，exit 0（若非 0，输出的每一条都必须是 002/003 漏网——STOP 上报清单，不要自己修 src）

### Step 2: 注册 package.json script

在 `"check:i18n"` 行旁新增：`"check:design": "node scripts/check-geist-compliance.mjs"`。

**Verify**: `pnpm check:design` → exit 0

### Step 3: 自证脚本有效（红测）

临时创建 `src/components/__geist_canary__.tsx` 内容 `export const x = <div className="rounded-lg text-sm tracking-[0.2em]" />;`（需要 import React 与否以 typecheck 无关，本步只跑扫描器），运行 `pnpm check:design` 应 exit 1 且报出 3 条。删除该文件后复跑应 exit 0。**此文件绝不提交。**

**Verify**: 红→绿两次运行结果如上；`git status` 无 canary 残留

### Step 4: 新建 `.github/workflows/quality.yml`

```yaml
name: Quality

on:
  pull_request:
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
        with:
          version: "10.10.0"
      - uses: actions/setup-node@v5
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm check:i18n
      - run: pnpm check:design
```

注意：`pnpm typecheck` 含 ts-rs 契约校验（`check:contracts` 由 typecheck 复合脚本触发时除外——先看 package.json 中 `typecheck` 的实际定义，若不含契约校验且 `check:contracts` 不需要 Rust 工具链即可运行，则追加一行 `- run: pnpm check:contracts`；若需要 Rust 工具链则不加，并在 PR 描述记录该取舍）。

**Verify**: `act` 不可用时静态校验——`python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/quality.yml'))"` → 无异常

### Step 5: 全量回归

**Verify**: `pnpm typecheck && pnpm test && pnpm check:i18n && pnpm check:design` → 全部 exit 0

## Test plan

- 脚本自身以 Step 3 的红/绿 canary 验证，不写 vitest 用例（与 check-i18n 同待遇）。
- CI yml 以 YAML 解析冒烟；真实验证发生在下一个 PR。

## Done criteria

- [ ] `pnpm check:design` exit 0，输出含扫描文件数
- [ ] 红测（Step 3）证实过脚本能抓违规
- [ ] `.github/workflows/quality.yml` 存在且 YAML 合法
- [ ] `pnpm typecheck && pnpm test && pnpm check:i18n` exit 0
- [ ] `git status` 无 in-scope 外改动、无 canary 残留
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- Step 1 首跑发现 >10 条违规（说明 002/003 未落地或大幅漂移——报清单）。
- 某封禁正则在合法代码上误报且无法用负向断言收敛（报模式与例句，等待裁决，不要静默放宽）。
- `pnpm test` 在干净分支上本来就红。

## Maintenance notes

- 允许清单是唯一逃生门：新增例外必须带 reason 字段，review 时可 grep `ALLOWLIST` 审计。
- 若未来引入 ESLint，可把本脚本迁为 eslint 规则；在那之前它是唯一防线。
- `quality.yml` 与 `build-release.yml` 完全独立；发布流水线不受影响。
