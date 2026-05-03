# 类型安全

> TypeScript 严格模式是当前前端质量基线。类型边界要贴近 Tauri 生成契约，并在前端入口做 normalization。

## 编译约束

`tsconfig.json` 开启了 `strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`isolatedModules` 和 `noEmit`。新增代码必须能通过 `pnpm typecheck`，该命令还会先跑 Tauri contract 检查。

真实参考路径：

- `tsconfig.json`：严格 TS 配置和 `@/*` alias。
- `package.json`：`typecheck` 为 `pnpm check:contracts && tsc --noEmit`。
- `src/generated/tauri-contracts.ts`：生成类型文件，文件头明确禁止手写修改。

## 契约与类型来源

- 后端 contract 类型从 `src/generated/tauri-contracts.ts` 引入；前端不要手写一份“看起来一样”的后端结构。
- `src/lib/store.ts` 是主要适配层：用 `Omit`、可选字段和 normalize 函数把 Tauri 类型转换成前端更易用的类型。
- `src/types/*` 多数是 re-export 或轻量补充，避免在这里复制复杂业务类型。

真实参考路径：

- `src/lib/store.ts`：`Repository`、`ExecutionRecord`、`AppState` 等前端类型从 Tauri 类型派生。
- `src/types/repository.ts`：从 `@/lib/store` re-export repository 相关类型。
- `src/types/parameters.ts`：基于生成的 `JsonValue`、`SpecValue`、`ParameterSchema` 做参数值转换。

## 运行时输入与 normalization

- 来自 Tauri、JSON、localStorage、导入文件、历史记录的值都要在边界做 normalize 或类型收窄。
- 对 `null` / `undefined` 的处理要和后端契约一致；前端常把可缺省字段转成 `undefined` 或空对象，避免组件反复判断。
- 字符串 union 用显式 type 表示，不用裸 string 传递状态。

真实参考路径：

- `src/lib/store.ts`：`normalizeRepository()`、`normalizeAppState()`、`normalizeConfigParameters()`。
- `src/lib/environment.ts`：`IssueSeverity`、`FixResult` 等 union 类型和 provider id 标准化。
- `src/hooks/useEnvironmentStatus.ts`：`EnvironmentStatus = "unknown" | "ready" | "warning" | "blocked"`。

## 类型断言使用边界

- 优先使用 `unknown`、type guard、normalize helper；只有在 DOM、第三方 API、JSON clone、测试 fixture 等边界才使用 `as`。
- `any` 不是常规模式；当前 `src/hooks/useI18n.ts` 的 `Record<string, any>` 是翻译树历史实现，不应扩散。
- 非空断言仅用于明确存在的 DOM root 等启动边界，业务数据不要用 `!` 掩盖空值。

真实参考路径：

- `src/main.tsx`：`document.getElementById("root")!` 只用于应用入口。
- `src/lib/dotnetPublishConfig.ts`：从参数对象恢复配置时使用 `Record<string, unknown>` 并转换。
- `src/hooks/useRecoverableSpec.ts`：历史 spec payload 使用 `Record<string, unknown>` 逐步收窄。

## 生成文件与测试类型

- 不要手写编辑 `src/generated/tauri-contracts.ts`；需要变更时从 Rust 侧生成并跑 `pnpm check:contracts`。
- 测试 fixture 可以使用 `as const` 保留字面量类型，但不要用宽泛断言绕过真实类型错误。
- 参数、配置、路径、历史过滤等纯逻辑已有 Vitest 样例，新增规则优先补对应测试。

真实参考路径：

- `src/lib/__tests__/dotnetPublishConfig.test.ts`：配置参数转换的类型化测试。
- `src/hooks/__tests__/useEnvironmentStatus.test.ts`：环境状态 union 的 hook 测试。
- `src/components/publish/__tests__/PublishRunCard.test.tsx`：组件行为与长文本样式测试。
