# One Publish

One Publish 统一描述从项目准备到可分发版本交付的发布过程，避免混淆本地构建、远端自动化与最终版本。

## Language

**产物集合（Artifact Set）**:
同一次构建产生、可共同验证和交付的一组不可变文件及其版本、平台、用途、摘要和签名信息，是构建与分发之间的交接对象。
_Avoid_: 构建目录、任意文件列表

**产物清单（Artifact Manifest）**:
定义产物集合身份的版本化清单，记录每个产物的逻辑角色、平台、架构、媒体类型、大小、内容摘要和可读取位置；清单或内容变化都会形成新的产物集合。
_Avoid_: 文件名约定、构建目录扫描结果

**产物存储（Artifact Store）**:
在构建与最终交付之间按内容摘要保存和读取产物集合的中间存储，具有明确保留期限；它不是面向使用者的交付目标。
_Avoid_: 下载站点、Release 附件、构建目录

**无法续传（Unresumable Delivery）**:
失败或未结束的交付因原产物已从产物存储失效而不能继续使用同一产物集合的状态；重新构建必须形成新的发布尝试。
_Avoid_: 自动重建、复用旧交付凭证

**产物处理器（Artifact Processor）**:
在构建与交付之间转换或验证产物集合的可组合能力，例如签名、公证、校验和、SBOM、证明或框架更新元数据；它不能直接交付产物。
_Avoid_: Provider 内嵌后处理、交付目标上传逻辑

**自定义命令处理器（Custom Command Processor）**:
以结构化程序、参数、运行阶段和声明输入输出补充项目特有步骤的受控处理器；它不能使用任意 shell 或绕开核心发布合同。
_Avoid_: 隐藏脚本、完整自定义 workflow

**产物分发（Artifact Distribution）**:
将已验证的产物集合交付到一个或多个可下载、可发现的目的地，并记录交付结果；它不改变目标环境中的运行状态。
_Avoid_: 运行部署、服务器运维

**执行后端（Execution Backend）**:
负责编排并追踪一次完整发布计划的运行环境，例如本机执行或 GitHub Actions；单次发布只属于一个后端，但后端内部可以调度不同平台或网络位置的 Runner。
_Avoid_: Provider、交付目标、单个 Runner

**发布能力（Publishing Capability）**:
Project Provider、Artifact Processor、Execution Backend、Artifact Store 和 Delivery Destination 对构建要求、产物类型、运行条件、保存与交付语义的标准化声明，用于组合发布计划而不让参与方直接识别彼此。
_Avoid_: Provider 特例、目标名称判断

**能力协商（Capability Negotiation）**:
发布计划生成前对各参与方能力和约束进行匹配的过程；不兼容必须返回具体缺失能力，而不是运行后降级或切换实现。
_Avoid_: 隐式 fallback、组合硬编码

**产物推广（Artifact Promotion）**:
以已有且摘要已验证的产物集合创建新的发布尝试，将其交付到其他路线或渠道而不重新构建。
_Avoid_: 跨后端接力、重新构建同一版本

**运行部署（Runtime Deployment）**:
改变运行环境的应用状态，包括迁移、安装、重启、流量切换和健康检查；它不属于 One Publish 的发布领域。
_Avoid_: 产物分发、远程文件上传

**GitHub 发布（GitHub Release）**:
GitHub Release Delivery Destination 面向使用者建立的版本交付，包含版本信息以及从 Artifact Manifest 选出的可下载、可验证产物；Tauri 安装包只是其中一种 Artifact Role。
_Avoid_: 本地发布、构建

**GitHub 仓库身份（GitHub Repository Identity）**:
从 `github.com` 的 HTTPS 或 SSH origin 解析出的 owner 与 repository；当前不包含 GitHub Enterprise Server。
_Avoid_: 本地路径、任意 Git remote

**私有仓库发布（Private Repository Release）**:
可见范围继承私有仓库权限的普通 GitHub Release；当前不能启用需要客户端下载认证的 Tauri Updater。
_Avoid_: 公开下载、私有 Updater

**托管发布流程（Managed Release Workflow）**:
由执行后端根据一个或多个自动化绑定生成并持续维护的仓库自动化，其约定由 One Publish 负责演进，而不是由每个仓库独立定义。
_Avoid_: 自定义发布流程、仓库自带流程

**托管流程漂移（Managed Workflow Drift）**:
目标仓库中的托管发布流程与自动化绑定不一致；它作为绑定配置的阻断状态显示，必须通过更新绑定明确协调后才能继续自动发布。
_Avoid_: 自定义修改、自动合并

**发布流程接管（Release Workflow Takeover）**:
发布接入期间以托管发布流程替换会争用同一版本标签或 GitHub Release 的旧流程；必须展示完整差异并经使用者明确确认。
_Avoid_: 并行发布流程、静默删除

**解除发布托管（Release Workflow Detachment）**:
经差异预览和明确确认后移除自动化绑定及其生成内容；单独执行时保留配置，由删除配置触发时则只在解除成功后继续删除。两种情况都保留既有提交、版本身份、发布尝试和交付凭证。
_Avoid_: 删除配置、发布回滚、清理历史版本

**发布接入（Release Onboarding）**:
让目标仓库具备受 One Publish 托管的发布能力，包含首次建立和后续升级；它本身不交付新版本。
_Avoid_: 发版、发布执行

**接入提交（Onboarding Commit）**:
经使用者确认后，将 Automation Projection Bundle 的新增、升级或冲突资源替换作为一个提交直接推送到远端默认分支；推送失败时接入仍未完成。
_Avoid_: 发布提交、自动 PR

**发布执行（Release Run）**:
按手动选择的配置或已安装的自动化绑定交付一个版本的过程；执行使用固定配置修订，期间不得创建或升级托管发布流程。
_Avoid_: 发布接入、流程升级

**发布门禁（Release Gate）**:
Publish Plan 中位于不可逆源码或交付副作用前的结构化验证节点；任何失败都会阻止后续节点。Tauri 版本提交策略在应用版本变更后、创建提交与标签前执行其本地门禁。
_Avoid_: Workflow job、可忽略检查

**发布提交白名单（Release Commit Allowlist）**:
发布提交允许包含的文件集合，只包括权威版本来源、已确认的版本镜像和本次发布说明。
_Avoid_: 全部工作区变化、自动暂存

**发布版本（Release Version）**:
单次发布执行使用的目标版本值，由 Provider 负责读写并由发布策略与交付路线共同验证；它不属于可复用发布配置，也不限定为稳定 SemVer。
_Avoid_: 发布配置版本、通用固定格式

**发布身份（Release Identity）**:
唯一描述一次版本交付的项目候选稳定身份、源码修订、Provider 解析的发布版本、渠道和可选构建序号组合；本地配置 ID 与 Adapter 实现版本都不属于发布身份。交付凭证引用发布身份与产物清单摘要，兼容的产物推广可以让新发布身份复用同一清单。
_Avoid_: 单独的 tag、文件名版本

**源码身份策略（Source Identity Strategy）**:
发布策略中决定版本交付如何关联显式 Source Snapshot 的规则，可以使用既有 tag、创建版本提交与 tag、以固定 commit 生成渠道构建、以 workspace snapshot digest 标识 dirty 本地构建，或直接推广既有产物集合。
_Avoid_: 每次发布强制提交、由交付目标创建 tag

**发布渠道（Release Channel）**:
面向不同稳定性、受众或推广阶段的版本序列，例如 stable、prerelease、nightly 或仓库自定义渠道。
_Avoid_: 交付目标、运行环境

**发布命名空间（Release Namespace）**:
自动化绑定可能产生的发布身份范围与其交付路线将写入的目标范围组合；两个绑定只有可能在同一目标产生同一身份时才构成冲突。
_Avoid_: workflow 文件名、Provider 类型互斥

**发布资源租约（Publish Resource Lease）**:
发布尝试在执行前取得、用于独占真实共享资源的限时所有权，例如仓库写入、发布命名空间或产物身份；互不竞争资源的尝试可以并行。
_Avoid_: 仓库全局锁、无租约并发

**交付目标（Delivery Destination）**:
接收产物集合并提供下载、发现或审核能力的一类外部目的地，例如本地目录、GitHub Release、远程文件服务器、对象存储、包仓库或应用商店。
_Avoid_: Provider、执行环境、运行部署

**交付路线（Delivery Route）**:
发布配置中面向某个交付目标的一份命名设置；一次发布可以包含多条有序路线，它们必须消费同一产物集合而不能分别重建。
_Avoid_: 唯一发布目标、重复构建任务

**必需交付路线（Required Delivery Route）**:
决定一次发布能否完整成功的交付路线；任一必需路线失败都会使发布进入失败或部分交付状态。
_Avoid_: 最佳努力上传、可忽略镜像

**可选交付路线（Optional Delivery Route）**:
失败时只产生警告、不否定整体发布成功的附加路线，常用于镜像或辅助下载位置。
_Avoid_: 必需目标、静默失败

**部分交付（Partial Delivery）**:
同一产物集合已经在至少一条路线成功交付，但仍有必需路线失败的发布状态；重试只继续失败路线，不得重新构建或撤销成功的不可变交付。
_Avoid_: 完整成功、全部失败、自动回滚

**交付凭证（Delivery Receipt）**:
单条交付路线使用稳定 Receipt ID 关联的一组不可变修订，包含目标身份、产物摘要、外部引用、观察状态和幂等身份；每份修订由 Publish Event 引用，当前状态只通过事件 reducer 归约得到，用于验证与安全续传。
_Avoid_: 临时日志、全局成功标记

**交付封装（Delivery Envelope）**:
交付目标从封存后的 Artifact Manifest、单次发布输入和路线设置生成的目标原生元数据，例如目标路径、Release 正文、下载 URL 索引或应用商店提交表单；它只属于该路线，不能修改共享产物或成为全局配置。
_Avoid_: Artifact Manifest、共享构建产物、远端配置来源

**交付幂等身份（Delivery Idempotency Identity）**:
由发布尝试、计划节点、发布身份、产物清单摘要和交付路线共同确定的外部副作用身份；目标状态必须可探测且摘要一致才能安全复用。
_Avoid_: 重复执行命令、按文件名覆盖

**发布事件（Publish Event）**:
Runner 输出的版本化、可追加且可去重状态事实，包含 Attempt、Plan Node、后端运行身份、稳定事件身份和因果序号；控制面通过确定性 reducer 重建状态，不用 last-write-wins 覆盖远端历史。
_Avoid_: UI 临时状态、可变进度行、秘密值

**发布失败分类（Publish Failure Classification）**:
Adapter 对失败原因、原始错误码、是否可安全重试和可选 retry-after 的结构化描述；只有明确的瞬时或限流失败在幂等条件满足时允许自动重试。
_Avoid_: 错误字符串匹配、Unknown 自动重试、静默 fallback

**交付生命周期（Delivery Lifecycle）**:
将目标原始状态映射为 Pending、Staged、Submitted、Published 及失败终态的通用进程；目标可以跳过不支持的中间阶段，但只有 Published 满足必需路线。
_Avoid_: 上传完成即发布成功、隐藏外部状态

**发布计划（Publish Plan）**:
由一次手动选择或自动化绑定的固定配置修订组合出的版本化、结构化发布步骤图，描述检查、构建、验证、交付和观察及其产物依赖、副作用与不可逆边界；本机和自动化后端执行同一语义合同。
_Avoid_: 单条发布命令、任意脚本、Provider 专用工作流

**计划输入快照（Planning Input Snapshot）**:
生成确定性发布计划所需的配置修订、运行时版本、发布输入、源码身份和带有效期外部检查集合；相同快照必须产生相同计划摘要。
_Avoid_: 隐式当前时间、未声明环境状态、执行时静默重规划

**本地构建（Local Build）**:
由本机执行后端运行构建阶段并生成产物集合的方式；产物随后可以交付到本地目录或任意兼容路线，本机构建本身不等于交付。
_Avoid_: 本地交付目标、GitHub Release

**本地交付目录（Local Delivery Directory）**:
本地目录 Delivery Destination 为所选最终产物建立的不冲突运行目录，通常按项目、版本、平台架构和 Attempt 区分；它不替代或清理 Provider 原生构建目录。
_Avoid_: 构建缓存、Provider 原生输出目录

**桌面发布矩阵（Desktop Release Matrix）**:
GitHub 发布所覆盖的 Tauri 2 桌面目标集合，包括 Windows x64、Linux x64，以及 macOS Intel、Apple Silicon 和 Universal；不包含 iOS 或 Android。
_Avoid_: 移动端发布、当前电脑平台

**启用平台集合（Enabled Platform Set）**:
单个仓库从桌面发布矩阵中选择、每次 GitHub 发布都必须完整成功的目标子集；其变化属于发布接入，不属于单次发版参数。
_Avoid_: 临时跳过平台、失败后降级

**本地发布配置（Local Release Configuration）**:
由 One Publish 本地状态保存并作为唯一可编辑权威来源的命名发布配置；远端自动化只能持有其不可反向编辑的运行投影。
_Avoid_: Provider 专用配置列表、workflow 作为配置、远端第二权威来源

**发布配置身份（Release Configuration Identity）**:
由不可变标识和仓库内唯一的可修改名称共同描述的一份可编辑发布配置；所有 Provider 共用这条身份规则，重命名不改变其选择状态、收藏、最近使用或历史归属。
_Avoid_: 以名称作为唯一标识、重命名后新建配置

**发布配置修订（Publish Configuration Revision）**:
一次已保存且不可变的发布配置内容版本；手动执行使用所选修订，自动化绑定继续引用既有修订，直到经差异确认后显式升级。
_Avoid_: 原地改写配置、自动跟随最新值

**当前发布配置（Current Release Configuration）**:
使用者在单个仓库中为查看和手动执行而选中的唯一发布配置；选择变化不创建、更新或删除远端自动化。
_Avoid_: 生效配置、自动化开关

**自动化绑定（Automation Binding）**:
将发布配置的固定修订及其 Execution Backend、触发策略、运行时修订和后端外部身份安装为托管自动化的显式关系；它不能覆盖配置修订中的 Adapter 选择或设置，同一仓库可以同时存在多份不冲突的绑定。
_Avoid_: 当前选择、隐式激活

**自动化投影（Automation Projection）**:
由自动化绑定生成、供远端后端自治运行的只读配置与计划投影；它按公开设置、受保护变量和秘密引用分层保存，不能反向成为可编辑发布配置。
_Avoid_: 配置备份、远端权威配置

**自动化投影包（Automation Projection Bundle）**:
执行后端根据仓库中全部自动化绑定生成并拥有的一组运行文件与后端配置；文件拆分属于后端实现，变更只能触碰包内明确拥有的资源。
_Avoid_: 配置直接拥有 workflow、扫描删除仓库自动化

**发布控制面（Publish Control Plane）**:
由 One Publish 提供的配置、计划、自动化安装和观察能力；控制面离线不应阻止已安装的远端自动化按固定配置修订运行。
_Avoid_: 远端 Runner、自动化运行时依赖

**发布 Runner（Publish Runner）**:
在本机或远端执行后端中解释 Publish Plan、运行内置 Adapter 并输出标准事件、产物清单和交付凭证的统一运行核心。
_Avoid_: Provider 专用脚本、完整计划展开为 CI 配置

**自动化运行时修订（Automation Runtime Revision）**:
自动化绑定固定使用的 Runner、Publish Plan 合同和 Adapter 版本及内容摘要组合；升级必须经差异预览显式完成。
_Avoid_: latest、浮动 Action 标签、隐式运行时升级

**发布配置模块（Publish Configuration Module）**:
统一承载所有 Provider 的发布配置、不可变修订、自动化绑定及健康状态的产品模块；配置选择只影响查看和手动执行，远端自动化必须显式管理。
_Avoid_: Tauri 发布中心、独立发布入口

**发布配置备份（Release Configuration Backup）**:
由通用发布配置管理显式导出、用于迁移或恢复本地发布配置的文件，不是运行时配置来源，也不包含身份、当前选择、令牌、私钥或密码；配置导入后获得新身份并保持未选中。
_Avoid_: Tauri 专用备份、仓库配置、凭据备份

**发布凭据引用（Release Credential Reference）**:
发布配置将 Adapter 的凭据要求绑定到执行后端可解析秘密的非秘密标识；引用可以说明需要和使用了哪项凭据，但不能用于还原凭据值。
_Avoid_: Token、私钥、密码、Adapter 内嵌凭据

**Tauri Provider**:
识别并构建完整 Tauri 桌面应用的发布能力，包含前端与原生应用打包；它不同于只编译 Rust 项目的 Cargo Provider。
_Avoid_: Cargo Provider、Rust 构建

**项目候选（Project Candidate）**:
在 Repository 中发现的可发布项目入口，包含稳定身份、项目根、匹配 Provider 和检测依据；一个 Repository 可以存在多个不同 Provider 的候选。
_Avoid_: Repository Provider、自动选定项目

**项目绑定（Project Binding）**:
发布配置对一个项目候选及其 Provider 的明确引用；Provider 属于该绑定而不是整个 Repository。
_Avoid_: 仓库级 Provider、扫描结果自动覆盖

**Tauri 应用绑定（Tauri App Binding）**:
项目绑定在 Tauri Provider 下选择的应用根目录与配置入口；发现多个应用时必须明确选择。
_Avoid_: 仓库根目录、Repository Provider

**分发就绪（Distribution Ready）**:
产物集合已满足发布策略、处理器和全部必需交付路线声明的签名与完整性要求；构建成功不自动代表分发就绪。
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
进入 stable 渠道并满足所选 Provider 与交付路线稳定版本约束的发布身份；稳定版本格式不由发布核心统一规定。
_Avoid_: Prerelease、Beta、Nightly

**发布说明（Release Notes）**:
单次发布执行输入的可编辑内容，描述目标版本相对所选基线的变化，并由兼容交付路线映射为 Release 正文、更新说明或商店描述；它不属于可复用发布配置。
_Avoid_: 自动生成摘要、每个目标独立维护正文

**工作区构建（Workspace Build）**:
包含未提交修改的本地构建，必须记录 Provider 声明输入的 workspace snapshot digest、对应 HEAD、构建时间和 dirty 状态，但不保存或改变未提交 diff；无法建立稳定快照时必须标记不可复现。
_Avoid_: 稳定发布、可复现构建

**不可变版本标签（Immutable Release Tag）**:
已推送到远端并绑定发布提交的版本标签，不得删除、移动或复用于其他源码状态。
_Avoid_: 可重写标签、可复用版本

**版本标签前缀（Release Tag Prefix）**:
发布接入时为仓库选择的简单字符串，与稳定版本拼成最终版本标签；默认是 `v`，不包含任意模板逻辑。
_Avoid_: Tag 模板、临时前缀

**发布尝试（Release Attempt）**:
一次可跨控制面重启持续追踪的发布过程，固定引用配置修订、计划语义、发布身份和执行后端；新构建的产物清单绑定开始为空并只能写入一次，产物推广则从开始固定既有清单。只有不改变这些身份的失败路线续传才属于同一尝试。
_Avoid_: 单次命令记录、修改后继续重试

**发布取消（Release Cancellation）**:
停止发布尝试中尚可取消工作的请求；它只能按执行后端、处理器和交付目标声明的能力清理暂存内容，不撤销已公开或已提交外部处理的交付。
_Avoid_: 跨目标回滚、删除已发布版本

**已完整交付稳定版本（Fully Delivered Stable Release）**:
stable 渠道的产物集合通过发布策略验证，且所有必需交付路线都进入 Published 的发布结果；可选路线失败只能形成警告。
_Avoid_: Draft、Submitted、部分交付

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
