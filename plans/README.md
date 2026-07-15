# Implementation Plans

Execute in the order below unless dependencies say otherwise. Each executor:
read the plan fully before starting, honor its STOP conditions, and update
your row when done.

## Round 2 (2026-07-14, commit `97d3d0c`) — correctness / security / DX / debt

本轮审计上一轮未覆盖的类别（correctness、security、performance、测试、依赖、
Rust 后端、DX）。核实结论：后端工程质量高（命令执行无 shell 注入面、配置
原子写入、清理护栏完善），高杠杆项集中在 CI 门禁缺口。

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 008  | CI 增加 Rust 测试、Clippy 与 ts-rs 契约漂移门禁 | P1 | S | — | DONE（05e38a5+0825755 @ advisor/008-ci-rust-and-contracts-gate，基于 012 之上；执行期发现主干 clippy 红→计划修订纳入 2 处基线修复；CI 实跑未验证，本地三项全绿，评审通过） |
| 009  | 建立 cargo audit 依赖漏洞门禁 | P1 | S | 008 | DONE（9c7ce74 @ advisor/009-cargo-audit-gate；发现 14 个真实 advisory → 门禁按预案 non-blocking，清单见计划执行记录；升级依赖为后续独立任务；评审通过） |
| 010  | 引入 ESLint flat config 作为前端静态检查门禁 | P1 | M | —（建议在 008 后，同文件少冲突） | DONE（64ab5e6 @ advisor/010-eslint-flat-config，ESLint v10，0 error/185 warning 待后续清理，282 测试绿，评审通过） |
| 011  | 消除 src/store 与 src/stores 双目录混淆 | P2 | S | — | DONE（db1cfdd @ advisor/011-merge-store-dirs，R100 纯 rename，280 测试绿，评审通过） |
| 013  | 升级带 RustSEC advisory 的 Cargo 传递依赖并收紧 audit 门禁 | P1 | M | Round 2 分支已合并（需 009 的 audit 步骤） | DONE（5cbb449 @ advisor/013-rustsec-dependency-updates；14 个 advisory 消 9 个，quick-xml×2/time×1 进带注释 ignore；audit 门禁转阻断；偏离：audit.toml 实测须放 src-tauri/.cargo/ 且 CI 步骤改 working-directory；评审通过。新发现：zip ^7.3 全系被 yank 且锁死 time 修复 → 015 候选升级 zip 8.x） |
| 014  | 清理 ESLint 机械类存量 warning 并升回 error | P2 | M | Round 2 分支已合并（需 010 的 config） | DONE（15bf23e+91707b9 @ advisor/014-eslint-warning-cleanup，185→77 warning 全为语义类；净删 174 行含 2 个 e2e 死函数；一处 preserve-caught-error 残留因 tsconfig ES2020 按跳过条款留 warn；评审通过） |
| 015  | 升级 zip 至 8.x，解锁 time 安全修复并清除 yanked 依赖 | P1 | S–M | 013 | DONE（5ffbcc3 @ advisor/015-zip-upgrade；zip 8.6.0 + time 0.3.53，零源码适配，audit 负债仅剩 quick-xml×2；评审通过） |
| 012  | 修复 Tauri 事件监听卸载竞态泄漏 | P2 | S | — | DONE（7aa26ae @ worktree-agent-a62e1491dfe66031d，282 测试绿，评审通过） |

### Round 2 dependency notes

- 009 在 008 之后：审计步骤追加到 008 新建的 `rust` job。
- 008 与 010 都改 `.github/workflows/quality.yml`，串行执行避免冲突；010、011、
  012 相互独立可并行。

### Round 2 合并指引（分支拓扑，2026-07-15 全部执行完毕）

- **合并 `advisor/015-zip-upgrade` 即一次带入 7 个计划**。该分支为堆叠链尖，
  自 main（97d3d0c）依次含：`7aa26ae`（012）→ `05e38a5`+`0825755`（008）→
  `9c7ce74`（009）→ `64ab5e6`（010）→ `5cbb449`（013）→ `15bf23e`+`91707b9`
  （014）→ `5ffbcc3`（015）。每层均已独立评审通过。
- `advisor/011-merge-store-dirs`（`db1cfdd`）独立分支，单独合并，与堆叠链
  无文件交集，顺序不限。
- 全部提交仅存在本地，未 push；合并由维护者执行。合并后首次 Quality workflow
  的 `rust` job 无缓存约 10 分钟，且为门禁首次真实上线（CI 实跑未预验证）。
- 中间分支（advisor/008/009/010/013/014）与两个 worktree 在合并确认后可清理。

### Round 2 执行期新发现（已写成计划 013 / 014，待执行）

- **013：升级 14 个带 RustSEC advisory 的 Cargo 依赖**（quick-xml、
  quinn-proto、rustls-webpki、tar、time、bytes 等，完整清单见 013 计划正文；
  核实全为传递依赖，多数 `cargo update -p` 可修，quick-xml 需 Tauri 上游配合）。
  完成后移除 audit 步骤的 `continue-on-error` 转为阻断。**依赖 Round 2 分支先合并。**
- **014：ESLint 存量 185 warning 分类清理**——no-undef(51) 是配置债一行消除、
  机械类(56) 批量修后升回 error；语义类(exhaustive-deps/any 等)明确不动，留人工。
  **依赖 Round 2 分支先合并。**

### Round 2 findings considered and rejected

- **process_utils/命令执行 shell 注入**：`Command` + 独立参数传递，无 shell
  插值，无注入面。非发现。
- **store 持久化完整性**：`store/persistence.rs` 已是临时文件+原子 rename+
  0600 权限+损坏备份回退，无需改动。
- **输出目录清理误删风险**：`output_policy.rs` 已有 root/项目源码/受保护目录
  多重护栏且有测试；剩余边界（如项目在另一磁盘时清理浅层目录）过于极端，
  收益不抵改动，不立项。
- **publishStore 与 publishStateSlice 重复**：核实为功能不重叠（临时会话态 vs
  持久化配置），仅目录命名混淆 → 收敛为 011 的纯搬移。
- **usePublishLogStream 每行日志 setState 的渲染开销**：可见日志已被
  200k 字符上限约束（`MAX_VISIBLE_LOG_CHARS`），实测风险低，不立项。

### Round 2 未深入范围（下轮候选）

- `preflight/mod.rs`（1210 行）、`updater.rs` 签名/回滚全量逻辑、
  `PublishConfigPanel.tsx`（1633 行）逐行、全部 hook 的 effect 依赖。
  本轮子代理因 API 限流失败，由主 agent 直接精读，深度受限。

---

## Round 1 (2026-07-12, commit `4603006`) — 设计系统合规

主题：用户指令「严格遵守 DESIGN.md 和 design.dark.md 重构所有页面」。审计聚焦
设计系统合规这一类别。

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | Geist 微原语（SectionLabel/CodeWell/IconChip + Input/Select 尺寸变体） | P1 | S | — | DONE（e475646，266 测试绿） |
| 002  | 工作台三栏面板与右栏卡片的前期偏差清理 | P1 | M | 001 | DONE（d917cfd，266 测试绿；发现 4 个漏网文件 → 006） |
| 003  | 弹窗自造样式配方收敛到共享原语 | P2 | M | 001 | DONE（ea14c70，7 常量清零，266 绿） |
| 004  | Geist 合规检查脚本 + CI 质量门禁 | P1 | M | 002, 003, 006, 007 | DONE（9c66be0+d3c9326，扫描184文件全绿，红测自证） |
| 005  | 清退原型页与死代码（破坏性，需维护者批准） | P3 | S | —（建议在 004 后） | DONE（1dc6d47，净删787行，183文件全绿） |
| 006  | 增补：002 漏网的 4 个行组件清理 | P1 | S | 002 | DONE（b31e853，残留归零，266 绿） |
| 007  | 增补：门禁预跑发现的 3 处额外漏网 | P1 | S | 002 | DONE（67c608f，仅剩 3 条白名单例外，266 绿） |

Status values: TODO | APPROVED（仅 005 需要）| IN PROGRESS | DONE | BLOCKED (原因) | REJECTED (理由)

## Dependency notes

- 002、003 消费 001 产出的原语（SectionLabel/CodeWell/IconChip、尺寸变体）。
- 004 必须在 002、003 之后：扫描器以"零白名单起跑绿"为设计前提，提早合入会立刻红。
- 005 独立，但在 004 之后执行可顺手删掉扫描器为原型开的目录排除项。
- 002 与 003 无相互依赖，可并行执行（文件集不相交）。

## Findings considered and rejected

- **面板外壳 `rounded-md`（SidebarPanelShell/MainContentShell）**：commit 65a2db8「统一三列布局圆角」的既定决策，不作为偏差。
- **`bg-background/80` 发布中遮罩（PublishRunCard:502）**：语义 token + 半透明遮罩属合规用法。
- **弹窗遮罩 `bg-black/50`**：Geist 弹窗遮罩惯例，双主题下刻意不随主题反转。
- **图标按钮 `rounded-full`**：DESIGN.md 明示 9999px 用于圆形控件，属豁免而非偏差。
- **「取消」按钮文案**：DESIGN.md Voice 要求动词+名词，但 Cancel/取消是全行业惯例且 Vercel 产品自身沿用；改名收益为负。
- **选中态 `bg-accent` 填充**：应用内既定选中约定（设置导航、分支面板一致使用），仅悬停禁用 accent。
- **StringParameter 等四个参数控件**：被 `ReadonlyParameterFieldsSection` 生产引用，不是死代码（勿与 ParameterEditor 混淆）。

## 执行期发现的规划疏漏（已在执行分支补修）

- Plan 002 的映射表遗漏 3 类边界文件/行：4 个行子组件（→ Plan 006）、门禁预跑发现的 3 处（→ Plan 007）、BranchPanel MAIN 徽章裸 `rounded`（→ 由 exec-004 前置补修）。根因：002 的残留扫描正则只覆盖 `rounded-lg/xl`、未含裸 `rounded`，且文件清单靠人工枚举而非全目录。Plan 004 的 `bare-rounded` 规则上线后此类将被自动拦截。

## 本轮未审计范围（已由 Round 2 于 2026-07-14 覆盖）

- correctness / security / performance / 测试覆盖 / 依赖升级 / Rust 后端（src-tauri）全部未看。
- e2e 规格（tests/e2e）与发布流水线逻辑未审。
