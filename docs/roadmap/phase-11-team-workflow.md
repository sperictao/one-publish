# Phase 11：团队工作流集成（Team Workflow Integration）

> 一页 roadmap。本文档定义 Phase 11 的范围、候选能力、明确不做项与完成判定，不涉及实现。
> 与 `docs/design-philosophy.md` 同风格：先说清楚定位，再列能力清单，最后给出可验证的 Done 条件。

## 定位

OnePublish 当前是一个**个人本地发布工具**（见 `docs/design-philosophy.md` 的 "Local-First By Default"）。Phase 11 是从「单人在本机用得好」到「团队场景下不打架」之间的一座桥。

边界纪律：

- **只吸收用户已经在工具外手工做的事**（团队共享配置、把命令贴进 CI、交接时导出历史）。
- **不做协作平台**：无账号、无服务端、无实时协作（见下方「明确不做」）。

判断每条候选能力的唯一标准：**它是否对应一个用户今天已经在终端/聊天工具/工单系统里手工完成的动作**。如果是，工具收口；如果不是，不做。

## 候选能力清单

每条给出：用户价值一句话、现有积木（真实代码路径）、粗略量级、开放问题。

### 候选 A：团队配置包（Team config bundle）

- **用户价值**：团队多人复用同一套发布参数（同一仓库、同一 provider、同一组 flag），避免每人各自维护一遍。
- **现有积木**：
  - `src-tauri/src/config_export.rs`：`ConfigExport` / `ConfigProfile` 结构体，`sanitize_for_export()` 已剥离机器相关路径（`project_path`、绝对路径的 `output`/`target_dir`），`validate_import()` 已做版本/provider/参数校验。
  - `src/components/publish/ConfigDialog.tsx`：配置 UI 入口。
- **量级**：M（导出已存在；缺的是「导入冲突 UX」——同名 profile 覆盖/跳过/重命名策略尚未在 `ImportError` 中建模）。
- **开放问题**：
  1. 导入同名 profile 时的冲突策略（覆盖 / 跳过 / 重命名）放哪个层？前端选择还是后端 `ImportError` 增加变体？
  2. 配置包是否需要携带「provider schema 版本快照」，避免团队中 provider 升级后导入语义漂移？
  3. 是否需要在导出时附加人类可读的 README/校验和（防误改）？

### 候选 B：CI handoff 格式扩展（CI handoff format extension）

- **用户价值**：把本地跑通的发布命令一键变成团队 CI 可用的片段，覆盖更多 CI 平台。
- **现有积木**：
  - `src/lib/handoffSnippet.ts:8`：`HandoffSnippetFormat = "shell" | "github-actions"`，已有 `buildShellHandoffSnippet()` 与 `buildGitHubActionsSnippet()`。
- **量级**：S（每新增一个格式约等于再加一个 `buildXxxSnippet()`，外加一个枚举值）。
- **下一个格式**：**GitLab CI**（`.gitlab-ci.yml` 的 `script:` 块）。
- **开放问题**：
  1. 格式选择 UI 是下拉还是 provider 感知自动推荐？
  2. 是否需要可选地输出「完整 job 模板」（含 image/cache/needs）而非仅 `script` 片段？超出当前 handoff 定位，倾向不做。
  3. 是否支持 Azure Pipelines / Jenkins？列入观望，不进本 Phase 范围。

### 候选 C：历史导出用于交接（History export for handoff）

- **用户价值**：把一次发布运行变成可分享的交接包（命令 + 结果 + 失败分组），让接手者不用重跑就能复现现场。
- **现有积木**：
  - `src-tauri/src/commands/export/mod.rs`：`export_execution_snapshot()`、`export_failure_group_bundle()`、`export_execution_history()`、`export_diagnostics_index()` 均已存在。
  - `src-tauri/src/commands/export/writers/`：`csv.rs`、`markdown.rs`、`html.rs` 三种 writer 已实现。
- **量级**：S（单条命令已可导出；缺的是「单次运行 -> 一个可分享交接包」的一键流——把 snapshot + failure-group bundle + 命令片段打包成单一产物）。
- **开放问题**：
  1. 交接包格式：单 markdown（嵌入多段）还是多文件 + index？倾向后者（复用 `export_diagnostics_index()`）。
  2. 交接包是否包含机器/路径信息？默认应复用 `sanitize_for_export()` 的脱敏策略，避免泄露本地路径。
  3. 是否需要签名/校验和以证明未篡改？本 Phase 不做。

## 明确不做（Out of Scope）

以下能力**违背 local-first 哲学**或**超出 Phase 11 桥梁定位**，本 Phase 明确不做：

- **账号系统 / 登录**：无账号体系，所有功能对本地用户开放。
- **服务端 / 云同步**：配置包通过文件交换（导出/导入），不走云存储。
- **实时协作 / 多人同时编辑**：不引入 CRDT、不做在线状态。
- **权限 / 审计日志**：不做 RBAC，不做发布审批流。
- **中央配置仓库 / 注册中心**：配置包是点对点文件交换，不建立中心化目录服务。
- **跨工具集成市场**：不做插件系统对接 Jira/Slack 等（与 `docs/design-philosophy.md` 的 Non-Goals 一致：不搞大插件系统）。

## 完成判定（Done Criteria）

每个候选能力独立的「什么证据算 Done」：

### 候选 A 的 Done

- 导出文件能在另一台机器一键导入，不报错。
- 同名 profile 冲突时，UI 给出明确的三选一（覆盖/跳过/重命名）而非静默失败或抛 raw error。
- 导入产物可立即用于一次 dry-run 发布（参数完整、无残留本地路径）。
- 至少一条 e2e 覆盖「导出 -> 在新环境导入 -> 跑通 preflight」。

### 候选 B 的 Done

- `HandoffSnippetFormat` 至少新增 `gitlab-ci`，且产出的 `.gitlab-ci.yml` 片段可直接粘贴运行。
- handoff snippet 的 e2e 覆盖至少 2 个 provider × 2 个格式。
- 命令行解析保持与现有 `resolveCommand()` 一致，无回归。

### 候选 C 的 Done

- 一次本地运行后，能产出「单一交接包」产物（包含命令、snapshot、失败分组），可被另一人离线查看。
- 交接包不包含未脱敏的本地绝对路径（复核 `sanitize_export_value` 与 `sanitize_for_export` 覆盖一致）。
- 至少一条 e2e 覆盖「失败运行 -> 导出交接包 -> 内容包含失败分组」。

### 整个 Phase 11 的 Done

- 本文档落地（已完成）。
- README Phase 11 行链接到本文档（已完成）。
- 至少一个候选能力达到上述 Done 判定，且不引入任何「明确不做」项。
- 全部候选能力 Done 后，README Phase 11 状态由 🚧 In Progress 升级为 ✅ Done。

## 状态建议

本文档落地后：

- README `#roadmap` 表格 Phase 11 行链接到本文档。
- Phase 11 维持 🚧 In Progress，直至候选 A/B/C 中**至少一个**达到其 Done 判定。
- 若 maintainer 决定本 Phase 不再推进，则降级为 Planned（删除 🚧，改为 ⏳ Planned）。
