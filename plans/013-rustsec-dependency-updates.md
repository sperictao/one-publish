# Plan 013: 升级带 RustSEC advisory 的 Cargo 传递依赖，尽量收紧 audit 门禁

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: 本计划写于 Round 2 分支合并之前，基准是
> `advisor/010-eslint-flat-config` 分支尖端 `64ab5e6`。执行前确认：
> (1) `.github/workflows/quality.yml` 的 `rust` job 存在且末尾有
> `Audit Rust dependencies (non-blocking until existing advisories resolved)`
> 步骤（来自 Plan 009）——不存在则 STOP（Round 2 尚未合并）。
> (2) `git log --oneline -1 -- src-tauri/Cargo.lock` 若晚于 2026-07-14，先重跑
> `cargo audit` 获取当下清单，以其为准（下表可能已过时）。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（升级传递依赖可能引入行为变化，靠全量测试兜底）
- **Depends on**: plans/009-cargo-audit-gate.md 已合并进当前分支
- **Category**: security
- **Planned at**: commit `64ab5e6`（advisor/010 分支），2026-07-14
- **Origin**: Plan 009 执行期发现（cargo audit 报 14 个 vulnerability）

## Why this matters

2026-07-14 的 `cargo audit` 在 `src-tauri/Cargo.lock` 上报出 14 个
vulnerability（另有 24 个 unmaintained/unsound warning，不在本计划范围）。
全部是**传递依赖**（经 tauri / tauri-plugin-updater / reqwest / plist 拉入，
`Cargo.toml` 未直接声明任何一个）。多数有 semver 兼容的修复版，`cargo update`
即可收敛；少数（quick-xml）需要跨 semver 的父级配合，本计划只做诚实记录。
清零或收敛后，把 Plan 009 留下的 `continue-on-error: true` 摘掉，让 audit
门禁真正阻断。

## Current state

- 2026-07-14 清单（执行时以重跑结果为准）：

| Advisory | Crate | 锁定版本 | 严重度 | 修复版 | cargo update 可修? |
|---|---|---|---|---|---|
| RUSTSEC-2026-0007 | bytes | 1.11.0 | — | >=1.11.1 | 是（semver 兼容） |
| RUSTSEC-2026-0194/0195 | quick-xml | 0.37.5 与 0.38.4 两个锁定版 | 7.5 high | >=0.41.0 | **否**（父级 plist/tauri 等声明 0.37/0.38，跨 semver） |
| RUSTSEC-2026-0037/0185 | quinn-proto | 0.11.13 | 8.7/7.5 high | >=0.11.14/0.11.15 | 是 |
| RUSTSEC-2026-0049/0098/0099/0104 | rustls-webpki | 0.103.9 | — | >=0.103.13 | 是 |
| RUSTSEC-2026-0067/0068 | tar | 0.4.44 | 5.1 med | >=0.4.45 | 是 |
| RUSTSEC-2026-0009 | time | 0.3.45 | 6.8 med | >=0.3.47 | 是 |

- 依赖路径（核实于 2026-07-14）：`rustls-webpki ← rustls ← hyper-rustls ←
  reqwest`；`tar ← tauri-plugin-updater`；`time ← cookie ← tauri`；
  `quick-xml@0.38.4 ← plist ← tauri`（0.37.5 为另一父级锁定）。
- `.github/workflows/quality.yml` rust job 末两步（Plan 009 产物）：

```yaml
      - name: Install cargo-audit
        run: cargo install cargo-audit --locked
      - name: Audit Rust dependencies (non-blocking until existing advisories resolved)
        run: cargo audit --file src-tauri/Cargo.lock
        continue-on-error: true
```

- `src-tauri/Cargo.toml` 不直接声明上述任何 crate——**本计划不应改动
  Cargo.toml**，只动 `Cargo.lock`（经 `cargo update -p`）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 审计 | `cd src-tauri && cargo audit` | 见各步骤 |
| 定向升级 | `cd src-tauri && cargo update -p <crate>@<locked-ver> --precise <fix-ver>`（或不带 --precise 让其取最新兼容版） | Cargo.lock 更新 |
| Rust 测试 | `cd src-tauri && cargo test` | all pass |
| Clippy | `cd src-tauri && cargo clippy -- -D warnings` | exit 0 |
| 契约 | `pnpm check:contracts` | exit 0 |
| 前端回归 | `pnpm test` | all pass |

## Scope

**In scope**:
- `src-tauri/Cargo.lock`（仅经 `cargo update -p` 产生的变更）
- `.github/workflows/quality.yml`（仅当审计清零时移除 `continue-on-error` 与
  步骤名中的 non-blocking 标注）
- `src-tauri/audit.toml`（仅当存在确认无法升级的残留 advisory 时创建，每条
  ignore 必须带注释：advisory ID、无法升级原因、复查日期）

**Out of scope** (do NOT touch):
- `src-tauri/Cargo.toml` — 不新增/修改任何直接依赖声明，不为绕过传递依赖
  而直接 pin。
- Tauri 及其插件的版本（`tauri`、`tauri-plugin-*`）——大版本/小版本升级是
  独立决策，即使它能带动 quick-xml 修复也不在本计划做。
- 24 个 unmaintained/unsound warning（gtk3 全家等）——它们不阻断门禁，
  多数等 Tauri 上游迁移，单独追踪。

## Git workflow

- Branch: `advisor/013-rustsec-dependency-updates`
- Commit 建议：`fix(deps): 升级带 RustSEC advisory 的传递依赖并收紧 audit 门禁`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: 重跑审计，固定本次执行的真实清单

`cd src-tauri && cargo audit` 完整记录输出。若清单与上表不同，以实际为准
（上表行若已消失则跳过对应升级）。

**Verify**: 输出已记录；`git status` 仍干净。

### Step 2: 逐个定向升级 semver 兼容项

对表中"可修=是"的每个 crate 执行（版本号以 Step 1 实际输出为准）：

```
cargo update -p bytes
cargo update -p quinn-proto
cargo update -p rustls-webpki
cargo update -p tar
cargo update -p time
```

不带 `--precise`，让 cargo 取声明范围内最新版。每跑一个后
`git diff --stat Cargo.lock` 确认只有预期 crate 及其内联子依赖变动。
**禁止 `cargo update`（无 -p 全量更新）**——会把整个锁文件刷新，diff 不可审。

**Verify**: `cd src-tauri && cargo audit` → 表中除 quick-xml 外的 advisory
全部消失（若某项仍在：该 crate 的父级把版本上限锁死了，记录进残留清单，
继续）。

### Step 3: 编译与全量回归

**Verify**: `cd src-tauri && cargo clippy -- -D warnings` → exit 0；
`cd src-tauri && cargo test` → all pass；`pnpm check:contracts` → exit 0；
`pnpm test` → all pass。任何失败 → 用 `git checkout -- Cargo.lock` 回滚后
逐 crate 二分定位罪魁，报告它并把它移入残留清单（不要硬修代码适配新版本，
那是 STOP 信号）。

### Step 4: 处理残留（预期至少 quick-xml 两个锁定版）

对确认无法经 `cargo update -p` 修复的 advisory：

1. 创建 `src-tauri/audit.toml`：

```toml
[advisories]
ignore = [
    # RUSTSEC-2026-0194 / RUSTSEC-2026-0195: quick-xml < 0.41
    # 传递依赖（plist<-tauri 等父级声明 0.37/0.38，无法本地升级）。
    # 等待 Tauri 上游升级 plist/quick-xml。复查：2026-10 或 Tauri 下一次 minor。
    "RUSTSEC-2026-0194",
    "RUSTSEC-2026-0195",
]
```

（实际 ID 以 Step 1 输出为准；每条 ignore 都要有同格式注释。）

2. 确认 `cd src-tauri && cargo audit` 现在 exit 0（ignore 生效）。

**Verify**: `cd src-tauri && cargo audit; echo exit=$?` → exit=0。

### Step 5: 收紧 CI 门禁

`cargo audit` 已 exit 0（真清零或带注释 ignore），现在移除 quality.yml 中
audit 步骤的 `continue-on-error: true`，步骤名去掉
"(non-blocking until existing advisories resolved)" 改为
`Audit Rust dependencies`。

**Verify**: python/node YAML 解析成功；`git diff .github/workflows/quality.yml`
仅这两处变化。

## Test plan

不新增测试。回归 = Step 3 的四条命令（Rust 单测+集成、clippy、契约、前端
全量——契约检查同时验证 ts-rs 生成物未受依赖升级影响）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd src-tauri && cargo audit` exits 0
- [ ] `git diff` 中 `Cargo.toml` 无变化
- [ ] `cargo clippy -- -D warnings`、`cargo test`、`pnpm check:contracts`、`pnpm test` 全部 exit 0
- [ ] quality.yml 的 audit 步骤已无 `continue-on-error`
- [ ] 若存在 audit.toml：每条 ignore 均有 advisory ID + 原因 + 复查日期注释
- [ ] 执行报告含：升级成功清单（crate: 旧→新）、残留清单及原因
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

Stop and report back (do not improvise) if:

- Drift check 发现 rust job / audit 步骤不存在（Round 2 未合并）。
- 某个 `cargo update -p` 后编译失败或任一测试失败，且回滚该 crate 后无法
  归因——报告 crate 名与错误。
- 你发现自己想改 `Cargo.toml`、想升级 tauri 系 crate、或想改业务代码适配
  新依赖——全部越界，报告即可。
- 重跑的 audit 清单出现表外**新增** critical/high advisory 且升级路径不明——
  先报告再动。

## Maintenance notes

- audit.toml 的 ignore 是**带息负债**：每条都写了复查日期，Tauri minor 升级
  后应第一时间重跑 `cargo audit` 尝试删掉它们。
- 门禁转为阻断后，新 advisory 会直接红 CI——这是预期行为；届时按本计划
  Step 2 的定向升级法处理。
- Reviewer 重点看：Cargo.lock diff 是否只含目标 crate 链；audit.toml 注释
  是否完整。
