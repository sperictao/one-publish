# 架构候选项分阶段收敛

## Goal

完成上一轮架构审查提出的全部候选项，但必须按可验证切片推进。目标不是“大重写”，而是把 OnePublish 当前最混乱的几个领域边界收敛成稳定结构：发布配置身份、发布事务、provider adapter、store mutation contract、workbench composition、profile domain phase 2。

第一性原理判断：发布产品的核心不是三栏 UI，也不是一组 hook；核心是从“用户选中一个发布意图”到“provider 执行并记录结果”的可追踪 transaction。所有候选项都服务于这条链路。

## What I Already Know

- 现有发布配置身份同时存在多个 wire/render 形态：`preset`、`pubxml:<name>`、`userprofile:<id>`、`profile-<name>`、`recent:<id>`。
- 这些字符串语义分散在 hook、panel model、profile owner、tray recent publish 和测试 fixture 中，主要热点包括：
  - `src/hooks/useDotnetPublishSelection.ts`
  - `src/hooks/usePublishValidate.ts`
  - `src/components/layout/usePublishConfigListModel.ts`
  - `src/hooks/useProfiles.ts`
  - `src/components/layout/PublishConfigPanel.tsx`
  - `src/hooks/useRecoverableSpec.ts`
  - `src/hooks/useTrayRecentPublish.ts`
- `usePublishConfigListModel` 已经把中栏列表模型收敛了一部分，但身份 key 的解析、格式化和归一化还没有唯一 authority。
- Rust store 当前是持久化 authority。前端不应为了这个任务绕过 `src/lib/store.ts` 或改变后端 schema。
- Trellis frontend spec 要求：组件避免直接拥有领域状态；跨层副作用通过 hooks/lib wrapper；新增 TypeScript 代码必须保持严格类型。
- 之前架构审查得出的候选项顺序是：
  1. Config Identity Module
  2. Publish Transaction Module
  3. Provider Adapter 深化
  4. Store Mutation Contract
  5. Workbench Composition Model
  6. Profile Domain Phase 2

## Assumptions

- 默认不改变用户可见行为，除非某个候选项的验收明确要求修正现有错误状态。
- 默认不迁移 persisted AppState schema，也不改 Rust store 中已经存在的字符串字段。
- 现有字符串继续作为 wire format，但只能由新的 identity module 负责 encode/decode。
- 不做 compatibility layer、不做双写、不保留旧解析路径；迁移到新 module 或新 contract 后直接删除调用方里的旧逻辑。
- 每个候选项都必须有独立验证；如果一个候选项需要跨 3 个以上文件，先拆成最小可验证子切片。

## Requirements

### Slice 1: Config Identity Module

- 新增一个前端领域 helper，例如 `src/lib/publishConfigIdentity.ts`，作为发布配置身份的唯一入口。
- 定义 typed identity union，至少覆盖：
  - preset identity
  - project `.pubxml` profile identity
  - user profile identity
  - recent render identity
  - list/render id normalization
- 在 identity module 内集中提供 encode/decode/guard/normalization 能力。
- 替换生产热点里的手写 `startsWith("profile-")`、`slice("profile-".length)`、`split(":")`、模板字符串 key 拼接等逻辑。
- `useDotnetPublishSelection`、`usePublishValidate`、`usePublishConfigListModel` 必须通过 identity module 派生 selection、profile name、recent/render id。
- 保持 `useProfiles` 作为 profile domain owner，不把 profile 持久化写入逻辑搬进 identity module。

### Slice 2: Store Mutation Contract

- 收口前端对 Rust store 的 mutation 入口，调用方只表达领域动作，不散落 AppState patch 形状。
- 保持 `src/lib/store.ts` 作为 Tauri store command typed boundary。
- 禁止组件直接构造跨领域 patch；共享 mutation helper 必须编码 owner 边界和错误语义。
- 删除重复的“读当前 state -> 局部改字段 -> save”样板，保留必须的领域 owner。

### Slice 3: Publish Transaction Module

- 将一次发布运行表达为 transaction：intent -> validation/preflight -> execution -> record -> UI result。
- `usePublishRunner` 不再同时承担 intent 构造、preflight、执行分派、history record 创建和 UI 状态拼装。
- `usePublishValidate`、`usePublishExecute`、`usePublishSpecBuilder` 的职责要能从类型边界看出来。
- 发布失败、取消、preflight 阻断和执行异常必须落到同一个 transaction result model，不靠 UI 层猜测。

### Slice 4: Provider Adapter 深化

- provider catalog/schema/capability/parameter normalization 的边界继续收敛，避免 publish runtime 调用方理解每个 provider 的特殊字段。
- provider adapter 输出 stable publish intent fragment；执行层不手写 provider-specific 参数分支。
- 保持现有 provider schema 加载与错误模型，不引入新 runtime dependency。

### Slice 5: Workbench Composition Model

- `App.tsx` 和三栏 shell 只负责 composition，不持有可下沉到领域 hook 的状态派生。
- 把跨栏共享的 selected repository/project/config/publish state 归到明确 owner。
- UI 组件继续用现有视觉结构，不做设计重写。

### Slice 6: Profile Domain Phase 2

- `useProfiles` 保持 profile domain owner，但需要减少它对 UI selection/render id 的了解。
- profile discovery、custom profile CRUD、project binding 的输出统一走 identity/transaction 所需的 typed shape。
- 不迁移用户 profile 存储 schema，除非发现现有 schema 阻断领域边界。

## Acceptance Criteria

- Slice 1 完成后：生产代码中 `pubxml:`、`userprofile:`、`profile-` 的直接字符串拼拆只保留在 identity module 或确有必要的边界适配处。
- Slice 2 完成后：store mutation 调用方不再复制同一类 AppState patch 样板，新增/修改 mutation 都能从 helper 名称看出领域动作。
- Slice 3 完成后：一次发布的 intent、preflight、execution、record 写入有清晰 transaction 类型链路；UI 不再拼接 transaction 细节。
- Slice 4 完成后：provider-specific 参数处理进入 adapter 边界，执行层只消费稳定 intent fragment。
- Slice 5 完成后：`App.tsx`/layout composition 的领域派生明显减少，owner hook 名称能说明状态归属。
- Slice 6 完成后：profile domain 不再承担 config render id 解析职责，profile 输出可直接被 identity/transaction 消费。
- 每个 slice 都有 focused tests 或明确的复验路径。
- `pnpm typecheck` 通过。
- 根据实际触达范围运行 focused tests，优先包含：
  - `src/lib/__tests__/publishConfigIdentity.test.ts`
  - `src/hooks/__tests__/usePublishRunner.test.ts`
  - `src/components/layout/__tests__/PublishConfigPanel.test.tsx`
  - `src/hooks/__tests__/useTrayRecentPublish.test.ts`

## Out Of Scope

- 不做全应用重写。
- 不迁移 persisted AppState schema，除非某个 slice 证明这是唯一正确边界。
- 不重构 `PublishConfigPanel` 的视觉、布局、拖拽或菜单交互。
- 不改变 Rust tray/store wire strings，除非 TypeScript 调用方收敛时发现必须同步边界命名。
- 不引入新的状态管理库或全局 store 抽象。
- 不做旧接口兼容层。冲突旧逻辑直接删除，调用方同步到新结构。

## Technical Plan

1. 配置 Trellis implement/check context，启动任务。
2. Slice 1 先建立 identity module 和测试，用 typed data structure 表达现有 wire/render 语义。
3. Slice 2 收口 store mutation helper，先处理与发布配置/profile/recent 强相关的 mutation。
4. Slice 3 从 `usePublishRunner` 周边抽出 transaction 类型和执行编排，不改 UI。
5. Slice 4 收敛 provider adapter 输出，让 transaction 消费稳定 intent fragment。
6. Slice 5 下沉 workbench composition 中的领域派生，保持视觉不动。
7. Slice 6 清理 profile domain 对 render id / config id 的残余耦合。
8. 每个 slice 后跑局部测试；最终跑 `pnpm typecheck` 和必要 focused tests。

## Current Decision

用户已要求“完成上面所有架构候选项”。按此执行，但以 slice 为单位推进和验证。第一阶段仍保留现有 wire format，只把解析/格式化收口到 typed identity module；后续 slice 如需破坏 persisted schema，必须先在 PRD 中补充原因与迁移面。
