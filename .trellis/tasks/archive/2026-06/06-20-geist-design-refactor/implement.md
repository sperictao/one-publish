# Implement — Geist 设计系统全量对齐（父任务编排）

本文件是父任务的执行编排：子任务顺序、各阶段验证命令、review gate 与回滚点。各子任务的具体步骤在各自 `implement.md`。

## 执行顺序

子任务严格按序（后者依赖前者交付的 token/组件）：

```
1. geist-token-system        (R1)  → token 契约落地
2. geist-ui-primitives       (R2)  → 基础组件对齐（依赖 1 的 token）
3. geist-business-components (R3)  → 业务组件重构（依赖 1 的 token + 2 的 UI 组件）
4. geist-verify              (R4)  → 全量门禁（依赖 1/2/3 完成）
```

## 各阶段验证命令

每个子任务完成时运行其范围内的验证；父任务最终门禁运行全集：

```bash
pnpm typecheck          # TS + ts-rs 契约
pnpm test               # Vitest 单测
pnpm doctor             # react-doctor 健康检查
pnpm e2e                # Playwright e2e（锚点未破坏）
```

视觉验证（手动 / 截图对比）：
- `pnpm dev` 启动，切换 light/dark，核对主窗、设置 Dialog、各 publish Dialog。

## Review Gate

每个子任务 `task.py start` 前需具备：
- `prd.md`（需求 + 验收）
- 复杂子任务（1/2/3）：`design.md` + `implement.md`
- 轻量子任务（4）：可 PRD-only

每个子任务归档前需：
- 其范围测试锚点 grep 校验通过
- `pnpm typecheck && pnpm test` 全绿
- 子任务 4 额外要求 `pnpm doctor && pnpm e2e` 全绿 + 视觉回归

## 回滚点

- 子任务 1 失败 → 修复或回滚 token 文件，2/3/4 不启动。
- 子任务 2/3 失败 → 回滚到该子任务边界，token 体系保留。
- 子任务 4 门禁失败 → 回到对应子任务修复。

## 父任务完成标准

- 4 个子任务全部归档。
- prd.md Acceptance Criteria 全部勾选。
- 跨子任务验收（design.md §9）满足。

## 当前状态

- [x] 父 prd.md / design.md / implement.md 完成
- [ ] 创建 4 个子任务
- [ ] 子任务 1 规划（design + implement）→ start → 实施 → 归档
- [ ] 子任务 2 规划 → start → 实施 → 归档
- [ ] 子任务 3 规划 → start → 实施 → 归档
- [ ] 子任务 4 规划 → start → 实施 → 归档
- [ ] 父任务最终验收 + 归档
