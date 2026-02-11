# Repository Guidelines

## 项目结构与模块组织
- `src/`: React 18 + TypeScript 前端，`components/ui` 存放 shadcn/ui 组件，`lib` 放置复用工具。
- `src-tauri/`: Tauri 2 Rust 后端，`src/main.rs` 启动入口，`src/commands.rs` 与 `src/store` 处理命令及持久化。
- `scripts/`: `generate-icons.mjs` 生成跨平台图标，输出到 `src-tauri/icons`。
- 构建产物位于 `dist/`（由 Vite 生成，供 Tauri 打包），配置文件集中在仓库根目录（`vite.config.ts`、`tauri.conf.json`、`tsconfig*.json`）。

## 开发、构建与测试命令
- 安装依赖：`pnpm install`（需 Node 18+、pnpm）。
- 开发：`pnpm dev` 同时启动 Tauri（前后端）；仅前端用 `pnpm dev:renderer`。
- 构建：`pnpm build` 打包桌面端；仅前端构建用 `pnpm build:renderer`。
- 质量检查：`pnpm typecheck` 运行 TypeScript 严格类型检查。
- Rust 侧：`cd src-tauri && cargo check|test|clippy` 进行检查/测试/静态分析。

## 编码风格与命名约定
- TypeScript 严格模式，默认 2 空格缩进，保持 Vite/Prettier 默认格式（仓库未启用 ESLint）。
- 路径别名 `@/*` 指向 `src/*`；组件文件用 PascalCase，Hook 以 `useXxx` 命名。
- Tailwind 设计令牌定义于 `src/index.css`，优先复用现有变量与 shadcn/ui 组件。
- Rust 侧保持模块单一职责，错误处理使用 `anyhow/thiserror` 现有模式。

## 测试与验证指南
- 提交前至少运行 `pnpm typecheck`；若改动 Rust 命令或状态，补充 `cargo test` 与 `cargo clippy`。
- 当前无前端单测框架，新增功能请描述最小可验证路径（操作步骤或关键日志）。
- 影响发布流程的改动需在真实 .NET 项目上试跑 `dotnet publish` 并记录输出。

## Commit 与 Pull Request
- 推荐 Conventional Commits：如 `feat: add profile scanner`、`fix: handle publish error`、`chore: update icons`。
- PR 描述需包含：变更目的、主要修改点、验证结果；UI 变更附截图/录屏；关联相关 issue/任务编号。
- 保持小而可审的提交，避免混合重构与功能改动；变更配置文件时注明原因与影响面。

## 安全与配置提示
- 生成图标需 macOS 的 `iconutil`；运行脚本可能覆盖 `src-tauri/icons` 下同名文件。
- 勿提交密钥、证书或发布配置；如需本地环境变量，请使用私有 `.env` 并确保不入库。
- Tauri CSP 已启用，新增前端资源或 IPC 通道前请检查协议范围与来源安全性。

## Lessons Learned
- 修复 macOS 交通灯位置问题时，先确认是否由 `tauri-plugin-decorum` 在 `resize/fullscreen` 回调里按默认值重排，避免应用层与插件层同时抢写导致抖动。
