# One Publish 可扩展发布平台架构

状态：Accepted（2026-07-20）

本架构取代“为每种项目类型建立一个独立发布中心”的方向。Tauri 是首个完整场景，但 Electron、Wails、.NET、Go、Java 以及未来的交付协议必须通过同一发布核心组合，而不是复制 Tauri 发布事务。

## 1. 架构结论

One Publish 是产物发布控制面，不是通用运维编排器。它负责项目识别、构建、产物处理、制品保存、分发、自动化安装和状态观察，不负责数据库迁移、进程重启、流量切换或服务健康管理。

发布由五类 Adapter 和一个通用计划核心组成：

```text
Project Provider
      ↓ build fragment
Artifact Processor(s)
      ↓ transformed and verified artifacts
Artifact Store
      ↓ content-addressed Artifact Manifest
Delivery Destination(s)
      ↓ Delivery Receipt(s)

Execution Backend + Publish Runner execute the complete Publish Plan.
```

一份发布配置包含一个项目绑定、一个执行后端、一个产物存储、一组有序处理器以及一条或多条交付路线。所有路线消费同一 Artifact Manifest，实现构建一次、分发多处。

## 2. 范围边界

One Publish 负责：

- 发现 Repository 中的一个或多个项目候选；
- 读取、验证或按策略更新项目版本；
- 在本机或远端后端执行确定性 Publish Plan；
- 收集、签名、验证并描述产物；
- 将产物保存到中间 Artifact Store；
- 向本地目录、GitHub Release、SFTP、对象存储、包仓库或应用商店交付；
- 安装、升级、检查和移除自动化绑定；
- 跨控制面重启观察、续传、取消和审计发布尝试。

One Publish 不负责：

- 数据库 schema 或数据迁移；
- 远程进程安装、启动、停止或重启；
- 服务发现、流量切换和渐进式部署；
- 运行时健康检查与自动回滚；
- 任意基础设施编排。

远程服务器在本上下文中只是产物交付目标。未来如需部署运行中的应用，应建立独立领域并消费 One Publish 的 Delivery Receipt。

## 3. 配置模型

发布配置继续使用现有发布配置模块的列表、分组、搜索、收藏、最近使用、新建、查看、更新和删除体验。所有可编辑配置拥有不可变 ID，名称只负责展示。

配置内容采用不可变修订：

```text
PublishConfigurationRevision
├── configuration identity and revision
├── project binding + Project Provider settings
├── release policy
│   ├── source identity strategy
│   ├── version and channel rules
│   ├── platform and architecture set
│   └── signing, approval and reproducibility rules
├── Execution Backend settings
├── Artifact Store settings
├── ordered Artifact Processor settings
├── ordered Delivery Routes
│   ├── destination adapter settings
│   ├── required or optional
│   └── artifact selectors
└── credential-reference bindings
```

目标版本、发布说明、Nightly 时间戳或构建序号属于单次发布输入，不写入可复用配置。

保存编辑会创建新修订。手动执行可以使用最新修订；已安装自动化继续引用旧修订，直到用户预览差异并显式升级绑定。

配置导出不包含 ID、当前选择、秘密值或自动化绑定。导入配置获得新 ID，并保持未选中和未绑定状态。

## 4. Adapter families

| Adapter              | 负责                                                                        | 不负责                          |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| Project Provider     | 项目发现、项目版本、构建要求、构建计划片段、原始产物角色                    | CI workflow、上传目标、运行历史 |
| Artifact Processor   | 签名、公证、校验和、SBOM、证明、框架更新元数据、产物验证                    | 项目发现、最终上传              |
| Execution Backend    | Runner 拓扑、自动化投影包、触发器、权限、变量与 Secret 映射、启动与观察运行 | Provider 特例、目标协议业务逻辑 |
| Artifact Store       | 按摘要保存与读取产物、保留期、完整性验证                                    | 面向用户发布、应用审核          |
| Delivery Destination | 目标命名空间、交付计划片段、幂等探测、状态观察、Delivery Receipt            | 构建、重新签名、源码修改        |

第一阶段全部是内置 Adapter，通过注册表发现。暂不加载第三方动态库；未来外部插件应使用隔离进程或 WASM，并继续满足同一合同与 conformance suite。

远程文件服务器是 UI 分类，不是单个 Adapter。SFTP、SMB、WebDAV、FTPS 和 HTTP Upload 分别实现，因为它们的认证、网络、续传、原子改名和覆盖语义不同。

## 5. 能力协商

Adapter 不能通过类型名识别彼此。每个 Adapter 声明标准化能力和约束：

- Provider 声明所需平台、工具链和可产出的 Artifact Role；
- Processor 声明接受与产生的 Artifact Role、平台要求和副作用；
- Backend 声明 Runner、网络、Secret、审批、自动化与 Artifact 能力；
- Store 声明摘要算法、容量、保留期、可达性和跨运行读取能力；
- Destination 声明接受的 Artifact Role、暂存、覆盖、异步审核、续传和幂等能力。

Publish Planner 只进行能力匹配，返回具体缺失能力。它不能在不兼容时静默换 Provider、跳过 Processor、减少平台或改用另一目标。

所有五类 Adapter 都可以声明 Credential Requirement。发布配置只把要求绑定到非秘密 Credential Reference；Execution Backend 负责从本机钥匙串、环境变量或远端 Secret Store 解析实际值。配置、导出、Publish Plan、Artifact Manifest、历史和日志都不能包含秘密值，计划预检只返回可用性与脱敏诊断。

## 6. Publish Plan

Publish Plan 是唯一运行合同，是版本化、结构化、可摘要的有向步骤图。固定阶段为：

1. Inspect source
2. Prepare release identity
3. Build
4. Collect artifacts
5. Process and verify artifacts
6. Persist Artifact Manifest
7. Stage delivery routes
8. Submit or publish routes
9. Observe asynchronous routes

计划节点声明：

- 类型化操作；需要启动进程时使用结构化 `program + args`；
- 输入与输出 Artifact Role；
- 凭据引用；
- 支持平台与 Runner 要求；
- 文件、网络和外部系统副作用；
- 资源租约；
- 幂等身份；
- 可取消能力与不可逆边界。

禁止在计划合同中使用任意 shell 字符串。受控自定义命令只能作为显式 Processor/Gate，声明阶段、工作目录、环境引用、输入输出和副作用。

相同 Planning Input Snapshot 必须生成相同 Plan 和摘要。外部检查带时间与有效期；执行前只重新验证，不静默重新规划。

源码输入必须是显式 Source Snapshot：clean 构建引用不可变 VCS revision，dirty 本机构建引用 Provider 声明输入的 workspace snapshot digest，并额外记录 HEAD、时间与 dirty 状态。One Publish 不保存 diff，但不能只用 HEAD 冒充 dirty 工作区的源码身份；无法建立稳定快照的构建必须标记不可复现且不得进入要求可复现性的路线。

Secret 内容既不进入 Source Snapshot，也不进入任何摘要；如 Secret Store 提供不可逆的版本身份，只记录该身份，否则依赖未版本化秘密的构建标记为环境依赖。Provider 声明输入时必须区分源码、生成内容、忽略内容和 Credential Requirement，不能通过扫描 `.env` 等文件绕过凭据模型。

## 7. Artifact Manifest 与存储

Collect 与 Processor 阶段构造 Manifest Candidate；Processor 可以通过声明的派生关系增加新产物，但不能修改已有产物字节。Persist 阶段验证所有摘要后一次性封存不可变 Artifact Manifest。每个条目至少记录：

- 逻辑角色；
- 平台与架构；
- 文件名、大小和媒体类型；
- 内容摘要；
- 签名或证明关系；
- Artifact Store 定位符；
- 保留期限。

安装包、Updater 包、更新 manifest、签名、校验和、SBOM 和证明都是明确 Artifact Role。Delivery Destination 只能消费 Manifest 中声明且摘要验证通过的条目。

Manifest 记录可验证的项目、源码、版本和构建 provenance，但交付渠道不构成产物内容身份。Artifact Promotion 可以为兼容的新 Release Identity 复用同一 Manifest；Planner 必须验证项目、源码、版本和目标策略兼容，Delivery Receipt 同时引用 Release Identity 与 Manifest 摘要。

失败路线重试和 Artifact Promotion 必须读取原 Artifact Manifest。原产物过期后 Attempt 进入 Unresumable，不允许静默重建并沿用旧凭证。

## 8. 多路线交付

每条 Delivery Route 有稳定 ID、顺序、目标命名空间、目标设置、Artifact Selector 和 Required/Optional 属性。

- 所有 Required 路线 Published：完整成功；
- 仅 Optional 路线失败：成功但带警告；
- 已有路线成功且 Required 路线失败：Partial Delivery；
- 重试只继续失败或未结束路线；
- 成功的不可变交付不自动删除。

通用交付生命周期为 Pending、Staged、Submitted、Published，以及 Failed、Rejected、Cancelled、Expired。Adapter 保留目标原始状态并映射到通用状态，只有 Published 满足 Required 路线。

每条路线生成稳定 Delivery Receipt ID；每次状态观察形成不可变 Receipt Revision，记录目标身份、Artifact Manifest 摘要、外部引用、状态与幂等身份，并由对应 Publish Event 引用。界面中的当前状态只通过事件 reducer 归约得到，不能原地覆盖已观察到的 Submitted、Published 或失败证据。

目标路径、HTTP header、GitHub Release 正文、Tauri `latest.json` 中的下载 URL、应用商店提交表单等依赖路线的信息属于 Delivery Envelope。Destination 可以在 Stage 阶段从已封存 Manifest、Release Input 和路线设置确定性生成 Envelope，但不能修改共享产物字节、伪造新 Manifest 或把路线专属信息反馈成全局配置。需要被多条路线共同分发的文件必须在封存前由 Processor 生成；只服务单条路线的 Envelope 由对应 Destination 拥有并记录在 Receipt 中。

## 9. 自动化控制面

当前选中配置只影响 UI 与手动执行，不改变远端状态。

Automation Binding 显式关联：

- 配置 ID 与固定修订；
- 触发策略；
- 该修订内固定的 Execution Backend；
- Automation Runtime Revision；
- 自动化投影摘要与后端外部身份。

Binding 不能覆盖配置修订中的 Adapter 选择或设置；改变 Backend、Store、Processor 或 Destination 必须保存新配置修订，再显式升级 Binding。

同一仓库可以安装多份无冲突绑定，例如 Stable tag、Nightly schedule 和手动 Beta。冲突通过“可能产生的 Release Identity × Delivery Namespace”判定，而不是按 Provider 或 workflow 文件名判断。

Execution Backend 根据该仓库全部绑定生成一个拥有明确资源清单的 Automation Projection Bundle。后端决定渲染一个或多个 workflow；更新和移除只能修改 Bundle 所拥有的资源。

首次接管是唯一例外：冲突扫描可以提出 Bundle 外的既有自动化资源，但只有使用者在完整 diff 中逐项确认后，接管提交才能移除这些明确目标。后续 reconciliation、升级与解除绑定不得扫描或修改未拥有资源。

本地配置修订是唯一可编辑权威来源。远端只保存不可反向编辑的投影：公开计划进入托管文件，敏感非秘密设置进入受保护变量，秘密只通过 Secret 引用解析。受保护变量层为时限性延后（决议 #87）：当前没有任何字段需要该层，待首个真实敏感非秘密字段出现时启用，届时由 Adapter Schema 声明字段级别。

控制面可以离线。已安装自动化依赖固定 Runner 与投影自治运行，下次打开 One Publish 时再同步事件、Artifact Manifest 和 Delivery Receipt。

删除仍有自动化绑定的配置时，必须先预览并成功应用解除绑定；失败则保留配置与绑定。解除操作只删除拥有的投影资源，不删除历史提交、Release Identity、Publish Attempt、Artifact Manifest 或 Delivery Receipt。

## 10. Shared Runner

GitHub Actions、GitLab CI、Jenkins 等 Backend 只生成薄外壳，负责触发器、Runner 拓扑、权限、Secret/Variable、审批和后端 Artifact 接入。

外壳运行固定版本与摘要的 One Publish Runner。Runner 解释 Publish Plan、加载内置 Adapter、输出标准事件、Artifact Manifest 和 Delivery Receipt。本机执行复用同一个 runner core。

Runner 输出可追加、可去重的版本化 Publish Event。每个事件包含 Attempt ID、Plan Node ID、后端运行身份、稳定 Event ID、因果序号和脱敏 payload；控制面通过确定性 reducer 重建状态，重复同步不产生重复副作用，事件缺口会触发显式补拉而不是 last-write-wins 覆盖。Artifact Manifest 与每个 Delivery Receipt Revision 作为事件引用的不可变记录单独校验。

Automation Runtime Revision 固定：

- Runner 版本和二进制摘要；
- Publish Plan 合同版本；
- Adapter 版本；
- 自动化投影摘要。

应用升级只报告运行时更新可用；绑定必须经差异预览显式升级，禁止 `latest` 或浮动 Action 标签。

## 11. Attempt、并发、重试与取消

Publish Attempt 身份固定引用：

- 配置修订；
- Planning Input Snapshot 与 Plan 摘要；
- Release Identity；
- Execution Backend 和 Runtime Revision。

Attempt 另外拥有一个只写一次的 Artifact Manifest 绑定和一条可追加、不可覆写的 Publish Event 流；不可变 Delivery Receipt Revision 作为事件引用的证据保存，不建立第二套可变状态。

新构建创建 Attempt 时 Manifest 绑定为空，在 Persist 阶段写入首个摘要后永久冻结；Artifact Promotion 创建 Attempt 时从开始即绑定既有 Manifest。只要这些身份未改变，失败路线续传仍属于原 Attempt。配置、版本、计划语义或产物内容变化必须创建新 Attempt。

并发使用资源租约，不按 Repository 全局互斥。计划可以申请仓库写租约、Release Namespace 租约、Artifact Manifest 租约或 Destination Namespace 租约；互不竞争的 Stable、Nightly、本地构建和 Promotion 可以并行。

外部副作用必须具有幂等身份并先探测目标。已存在且摘要一致时复用；摘要不一致时报告冲突。不支持幂等查询的目标声明为不可安全自动重试。

Adapter 失败使用版本化分类而不是依赖错误字符串：Transient、RateLimited、Authentication、Authorization、Validation、Conflict、Policy、Unsupported、ExternalRejected 和 Unknown，并保留 adapter 原始错误码。Runner 只有在分类允许、幂等探测可用且重试策略未耗尽时自动重试；其他失败进入阻断状态并展示具体修复动作。

取消只停止尚可取消的节点并按 Adapter 能力清理 owned staging。已 Published 或 Submitted 的交付不会被通用取消删除；Attempt 仍按交付路线聚合规则确定结果：必需路线未完成且已有成功路线时为 Partial Delivery，全部必需路线已 Published 而仅可选路线被取消时为成功但带警告，尚无交付且工作被取消时为 Cancelled。

## 12. 产品界面

中栏发布配置模块负责：

- 新建、查看、更新、删除、导入、导出；
- 配置修订；
- 自动化绑定安装、更新和移除；
- Schema/Adapter/凭据/能力/绑定/投影/运行时健康状态。

配置仍使用现有列表、分组、搜索、收藏、最近使用和三点菜单。不存在 Tauri、Electron 或 Wails 专属发布中心。

点击配置行只切换当前手动配置。右侧负责：

- 单次 Release Input；
- Publish Plan 预览；
- 手动执行、取消与续传；
- Attempt、Artifact Manifest 与 Delivery Receipt 展示。

简单本地计划可以突出主命令；复杂远端计划展示结构化阶段，不能伪装为单条可复制命令。

Adapter 设置使用版本化 Schema、默认值、校验和只读摘要，由通用编辑器组合。只有 Schema 无法表达的字段交互允许注册局部控件，Adapter 不能接管整个页面。

## 13. Deep modules

面向桌面控制面的主要 Module 保持小 interface：

```text
ProjectDiscovery.inspect(repository) -> ProjectCandidateSet
ConfigurationCatalog.createRevision / read / list
PublishPlanner.prepare(request) -> PreparedPublishPlan
AutomationManager.preview / apply / synchronize
PublishRuntime.start / resume / cancel / synchronize
```

Adapter Registry、capability matching、plan fragment composition、projection rendering、event reduction 和 persistence adapter 都隐藏在这些 Module 后面。测试与调用者通过同一 interface，不穿透内部实现。

## 14. Rust workspace 方向

```text
crates/
├── publish-domain       # versioned contracts and invariants, no I/O
├── publish-planner      # capability negotiation and deterministic plans
├── publish-runner-core  # execution, events, leases, retry and cancellation
├── publish-adapters     # built-in adapter registry and implementations
└── one-publish-runner   # standalone CLI

src-tauri/               # desktop control-plane shell and thin commands
src/                     # configuration and execution UI
```

内置 Adapter 先按 family 分模块，只有依赖、发布周期或隔离要求真正不同后再拆独立 crate。

## 15. 当前 Tauri 实现迁移映射

| 当前模块                                    | 迁移归属                                                          |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `provider/providers/tauri.rs`               | Tauri Project Provider                                            |
| `tauri_release/project.rs`、`versioning.rs` | Tauri Provider 的项目检查与版本能力                               |
| `tauri_release/local_build.rs`              | Local Backend + Tauri Provider fragment + Local Store/Destination |
| `tauri_release/workflow.rs`、`takeover.rs`  | GitHub Actions Backend projection bundle 与 reconciliation        |
| `tauri_release/github.rs`                   | GitHub Release Destination                                        |
| `tauri_release/preflight.rs`                | Publish Planner capability/precondition preparation               |
| `tauri_release/transaction.rs`              | Runner core、source identity policy 与 leases                     |
| `tauri_release/monitor.rs`                  | Backend synchronization + Destination observation                 |
| `tauri_release/storage.rs`                  | Configuration Catalog revisions + Attempt repository              |
| `TauriReleaseDialog.tsx`                    | 通用配置详情与右侧 Publish Plan/Attempt UI                        |

迁移采用替换而不是叠加：当通用 Module 接管一项行为时，删除对应 Tauri 专用入口与状态，不保留双写或兼容 facade。

## 16. 实施顺序

1. 引入通用 domain contracts、ConfigProfile ID/Revision 迁移和 Adapter descriptors。
2. 提取 deterministic planner、runner core、事件 reducer 与失败分类，用 fake adapters 建立 conformance suites。
3. 将现有 Tauri 本地构建映射为 Provider + Local Backend/Store/Destination。
4. 将 GitHub workflow、Release 和 monitor 拆为 GitHub Actions Backend 与 GitHub Release Destination，并把 `latest.json` 等路线元数据迁入 Delivery Envelope。
5. 将 Tauri 配置并入现有配置模块，删除独立 Tauri 发布中心与配置存储。
6. 引入 standalone runner 与固定 runtime revision，迁移 Automation Projection Bundle。
7. 用 Electron 或 Wails 验证第二个 Project Provider，用 SFTP 验证第二个 Delivery Destination。
8. 开启多路线、Partial Delivery、Artifact Promotion 和跨重启续传。

每一步都必须保持现有可验证行为，并在通用 interface 的测试覆盖建立后删除旧 Tauri 专用测试与实现。

## 17. 明确拒绝的方向

- 为每个 Provider 新建独立发布中心；
- Repository 只能有一个 Provider；
- 选择配置即启用或替换远端自动化；
- 一份配置只能有一个交付目标；
- Provider 直接识别并发布到 GitHub/SFTP/S3；
- 每个 CI Backend 重写一套 Provider 与 Destination 逻辑；
- 用任意 shell/YAML 作为核心扩展合同；
- 上传完成即标记 Published；
- 失败路线通过重新构建冒充续传；
- 现在就开放不受隔离的第三方动态插件。
