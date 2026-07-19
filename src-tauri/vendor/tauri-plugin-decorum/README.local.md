# README.local.md — 本地 vendored 副本说明

> 本文件由 one-publish 维护者维护，记录 `src-tauri/vendor/tauri-plugin-decorum/`
> 的上游来源、基线版本、本地定制清单与同步流程。上游自带的 `README.md`
> 保留不动，所有本地维护信息集中在本文件。

## 1. 上游来源

- **仓库**：https://github.com/clearlysid/tauri-plugin-decorum
- **来源字段出处**：`Cargo.toml.orig` 的 `homepage` 与 `repository` 字段（均指向同一 URL）。
- **License**：MIT（见 `LICENSE`，与上游一致）。
- **上游状态**：作者声明项目处于 maintenance mode，不再有 breaking API 变更，
  只接 bugfix / 架构改进 PR（见上游 `README.md` 的 Roadmap 段）。

## 2. 基线版本

- **版本号**：`1.1.1`
- **来源字段出处**：`Cargo.toml.orig` 的 `version` 字段。
- **vendor 引入提交**：`31ce018`（`chore(deps): vendor tauri-plugin-decorum for local customization`）。
  该提交是此目录唯一的 git 提交，所有文件一次性拷入，git 历史中无后续编辑。
- **引用方式**：`src-tauri/Cargo.toml:32` 通过 `path = "vendor/tauri-plugin-decorum"` 引用，
  取代原先的 crates.io registry 依赖。

## 3. 本地定制清单

### 3.1 依赖层差异（机械对比 `Cargo.toml` vs `Cargo.toml.orig`）

逐项对比两个文件的所有 `[dependencies]` / `[target.*.dependencies]` / `[build-dependencies]` 条目，
**依赖集合与版本号完全一致**，差异仅来自 Cargo 对 `Cargo.toml` 的自动规范化
（展开简写、补 `autobins`/`autotests` 等字段、重排段落）。无本地依赖增删或版本 pin 调整。

| 依赖                     | 目标    | orig 声明                | vendored Cargo.toml 声明 | 差异 |
| ------------------------ | ------- | ------------------------ | ------------------------ | ---- |
| tauri                    | 通用    | `2.0.0-rc`               | `2.0.0-rc`               | 无   |
| serde                    | 通用    | `1.0`                    | `1.0`                    | 无   |
| anyhow                   | 通用    | `1.0`                    | `1.0`                    | 无   |
| rand                     | macos   | `^0.8`                   | `^0.8`                   | 无   |
| cocoa                    | macos   | `0.25`                   | `0.25`                   | 无   |
| objc                     | macos   | `0.2`                    | `0.2`                    | 无   |
| enigo                    | windows | `0.1.3`                  | `0.1.3`                  | 无   |
| linicon                  | linux   | `2.3.0`                  | `2.3.0`                  | 无   |
| tauri-plugin (build-dep) | 通用    | `2.0.0-rc` + `["build"]` | `2.0.0-rc` + `["build"]` | 无   |

### 3.2 源码层定制点

vendor 提交信息（`31ce018`）声明的本地化动机：

> enable local patching for traffic light positioning fixes
> （为 macOS 交通灯位置修复开启本地 patch 能力）

**截至本文件创建时**，git 历史中此目录仅有一次 vendor 提交，无后续编辑提交，
因此**尚无可机械提取的源码 diff**。当前消费侧的"定制"体现在应用层调用：

- `src-tauri/src/lib.rs:93` — `main_window.set_traffic_lights_inset(18.0, 32.0)?;`
  以 `(18.0, 32.0)` 的 inset 调整 macOS 交通灯位置。

vendor 目录的源码（`src/traffic.rs` 等）目前与上游 1.1.1 一致；
若未来在 `src/traffic.rs` 等文件上叠加本地 patch，请在本节追加：

- patch 文件路径与函数
- 与上游对应版本的 diff 摘要
- 定制动机

> **TODO(maintainer): 补充定制动机** — 当前 vendor 化的预期收益是"可快速 patch
> 交通灯位置相关逻辑"，但尚未落地具体源码改动。请补充：为何不直接向上游提 PR？
> 为何不通过 fork + `[patch.crates-io]` 替代 path vendor？维护者评估后填入。

## 4. 上游同步流程

1. **对照基线** — 打开 https://github.com/clearlysid/tauri-plugin-decorum/releases ，
   与本文件 §2 记录的基线 `1.1.1` 对比，确认是否有新版（特别是 macOS/Windows
   兼容性 bugfix）。
2. **重新 vendor** —
   - clone 上游对应 tag/commit 到临时目录；
   - 用上游新版本覆盖本目录除 `README.local.md` 外的所有文件
     （保留 `Cargo.toml.orig`，由上游 release tarball 提供）；
   - 重新应用 §3.2 记录的本地 patch（若有）；
   - 更新本文件 §2 的基线版本号与 vendor 提交 hash，更新 §3.1 的依赖对比表。
3. **验证** —
   - `cargo test`（在 `src-tauri/` 下）确保编译通过、单元测试不回归；
   - `pnpm dev` 启动应用，目视确认 macOS 交通灯位置（`18.0, 32.0` inset）
     与窗口装饰行为符合预期；
   - Windows/Linux 平台若有改动，需在对应平台目视回归窗口控件。

## 5. 长期选项（候选，未执行）

评估用 `[patch.crates-io]` 指向自维护的 git fork，取代 path vendor：

```toml
# src-tauri/Cargo.toml 顶层（候选方案，当前未启用）
[patch.crates-io]
tauri-plugin-decorum = { git = "https://github.com/<org>/tauri-plugin-decorum-fork", tag = "v1.1.1-onepublish" }
```

**优点**：可保留 fork 的独立 git 历史，本地定制以 commit 形式可追溯，
cherry-pick 上游修复更直观。

**缺点**：需要额外的 fork 仓库与发布流程；CI 需能访问该 git 源；
对离线构建不友好（path vendor 可直接 vendored 进 monorepo）。

**当前决策**：保留 path vendor，待本地 patch 累积到一定规模再迁移。
