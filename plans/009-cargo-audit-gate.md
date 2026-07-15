# Plan 009: 建立 Rust 依赖漏洞审计（cargo audit）门禁

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 97d3d0c..HEAD -- .github/workflows/quality.yml src-tauri/Cargo.lock`
> If these files changed since this plan was written, compare the "Current
> state" description against the live files before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/008-ci-rust-and-contracts-gate.md（复用其新增的 `rust` job）
- **Category**: security
- **Planned at**: commit `97d3d0c`, 2026-07-14

## Why this matters

前端依赖已有审计通道（`pnpm audit --prod`，当前无已知漏洞），但 Rust 侧
（Tauri 2 全家桶、tokio、serde 等，见 `src-tauri/Cargo.lock`）从未做过
advisory 扫描——审计当日本机连 `cargo-audit` 都未安装。桌面应用的 Rust 依赖
承担进程执行、文件系统、自动更新等敏感职责，一个 RustSec advisory 可能直接
影响发布产物。本计划把 `cargo audit` 纳入 CI，使 Rust 依赖漏洞在 PR 阶段可见。

## Current state

- `src-tauri/Cargo.lock` — Rust 依赖锁文件，`cargo audit` 的扫描对象。
- `.github/workflows/quality.yml` — Plan 008 执行后应包含一个 `rust` job
  （含 `dtolnay/rust-toolchain@stable`、`Swatinem/rust-cache@v2`、clippy、
  cargo test、契约检查步骤）。本计划在该 job 末尾追加审计步骤。
  **若该 job 不存在，说明 Plan 008 尚未执行——STOP。**
- 本机（开发环境）`cargo audit` 返回 "no such command"，即工具未安装。
- 仓库无任何 `audit.toml` / RustSec 忽略配置。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 安装工具（本地一次性） | `cargo install cargo-audit --locked` | exit 0 |
| 本地审计 | `cd src-tauri && cargo audit` | exit 0（无 vulnerability），或列出 advisory |

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/quality.yml`（在 `rust` job 追加一个步骤）
- `src-tauri/audit.toml`（仅当需要忽略仅存在于未使用特性中的误报时才创建；
  每条忽略必须附注释说明理由）

**Out of scope** (do NOT touch):
- `src-tauri/Cargo.toml` / `Cargo.lock` — **发现漏洞不等于在本计划里升级依赖**。
  依赖升级是独立决策（可能牵动 Tauri 版本矩阵），发现即报告，不要顺手升级。
- 前端依赖与 `package.json` — pnpm 审计已干净，不在本计划范围。

## Git workflow

- Branch: `advisor/009-cargo-audit-gate`
- Commit message 建议：`ci(security): 增加 cargo audit 依赖漏洞门禁`
  （conventional commits，与仓库历史一致）
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 本地基线——先看清当前有没有漏洞

安装并运行：`cargo install cargo-audit --locked`，然后
`cd src-tauri && cargo audit`。

- 若 exit 0：进入 Step 2。
- 若报出 advisory：**记录完整清单到执行报告**（advisory ID、受影响 crate、
  版本、是否有修复版本），然后仍进入 Step 2，但 CI 步骤按 Step 2 的
  "存在既有漏洞" 分支处理。

**Verify**: `cd src-tauri && cargo audit; echo "exit=$?"` → 记录退出码与输出。

### Step 2: 在 quality.yml 的 `rust` job 末尾追加审计步骤

标准形态（Step 1 干净时）：

```yaml
      - name: Install cargo-audit
        run: cargo install cargo-audit --locked
      - name: Audit Rust dependencies
        run: cargo audit --file src-tauri/Cargo.lock
```

存在既有漏洞的分支：若 Step 1 发现当前就有 advisory，不要让新门禁一上线就
把主干打红。此时给审计步骤加 `continue-on-error: true` 并在步骤名中标注
`(non-blocking until existing advisories resolved)`，同时在执行报告里列出
待处理 advisory，建议维护者为它们单独建修复任务。

**Verify**: YAML 目检 job 结构正确；`git diff --stat` 仅涉及
`.github/workflows/quality.yml`（及可能的 `src-tauri/audit.toml`）。

### Step 3: CI 实跑确认

若操作者允许推送分支：推送后 `gh run watch` 确认 `rust` job 绿（或审计步骤
按预期 non-blocking 黄）。不允许推送则以 Step 1 本地结果为替代验证并注明。

**Verify**: `gh run list --workflow=Quality --limit 1` → success（或注明未实跑）。

## Test plan

本计划不新增测试代码；验证即 Step 1 的本地审计输出与 Step 3 的 CI 实跑。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/quality.yml` 的 `rust` job 包含 `cargo audit` 步骤
- [ ] 本地 `cd src-tauri && cargo audit` 的输出已记录在执行报告中（无论干净与否）
- [ ] 若存在既有 advisory：步骤为 non-blocking 且报告列出了每条 advisory
- [ ] `git status` 显示改动仅限 In scope 文件（及 plans/README.md 状态行）
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- `quality.yml` 中不存在 Plan 008 创建的 `rust` job（依赖未满足）。
- `cargo install cargo-audit` 在你的环境反复失败（网络/工具链问题）——报告
  错误信息，不要改用来路不明的替代 action。
- 你发现自己想在本计划里升级任何 Cargo 依赖——那是 out of scope，报告即可。

## Maintenance notes

- `cargo install cargo-audit` 每次 CI 约花 1–2 分钟；若嫌慢，后续可换官方
  `rustsec/audit-check` action 或用 `Swatinem/rust-cache` 缓存二进制——留作
  优化，不在本计划强求。
- 若未来加了 `audit.toml` 忽略项，每季度应复查一次忽略是否仍然成立。
- advisory 出现时的处理约定：升级依赖走独立 PR，引用 advisory ID。
