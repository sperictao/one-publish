# Tauri 本地构建与 GitHub 发布设计

> 状态：Tauri Adapter 实施基线。跨 Provider、执行后端与交付目标的通用边界以[可扩展发布平台架构](./publish-platform-architecture.md)为准；两者冲突时，通用架构优先。

## 目标

为 One Publish 增加独立的 Tauri Provider，支持 Tauri 2 桌面项目在当前电脑生成安装包，或由 One Publish 接入并管理 GitHub Actions 多平台发布流程。本设计以本仓库为首个完整场景，但不把本仓库的专用脚本硬编码进 Provider。

## 范围

- 支持 Tauri 2 桌面应用：Windows x64、Linux x64、macOS Intel、Apple Silicon 和 Universal。
- 一份 Tauri 发布配置绑定一个明确的 Tauri 项目候选；同一仓库可以同时存在 Tauri、Cargo、Electron、Wails 等其他项目候选，检测到多个 Tauri 应用时必须选择。
- 支持 pnpm、npm、Yarn、Bun 和 `cargo tauri` 构建驱动。
- 支持公开与私有 `github.com` 仓库，不支持 GitHub Enterprise Server。
- 首版 Tauri GitHub 稳定发布策略只支持 `major.minor.patch`，不支持 prerelease、移动端和多应用联合发版；该限制不进入通用发布核心。

## 领域边界

Tauri 是独立 Project Provider，不能复用 Cargo Provider 的 `cargo build` 语义。它负责识别 Tauri 项目、解析构建驱动并贡献构建计划片段；本机与 GitHub Actions 是 Execution Backend，GitHub Release 与本地目录是 Delivery Destination，均不得塞进 Provider 参数。远端发布使用通用 Publish Attempt，不复用只描述已结束本地命令的 `ExecutionRecord`。

发布配置修订保存在 One Publish 本地状态，并作为唯一可编辑权威来源。目标仓库只保存 GitHub Actions Backend 生成并拥有的 Automation Projection Bundle，以及每次发布按源码身份策略产生的版本变更与 release notes，不提交额外 One Publish 配置文件，也不能从 workflow 反向恢复配置。配置可以显式导出和导入，但备份不包含身份、当前选择、自动化绑定或秘密。

## 本地构建

1. 解析绑定的 Tauri 应用、权威版本和唯一构建驱动。
2. 在当前操作系统运行原生 Tauri build，不改变版本文件、commit、tag 或 GitHub 状态。
3. 保留 Tauri 自己的 `target/.../bundle` 与缓存。
4. 将选定安装包复制到 `<应用>/<版本>/<平台架构>/<时间>` 独立交付目录，不覆盖旧构建。
5. 工作区 dirty 时允许构建，记录 Tauri Provider 声明输入的 workspace snapshot digest、HEAD、时间和 dirty 状态，但不保存 diff；无法建立稳定快照时结果标记为不可复现的工作区构建。
6. 缺少正式平台签名时允许生成产物，但必须标记未签名或临时签名，不能标记为分发就绪。

本机与 GitHub Actions 可以作为不同执行后端独立使用。只有 Publish Plan 明确包含本机构建门禁时，本机构建才是远端发布前置条件；同一 Attempt 的多条交付路线必须消费同一 Artifact Manifest，不能分别重建。

## 发布接入

自动化绑定的安装与更新负责首次生成和后续升级托管投影，发布执行不得顺带修改 workflow。

接入步骤：

1. 识别 Tauri 配置、应用根目录、构建驱动、权威版本来源和可选版本镜像。
2. 选择至少一个桌面目标、Release 附件白名单、Updater 状态、平台签名策略、tag 前缀、本地发布门禁和本地交付目录。
3. 解析 `github.com` 仓库身份、可见性、默认分支和现有认证。
4. 检查同样响应版本标签或创建 Release 的旧 workflow。本仓库现有 `build-release.yml` 属于冲突流程。
5. 生成 GitHub Actions Backend 拥有的完整 Automation Projection Bundle，展示新增、升级以及旧流程移除的完整 diff；首版 Bundle 包含独立托管 workflow。
6. 用户确认后创建一个接入 commit 并直接推送默认分支。权限或分支保护拒绝时保留接入未完成状态并原样显示 Git 错误；首版不创建 PR。

托管 workflow 是 Automation Projection Bundle 中的生成物。One Publish 根据固定配置修订渲染期望内容并检测漂移；任何缺失、人工修改或模板升级都会在发布配置区域形成阻断状态，必须通过更新自动化绑定展示 diff 并明确协调，不自动合并。

首次接管可以在同一完整 diff 中移除使用者逐项确认的冲突 workflow；接管完成后的更新与解除只能触碰 Bundle 明确拥有的资源，不能扫描清理其他仓库文件。

## 托管 workflow

- 只响应 `<tagPrefix><major.minor.patch>` 版本标签。
- 启用平台集合固化在生成内容中；单次发布不能临时跳过失败平台。
- 平台矩阵使用官方 `tauri-action` 构建并上传 workflow artifacts，但不让矩阵 job 创建或修改 GitHub Release。
- 所有 GitHub Actions 固定完整 commit SHA，并保留可读版本注释。
- 唯一 Release 组装任务在全部平台成功后下载产物、应用附件白名单、验证签名和 Updater 要求，以自动化 Draft 暂存上传，全部完成后才切换为 Published；失败重跑复用同一 Draft，不会暴露部分 Published Release。
- 任何前置 job 失败都不能留下 Draft 或部分 Published Release。
- 私有仓库可以创建普通 Release，但首版不能启用 Updater。

Updater 是可选能力。未启用时不生成 `latest.json`、不收集 Updater 包，也不要求 Updater 密钥；启用时 endpoint、公钥、Secret 引用和 Updater 签名全部是硬门禁。

## GitHub 发布事务

1. 确认当前分支是远端默认分支，工作区干净且与远端同步。
2. 按 Tauri 规则读取权威版本：优先 `tauri.conf.*` 的版本或引用文件，否则使用 `src-tauri/Cargo.toml`。
3. 验证所有版本镜像一致，输入严格稳定版本，并确认远端不存在同名 tag 或 Release。
4. 根据上一同前缀稳定 tag 到当前 HEAD 生成可编辑 release notes，保存为 `release-notes/<tag>.md`。
5. 应用权威版本和版本镜像变更，依次运行本地发布门禁。命令以 `program + args` 保存和执行，不接受任意 shell 字符串。
6. 门禁失败时恢复 One Publish 本次变更。门禁产生白名单外文件变化时停止并展示 diff，不自动提交、还原或删除。
7. 最终确认后创建只包含版本来源、版本镜像和 release notes 的发布 commit，并原子推送默认分支与版本 tag。
8. 发现 workflow run 后持久化 run ID 和 URL，持续跟踪所有 job，成功后记录 Release URL 与附件结果。

版本 tag 推送后不可删除、移动或复用。网络、Runner 或 Secret 问题通过同一 tag 重跑 workflow；需要修改源码时发布下一个 patch 版本。

## 发布尝试状态

远端发布使用独立持久模型，至少记录：

- 配置修订、计划摘要、Execution Backend 与 Automation Runtime Revision；
- repository identity、repository ID、Tauri 项目绑定和 Release Identity；
- version、tag、release commit SHA，以及在产物封存阶段只写一次的 Artifact Manifest 绑定；
- 当前阶段与终态；
- workflow run ID、Actions URL、Release URL；
- 各交付路线的 Delivery Receipt；
- 签名与 Updater 检查摘要；
- 创建、更新时间和可重试原因。

并发由 Publish Plan 声明的仓库写、Release Identity 与 Delivery Namespace 资源租约协调，不使用仓库全局互斥。资源不冲突的发布尝试可以并行；One Publish 重启后从已知阶段恢复轮询，不重复提交或推送。

取消以远端原子 push 为不可逆边界：push 前可以恢复 One Publish 生成的文件，但文件被用户再次修改时停止恢复；push 后只能请求取消 workflow 或停止监控，不能删除 commit/tag。

## 凭据与秘密

- Git push 使用系统 Git credential。
- GitHub API 使用现有 `gh auth` 或系统凭据。
- 远端签名材料只存在于 GitHub Actions Secrets。
- 本地签名材料在执行时从系统钥匙串或环境读取。
- One Publish 本地状态、导出文件、日志和执行历史只保存凭据引用或脱敏检查结果。
- One Publish 只检查 Actions Secret 名称并提供 GitHub Settings 或 `gh secret set` 指引，不提供秘密输入或上传能力。

平台代码签名、Tauri Updater 签名和 GPG detached signature 必须分别展示。缺少平台代码签名时，GitHub 发布只有在仓库显式授权“允许未签名发布”后才能继续，并持续显示风险；启用 Updater 时，Updater 签名不能被该授权绕过。

## 主要代码边界

现有 Tauri provider、workflow renderer、conflict/drift scanner、release transaction、GitHub monitor 和 attempt store 是迁移输入，不是最终模块边界。最终归属为通用 Project Provider、Publish Planner、Execution Backend、Delivery Destination、Publish Runtime 与持久化端口；具体映射见[可扩展发布平台架构](./publish-platform-architecture.md#15-当前-tauri-实现迁移映射)。Tauri commands 只暴露结构化请求与结果，共享合同继续从 Rust 生成 TypeScript。

前端在现有发布配置模块中增加 Tauri 项目绑定、执行后端和交付路线设置，不建立 Tauri 发布中心。中栏继续负责配置 CRUD、修订、自动化绑定和阻断状态；选中配置后，右侧展示 release inputs、Publish Plan、执行进度与结果。现有发布清单必须拆分三类签名，不能继续用 GPG 成功代表 Tauri 分发就绪。

## 实施顺序与验证

1. Tauri 项目检测与独立 Provider：覆盖 Tauri 与 Cargo 候选并存、多个配置候选、五种构建驱动冲突和本地 bundle 定位。
2. 通用发布配置修订与备份：覆盖迁移、无秘密导出、版本来源与镜像一致性。
3. GitHub Actions 投影包：使用 golden tests 验证平台矩阵、Action SHA、权限、冲突接管、漂移和私有仓库限制。
4. 本机构建、Artifact Manifest 与本地交付：覆盖 clean/dirty、签名状态、唯一目录和不覆盖旧构建。
5. GitHub Release 交付：覆盖门禁失败恢复、提交白名单、原子 push、tag 不可变和幂等重试。
6. 通用运行状态与恢复：覆盖跨重启恢复、资源租约、取消阶段和失败节点诊断。
7. 发布配置与右侧执行界面：覆盖自动化绑定、Publish Plan、风险确认、Updater/签名状态和交付结果。

验证顺序为定向 Rust/TypeScript 单元测试、合同漂移检查、typecheck、受影响前后端构建、workflow 静态测试、最小本地 Tauri smoke build，最后运行 `git diff --check`。远端端到端发布使用测试仓库验证，不能在本仓库真实创建 tag 或 Release 作为普通单元测试副作用。
