# Plan 015: 升级 zip 至 8.x，解锁 time 安全修复并清除 yanked 依赖

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: 基准为 `advisor/013-rustsec-dependency-updates`
> 分支（含 013 的 audit.toml 与门禁收紧）。执行前确认：
> (1) `src-tauri/Cargo.toml` 中有 `zip = "7.3"`；
> (2) `src-tauri/.cargo/audit.toml` 存在且含 RUSTSEC-2026-0009 的 ignore 条目；
> 任一不成立 → STOP（013 未合并或已被他人处理）。

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED（zip 主版本升级，靠 artifact 模块现有测试兜底）
- **Depends on**: plans/013-rustsec-dependency-updates.md（其 audit.toml / 门禁产物）
- **Category**: security
- **Planned at**: `advisor/013` 链（5cbb449），2026-07-14
- **Origin**: Plan 013 执行期发现

## Why this matters

`Cargo.toml` 直接依赖 `zip = "7.3"`，但 crates.io 上 `^7.3` 范围内的所有版本
（7.3.0、7.4.0）**均已被 yank**——任何人删掉 `Cargo.lock` 或新拉环境都可能
无法解析构建。同时 zip 7.3.0 对 `time` 的版本要求把 `time` 锁死在 0.3.45，
挡住了 RUSTSEC-2026-0009（medium, 6.8）的修复版 0.3.47+，013 只能将其加入
ignore 清单。升级 zip 到 8.x（当前最新稳定 8.6.0）一次解决三件事：消除
yanked 依赖风险、解锁 time 升级、从 audit.toml 删掉一条带息负债。

## Current state

- `src-tauri/Cargo.toml:40` — `zip = "7.3"`（唯一需要改动的声明）。
- zip 的全部使用面在**一个文件** `src-tauri/src/artifact/mod.rs`：
  - `:9` — `use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};`
  - `:33`/`:69` — 错误封装引用 `zip::result::ZipError`
  - `:175` — `let mut zip = ZipWriter::new(output_file);`
  - `:176` — `SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)`
  - `:207` — `zip.start_file(name, options)`
  - `:223` — `zip.finish()`
  - `:401` — 测试内 `zip::ZipArchive::new(f)`（读回验证压缩产物）
- crates.io 非 yank 稳定版（2026-07-14 查询）：8.6.0（最新）、8.5.1、…、8.0.0；
  7.x 仅剩 7.2.0 未被 yank。
- `src-tauri/.cargo/audit.toml`（013 产物）含 RUSTSEC-2026-0009 ignore 条目
  及注释（"需升级 Cargo.toml 的 zip 至 8.x"——即本计划）。
- artifact 模块有内联测试（`#[cfg(test)]`，含 `:401` 的 zip 读回断言），是
  本次升级的行为兜底。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 升级声明后重解析 | `cd src-tauri && cargo update -p zip` | Cargo.lock 中 zip → 8.x |
| 编译检查 | `cd src-tauri && cargo check` | exit 0 |
| Clippy | `cd src-tauri && cargo clippy -- -D warnings` | exit 0 |
| Rust 测试 | `cd src-tauri && cargo test` | all pass |
| time 解锁验证 | `cd src-tauri && cargo update -p time && grep -A1 'name = "time"' Cargo.lock \| grep version` | >=0.3.47 |
| 审计 | `cd src-tauri && cargo audit` | exit 0（去掉 0009 ignore 后） |
| 契约 | `pnpm check:contracts` | exit 0 |
| 前端回归 | `pnpm test` | all pass |

## Scope

**In scope**:
- `src-tauri/Cargo.toml`（仅 `zip` 一行：`"7.3"` → `"8"`）
- `src-tauri/Cargo.lock`（cargo update -p 产物）
- `src-tauri/src/artifact/mod.rs`（**仅当** zip 8.x API 有签名变化时的最小
  适配——导入路径、方法改名、Options 类型名等机械替换；行为不得变）
- `src-tauri/.cargo/audit.toml`（删除 RUSTSEC-2026-0009 条目及其注释）

**Out of scope** (do NOT touch):
- artifact 模块的压缩逻辑/目录遍历/错误处理结构——只做 API 机械适配。
- 其他任何 Cargo 依赖（time 经 `cargo update -p time` 解锁属预期连带，但
  不得顺手升级无关 crate）。
- quality.yml——013 已收紧，无需再动。

## Git workflow

- Branch: `advisor/015-zip-upgrade`（自当前链尖创建）
- Commit 建议：`fix(deps): 升级 zip 至 8.x，解锁 time 安全修复`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 改声明并重解析

`src-tauri/Cargo.toml` 的 `zip = "7.3"` 改为 `zip = "8"`，然后
`cd src-tauri && cargo update -p zip`。

**Verify**: `grep -A1 'name = "zip"' Cargo.lock | grep version` → `8.x`（应为
8.6.0 或更新）；`git diff --stat` 仅 Cargo.toml + Cargo.lock。

### Step 2: 编译适配（如需要）

`cargo check`。若报错，只允许对 `artifact/mod.rs` 做**机械 API 适配**（改
导入路径/类型名/方法名），保持逻辑与错误语义不变。8.x 的 `ZipWriter`/
`SimpleFileOptions`/`start_file`/`finish`/`ZipArchive` 大概率兼容——若发现
需要改的不止签名（如行为语义、返回类型结构变化导致错误处理重写），STOP。

**Verify**: `cargo check` → exit 0；`git diff src/` 若非空，仅 artifact/mod.rs
且均为机械替换。

### Step 3: 解锁 time

`cargo update -p time`。

**Verify**: `grep -A1 'name = "time"' Cargo.lock | grep version` → `0.3.47`
或更新。

### Step 4: 更新 audit.toml 并验证审计

从 `src-tauri/.cargo/audit.toml` 删除 `"RUSTSEC-2026-0009"` 条目及其注释块
（quick-xml 两条保留）。

**Verify**: `cd src-tauri && cargo audit; echo exit=$?` → exit=0，且输出的
warning 列表中不再出现 `zip 7.3.0 yanked`。

### Step 5: 全量回归

**Verify**: `cd src-tauri && cargo clippy -- -D warnings` → exit 0；
`cargo test` → all pass（重点：artifact 模块测试，含 zip 读回断言）；
`pnpm check:contracts` → exit 0；`pnpm test` → all pass。

## Test plan

不新增测试——`artifact/mod.rs:401` 的既有测试会用新版 zip 写入并读回压缩包，
直接验证升级后的行为等价。回归命令见 Step 5。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Cargo.toml 中 zip 声明为 `"8"`，Cargo.lock 锁定 8.x 非 yank 版本
- [ ] Cargo.lock 中 time >= 0.3.47
- [ ] audit.toml 无 RUSTSEC-2026-0009；`cargo audit` exit 0 且无 zip yanked warning
- [ ] clippy -D warnings / cargo test / check:contracts / pnpm test 全绿
- [ ] `git diff src/` 为空，或仅含 artifact/mod.rs 的机械 API 适配
- [ ] 改动已提交，git status 干净
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- zip 8.x 的 API 变化超出机械替换（需要重写压缩流程、错误处理结构或引入
  新逻辑分支）——报告具体差异。
- artifact 测试在适配后失败且两次合理修复尝试无效。
- `cargo update -p time` 后 time 仍 < 0.3.47（还有别的父级锁住它——报告
  `cargo tree -i time` 输出）。
- 除 zip/time 及其直接子依赖外，Cargo.lock 出现大面积无关变动。

## Maintenance notes

- zip 9.0 已有 pre-release；下次大版本升级同样只需盯 artifact/mod.rs 一个文件。
- audit.toml 剩余 quick-xml 两条 ignore 等 Tauri 上游，复查日期 2026-10。
- Reviewer 重点看：artifact/mod.rs 的 diff 是否纯机械；`cargo test` 中 zip
  读回测试是否真实跑过（非 ignored）。
