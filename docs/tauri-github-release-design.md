# Tauri 本地构建与 GitHub 发布设计

## 目标

为 One Publish 增加独立的 Tauri Provider，支持 Tauri 2 桌面项目在当前电脑生成安装包，或由 One Publish 接入并管理 GitHub Actions 多平台发布流程。本设计以本仓库为首个完整场景，但不把本仓库的专用脚本硬编码进 Provider。

## 范围

- 支持 Tauri 2 桌面应用：Windows x64、Linux x64、macOS Intel、Apple Silicon 和 Universal。
- 一个仓库绑定一个 Tauri 应用；检测到多个应用时必须选择。
- 支持 pnpm、npm、Yarn、Bun 和 `cargo tauri` 构建驱动。
- 支持公开与私有 `github.com` 仓库，不支持 GitHub Enterprise Server。
- 首版只支持 `major.minor.patch` 稳定版本，不支持 prerelease、移动端和多应用联合发版。

## 领域边界

Tauri 是独立 Provider，不能复用 Cargo Provider 的 `cargo build` 语义。Provider 负责识别 Tauri 项目、解析构建驱动和执行本地 Tauri bundle；GitHub 发布是独立的远端发布编排，不塞进普通 Provider 参数，也不复用只描述已结束本地命令的 `ExecutionRecord`。

所有仓库差异均保存在 One Publish 本地状态。目标仓库只保存生成后的 `.github/workflows/one-publish-tauri-release.yml` 和每次发布产生的版本变更与 release notes，不提交额外 One Publish 配置文件。配置可以显式导出和导入，但备份不包含秘密。

## 本地构建

1. 解析绑定的 Tauri 应用、权威版本和唯一构建驱动。
2. 在当前操作系统运行原生 Tauri build，不改变版本文件、commit、tag 或 GitHub 状态。
3. 保留 Tauri 自己的 `target/.../bundle` 与缓存。
4. 将选定安装包复制到 `<应用>/<版本>/<平台架构>/<时间>` 独立交付目录，不覆盖旧构建。
5. 工作区 dirty 时允许构建，但结果标记为不可复现的工作区构建，并记录 HEAD、时间和 dirty 状态，不保存 diff。
6. 缺少正式平台签名时允许生成产物，但必须标记未签名或临时签名，不能标记为分发就绪。

本地构建与 GitHub 发布互不依赖。只有用户把 Tauri build 明确加入发布门禁时，它才成为 GitHub 发布前置条件。

## 发布接入

发布接入负责首次生成和后续升级托管 workflow，发布执行不得顺带修改 workflow。

接入步骤：

1. 识别 Tauri 配置、应用根目录、构建驱动、权威版本来源和可选版本镜像。
2. 选择至少一个桌面目标、Release 附件白名单、Updater 状态、平台签名策略、tag 前缀、本地发布门禁和本地交付目录。
3. 解析 `github.com` 仓库身份、可见性、默认分支和现有认证。
4. 检查同样响应版本标签或创建 Release 的旧 workflow。本仓库现有 `build-release.yml` 属于冲突流程。
5. 生成独立托管 workflow，展示新增、升级以及旧流程移除的完整 diff。
6. 用户确认后创建一个接入 commit 并直接推送默认分支。权限或分支保护拒绝时保留接入未完成状态并原样显示 Git 错误；首版不创建 PR。

托管 workflow 是生成物。One Publish 根据本地配置渲染期望内容并检测漂移；任何缺失、人工修改或模板升级都会阻止 GitHub 发布，必须回到发布接入展示 diff 并明确覆盖，不自动合并。

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

- repository identity、repository ID 和 Tauri 应用绑定；
- version、tag、release commit SHA；
- 当前阶段与终态；
- workflow run ID、Actions URL、Release URL；
- 签名与 Updater 检查摘要；
- 创建、更新时间和可重试原因。

同一仓库同时只能有一个未结束的 GitHub 发布尝试，不同仓库可以并行。One Publish 重启后从已知阶段恢复轮询，不重复提交或推送。

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

后端建议新增独立的 Tauri provider、release workflow renderer、workflow conflict/drift scanner、release transaction、GitHub workflow monitor 和 release attempt store。Tauri commands 只暴露结构化请求与结果，共享合同继续从 Rust 生成 TypeScript。

前端在现有 Provider 选择中增加 Tauri，并把“本地构建”和“GitHub 发布”作为并列目标。GitHub 发布使用发布接入、预检与 release notes、最终确认、远端监控四个明确阶段；现有发布清单必须拆分三类签名，不能继续用 GPG 成功代表 Tauri 分发就绪。

## 实施顺序与验证

1. Tauri 项目检测与独立 Provider：覆盖 Tauri 优先于 Cargo、多个配置候选、五种构建驱动冲突和本地 bundle 定位。
2. 本地发布配置与备份：覆盖迁移、无秘密导出、版本来源与镜像一致性。
3. workflow 生成与接入：使用 golden tests 验证平台矩阵、Action SHA、权限、冲突接管、漂移和私有仓库限制。
4. 本地构建与交付：覆盖 clean/dirty、签名状态、唯一目录和不覆盖旧构建。
5. GitHub 发布事务：覆盖门禁失败恢复、提交白名单、原子 push、tag 不可变和幂等重试。
6. 远端监控与恢复：覆盖跨重启恢复、同仓库互斥、取消阶段和失败 job 诊断。
7. 前端流程与多语言：覆盖接入、两种发布目标、风险确认、Updater/签名状态和发布结果。

验证顺序为定向 Rust/TypeScript 单元测试、合同漂移检查、typecheck、受影响前后端构建、workflow 静态测试、最小本地 Tauri smoke build，最后运行 `git diff --check`。远端端到端发布使用测试仓库验证，不能在本仓库真实创建 tag 或 Release 作为普通单元测试副作用。
