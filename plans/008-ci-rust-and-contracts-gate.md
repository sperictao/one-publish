# Plan 008: 让 CI 质量门禁运行 Rust 测试、Clippy 与 ts-rs 契约漂移检查

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 97d3d0c..HEAD -- .github/workflows/quality.yml`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live file before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `97d3d0c`, 2026-07-14

## Why this matters

本仓库是 Tauri 应用：前端 React/TS + 后端 Rust（`src-tauri/`）。后端有 224 个
`#[test]` 单元测试和 3 个集成测试文件（`src-tauri/tests/`），但 CI 的
`quality.yml` 只运行 `tsc`、Vitest、i18n 检查和设计检查——**Rust 测试与 Clippy
从不在 PR 上运行**。同样，`pnpm check:contracts`（验证 ts-rs 从 Rust 类型生成的
`src/generated/tauri-contracts.ts` 没有漂移）也不在 CI 中，尽管本地
`pnpm typecheck` 会先跑它。结果：Rust 回归和前后端类型脱节只能靠开发者本地
自觉发现。本计划补上这两个门禁。

## Current state

- `.github/workflows/quality.yml` — 现有质量工作流，全文如下（planned-at 时）：

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
      - run: pnpm exec tsc --noEmit
      - run: pnpm test
      - run: pnpm check:i18n
      - run: pnpm check:design
```

- `.github/workflows/build-release.yml` — 发布工作流。它的 Rust 环境搭建方式是
  本仓库的既定惯例，新 job 必须照抄（含 Linux 系统依赖）：

```yaml
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Install Linux dependencies
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf
```

- `scripts/check-tauri-contracts.mjs` — 契约检查脚本。注意：它内部执行
  `cargo run --manifest-path src-tauri/Cargo.toml --example generate_tauri_contracts`
  重新生成契约再对比，**因此需要 Rust 工具链和上述 Linux 系统依赖**（Tauri
  crate 编译依赖 webkit2gtk 等）。这就是为什么契约检查必须放进 Rust job 而
  不是现有的纯 Node job。
- `package.json` 相关脚本：`"check:contracts": "node scripts/check-tauri-contracts.mjs"`。
- Rust 测试现状：`cd src-tauri && cargo test` 本地通过（224 单元测试 + tests/ 集成测试）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| YAML 语法自检 | `node -e "const yaml=require('js-yaml');yaml.load(require('fs').readFileSync('.github/workflows/quality.yml','utf8'));console.log('ok')"`（若 js-yaml 不可用则跳过，仅目检） | 输出 ok |
| Rust 测试（本地验证命令与 CI 一致） | `cd src-tauri && cargo test` | exit 0, all pass |
| Clippy（本地验证） | `cd src-tauri && cargo clippy -- -D warnings` | exit 0 |
| 契约检查（本地验证） | `pnpm check:contracts` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/quality.yml`
- `src-tauri/src/commands/publish/execution.rs`、`src-tauri/src/commands/publish/logs.rs`
  （**仅限 Step 0.5 描述的两处 clippy 基线修复**，2026-07-14 执行期发现主干
  在 `-D warnings` 下本就红，修复纳入本计划以免门禁一上线即红）

**Out of scope** (do NOT touch):
- `.github/workflows/build-release.yml` — 发布流水线，与质量门禁无关。
- `scripts/check-tauri-contracts.mjs`、`src-tauri/**`、`package.json` — 本计划
  只改 CI 编排，不改任何被编排的脚本或代码。

## Git workflow

- Branch: `advisor/008-ci-rust-and-contracts-gate`
- Commit message style: conventional commits（仓库示例：`chore(release): publish v0.8.0`、`feat(ui): 引入骨架与空态原语并统一加载/空状态`）。建议：`ci(quality): 增加 Rust 测试、Clippy 与契约漂移门禁`
- Do NOT push or open a PR unless the operator instructed it.

### Step 0: 本地基线验证

在改任何东西之前，确认三条命令在当前代码上本就通过（否则是 STOP 条件——
说明主干已红，先报告而不是把红门禁合进 CI）：

**Verify**: `cd src-tauri && cargo clippy -- -D warnings && cargo test` → exit 0；
`pnpm check:contracts` → exit 0。

### Step 0.5: 修复两处 clippy 基线错误（2026-07-14 修订新增）

执行期发现主干 `97d3d0c` 在 `-D warnings` 下有 2 个 clippy error，必须先修
否则门禁一上线即红：

1. `src-tauri/src/commands/publish/logs.rs:63` — `clippy::collapsible_if`：
   将嵌套 if 用 `&&` 合并为单层，逻辑不变。
2. `src-tauri/src/commands/publish/execution.rs:161` — `clippy::type_complexity`：
   为 `Result<(bool, bool, Option<String>, String, Vec<String>), AppError>` 的
   元组定义一个模块内 `type` 别名（优先），或在该处加
   `#[allow(clippy::type_complexity)]`。二选一，选改动最小、最贴近周边代码
   风格的方案。**不得改变任何运行时行为。**

**Verify**: `cd src-tauri && cargo clippy -- -D warnings` → exit 0；
`cd src-tauri && cargo test` → exit 0（行为未变）；`pnpm check:contracts` → exit 0。

### Step 1: 在 quality.yml 中新增独立的 `rust` job

保持现有 `quality` job 原样不动，新增一个并行 job（独立 job 而非追加步骤，
是为了不让 Rust 编译拖慢前端反馈，且两者失败信号互不掩盖）：

```yaml
  rust:
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
      - name: Install Linux dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - name: Clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
      - name: Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml
      - name: Contracts drift check
        run: pnpm check:contracts
```

说明：pnpm/node 步骤是 `pnpm check:contracts` 需要的；`Swatinem/rust-cache`
用于避免每次全量编译 Tauri 依赖（首跑约 10 分钟，缓存后显著缩短）。

**Verify**: YAML 语法自检命令 → ok；`git diff --stat` 仅显示
`.github/workflows/quality.yml` 一个文件被修改。

### Step 2: 确认工作流在 CI 上通过

若操作者允许推送分支：推送后用 `gh run watch` 观察两个 job 均绿。若不允许
推送，则以 Step 0 的本地命令结果作为替代验证，并在报告中注明"CI 实跑未验证"。

**Verify**: `gh run list --workflow=Quality --limit 1` → conclusion: success
（或注明未实跑）。

## Test plan

本计划不新增测试代码——它让 227 个已存在的 Rust 测试和契约检查开始在 CI 运行。
验证即 Step 0 的三条命令 + CI 实跑。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/quality.yml` 包含 `cargo clippy`、`cargo test`、`pnpm check:contracts` 三个步骤
- [ ] `cd src-tauri && cargo clippy -- -D warnings` exits 0
- [ ] `cd src-tauri && cargo test` exits 0
- [ ] `pnpm check:contracts` exits 0
- [ ] `git status` 显示除 `.github/workflows/quality.yml`（及 plans/README.md 状态行）外无其他修改
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- Step 0 任一命令在未改动的代码上失败（主干已红，需要先修复代码而非改 CI——
  那超出本计划范围）。
- `quality.yml` 与 Current state 的摘录不一致（已漂移）。
- `pnpm check:contracts` 在 CI 环境因缺少额外系统依赖失败且安装上述 Linux
  依赖后仍失败——报告具体缺失项，不要自行往工作流里堆包。

## Maintenance notes

- Clippy 用 `-D warnings` 意味着未来任何新警告都会红门禁；如果团队觉得过严，
  降级为不带 `-D warnings` 是一行改动。
- `Swatinem/rust-cache` 缓存随 `Cargo.lock` 变化失效，Tauri 大版本升级后首跑会慢。
- 后续若采纳 Plan 009（cargo audit），其步骤应追加到本 job 而不是再开新 job。
