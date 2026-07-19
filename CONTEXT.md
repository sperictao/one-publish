# One Publish

One Publish 统一描述从项目准备到可分发版本交付的发布过程，避免混淆本地构建、远端自动化与最终版本。

## Language

**GitHub 发布（GitHub Release）**:
一次面向使用者的版本交付，包含版本信息以及可下载、可验证的 Tauri 应用产物。
_Avoid_: 本地发布、构建

**GitHub 仓库身份（GitHub Repository Identity）**:
从 `github.com` 的 HTTPS 或 SSH origin 解析出的 owner 与 repository；当前不包含 GitHub Enterprise Server。
_Avoid_: 本地路径、任意 Git remote

**私有仓库发布（Private Repository Release）**:
可见范围继承私有仓库权限的普通 GitHub Release；当前不能启用需要客户端下载认证的 Tauri Updater。
_Avoid_: 公开下载、私有 Updater

**托管发布流程（Managed Release Workflow）**:
由 One Publish 创建并持续维护的目标仓库发布自动化，其约定由 One Publish 负责演进，而不是由每个仓库独立定义。
_Avoid_: 自定义发布流程、仓库自带流程

**托管流程漂移（Managed Workflow Drift）**:
目标仓库中的托管发布流程与 One Publish 认可的版本不一致，必须在继续发布前明确协调。
_Avoid_: 自定义修改、自动合并

**发布流程接管（Release Workflow Takeover）**:
发布接入期间以托管发布流程替换会争用同一版本标签或 GitHub Release 的旧流程；必须展示完整差异并经使用者明确确认。
_Avoid_: 并行发布流程、静默删除

**发布接入（Release Onboarding）**:
让目标仓库具备受 One Publish 托管的发布能力，包含首次建立和后续升级；它本身不交付新版本。
_Avoid_: 发版、发布执行

**接入提交（Onboarding Commit）**:
经使用者确认后，将托管 workflow 的新增、升级或冲突流程替换作为一个提交直接推送到远端默认分支；推送失败时接入仍未完成。
_Avoid_: 发布提交、自动 PR

**发布执行（Release Run）**:
在托管发布流程就绪后交付一个新版本的过程；执行期间不得创建或升级托管发布流程。
_Avoid_: 发布接入、流程升级

**发布门禁（Release Gate）**:
在版本变更应用后、发布提交与标签创建前按顺序执行的本地验证；任何失败都会阻止建立远端版本身份。
_Avoid_: Workflow job、可忽略检查

**发布提交白名单（Release Commit Allowlist）**:
发布提交允许包含的文件集合，只包括权威版本来源、已确认的版本镜像和本次发布说明。
_Avoid_: 全部工作区变化、自动暂存

**发布版本（Release Version）**:
由版本文件、发布提交、版本标签和最终产物共同指向的同一次版本交付；这些组成部分不得分别代表不同源码状态。
_Avoid_: 构建号、任意标签

**发布目标（Release Target）**:
一次发布执行所选择的交付去向，当前分为本地构建和 GitHub 发布。
_Avoid_: Provider、构建参数

**本地构建（Local Build）**:
在当前电脑上生成当前操作系统可安装产物的发布目标；它不改变版本历史，也不创建任何 GitHub 状态。
_Avoid_: GitHub 发布、本地 Release

**本地交付目录（Local Delivery Directory）**:
本地构建成功后用于复制最终安装包的唯一运行目录，按应用、版本、平台架构和时间区分，不替代或清理 Tauri 原生构建目录。
_Avoid_: Cargo target、Tauri bundle 缓存

**桌面发布矩阵（Desktop Release Matrix）**:
GitHub 发布所覆盖的 Tauri 2 桌面目标集合，包括 Windows x64、Linux x64，以及 macOS Intel、Apple Silicon 和 Universal；不包含 iOS 或 Android。
_Avoid_: 移动端发布、当前电脑平台

**启用平台集合（Enabled Platform Set）**:
单个仓库从桌面发布矩阵中选择、每次 GitHub 发布都必须完整成功的目标子集；其变化属于发布接入，不属于单次发版参数。
_Avoid_: 临时跳过平台、失败后降级

**本地发布配置（Local Release Configuration）**:
由 One Publish 本地状态独占保存的目标仓库发布设置，是生成托管发布流程的唯一配置来源，不随目标仓库共享。
_Avoid_: 仓库发布配置、workflow 配置

**发布配置备份（Release Configuration Backup）**:
用于迁移或恢复本地发布配置的显式导出文件，不是运行时配置来源，也不包含令牌、私钥或密码。
_Avoid_: 仓库配置、凭据备份

**发布凭据引用（Release Credential Reference）**:
本地发布配置中对外部 GitHub 或签名凭据的非秘密标识；它可以证明需要哪项凭据，但不能用于还原凭据值。
_Avoid_: Token、私钥、密码

**Tauri Provider**:
识别并构建完整 Tauri 桌面应用的发布能力，包含前端与原生应用打包；它不同于只编译 Rust 项目的 Cargo Provider。
_Avoid_: Cargo Provider、Rust 构建

**Tauri 应用绑定（Tauri App Binding）**:
一个仓库在 One Publish 中选定的唯一 Tauri 应用根目录与配置；发现多个应用时必须明确选择，当前不支持联合发版。
_Avoid_: 仓库根目录、monorepo 联合发布

**分发就绪（Distribution Ready）**:
产物已满足所选发布目标声明的签名与完整性要求，可以按该目标对外提供；构建成功不自动代表分发就绪。
_Avoid_: 构建成功、文件已生成

**平台代码签名（Platform Code Signing）**:
由 Windows 或 macOS 平台信任链验证的应用或安装包签名，用于确认发布者身份和产物完整性。
_Avoid_: Updater 签名、Detached 产物签名

**Updater 签名（Updater Signing）**:
由 Tauri Updater 在安装更新前验证的更新包签名，与操作系统是否信任应用发布者无关。
_Avoid_: 平台代码签名、Detached 产物签名

**Updater 发布（Updater-enabled Release）**:
明确启用 Tauri Updater 的 GitHub 发布，需要生成更新 manifest、收集对应更新包并通过 Updater 签名验证；普通 GitHub 发布不自动具备这些要求。
_Avoid_: 普通 GitHub 发布、自动更新检查

**Detached 产物签名（Detached Artifact Signature）**:
与产物分开存放的通用校验签名，例如 GPG detached signature；它不能替代平台代码签名或 Updater 签名。
_Avoid_: 平台代码签名、Updater 签名

**未签名发布授权（Unsigned Release Override）**:
针对单个仓库明确允许 GitHub 发布缺少平台代码签名产物的风险确认；它不等于分发就绪，也不能免除已启用 Updater 的签名要求。
_Avoid_: 自动降级、签名完成

**Tauri 构建驱动（Tauri Build Driver）**:
发布接入阶段为目标仓库确定的唯一 Tauri CLI 调用方式，可以来自 pnpm、npm、Yarn、Bun 或 Cargo；发布执行期间不得自动切换。
_Avoid_: 猜测命令、运行时 fallback

**权威版本来源（Authoritative Version Source）**:
按照 Tauri 自身解析规则决定应用当前版本的唯一字段或被引用文件，是发布版本读取与更新的起点。
_Avoid_: 最新标签、任意 package version

**版本镜像（Version Mirror）**:
经发布接入确认、必须与权威版本来源保持一致的其他版本字段；它不能独立决定发布版本。
_Avoid_: 第二版本来源、手工副本

**稳定发布（Stable Release）**:
使用严格 `major.minor.patch` 版本并进入稳定更新通道的发布版本；当前不包含预发布标识或构建元数据。
_Avoid_: Prerelease、Beta、Nightly

**发布说明（Release Notes）**:
描述某个发布版本相对上一稳定版本变化的可编辑 Markdown 文档，是 GitHub Release 正文与 Updater 更新说明的共同来源。
_Avoid_: 自动生成摘要、GitHub 独立正文

**工作区构建（Workspace Build）**:
包含未提交修改的本地构建，必须标记为不可复现并记录对应 HEAD、构建时间和 dirty 状态，但不保存或改变未提交 diff。
_Avoid_: 稳定发布、可复现构建

**不可变版本标签（Immutable Release Tag）**:
已推送到远端并绑定发布提交的版本标签，不得删除、移动或复用于其他源码状态。
_Avoid_: 可重写标签、可复用版本

**版本标签前缀（Release Tag Prefix）**:
发布接入时为仓库选择的简单字符串，与稳定版本拼成最终版本标签；默认是 `v`，不包含任意模板逻辑。
_Avoid_: Tag 模板、临时前缀

**发布尝试（Release Attempt）**:
一次可跨应用重启持续追踪的 GitHub 发布过程，记录版本、源码身份、远端阶段和最终结果；失败的尝试仍保留原身份以供安全重试。
_Avoid_: 本地执行记录、临时进度

**发布取消（Release Cancellation）**:
终止发布尝试的请求；远端版本身份建立前可以撤销 One Publish 产生的本地变更，建立后只能停止 workflow 或监控，不能撤销 commit 或 tag。
_Avoid_: 发布回滚、删除版本

**已发布稳定版本（Published Stable Release）**:
所有启用平台及发布策略验证通过后进入 Published 状态的非 Draft GitHub Release；其可见范围继承仓库可见性，失败尝试不得留下部分版本。
_Avoid_: Draft、部分发布

**Release 附件（Release Asset）**:
经发布接入明确允许出现在 GitHub Release 下载列表中的最终产物；只有白名单内的文件可以上传。
_Avoid_: Workflow Artifact、构建目录

**Updater 暂存产物（Updater Staging Asset）**:
仅用于生成或验证 Updater manifest 的中间产物，不因参与更新流程而自动成为 Release 附件。
_Avoid_: Release 附件、用户下载包

**Release 组装任务（Release Assembly Job）**:
在全部启用平台构建成功后统一校验、筛选并发布 GitHub Release 的唯一 workflow job；平台构建任务不能分别创建或修改 Release。
_Avoid_: 平台发布任务、并发 Release 更新

**固定 Action（Pinned Action）**:
托管 workflow 中通过完整 commit SHA 引用的 GitHub Action，其可读版本仅作为注释，升级必须经过发布接入。
_Avoid_: 浮动主版本、main、stable
