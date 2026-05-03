# 目录结构

> 记录当前前端代码的组织方式。新增文件时优先放到已有职责边界内，不为了“看起来更整洁”移动无关代码。

## 根目录布局

当前 Vite root 是 `src/`，构建输出到 `dist/`。路径别名 `@/*` 指向 `src/*`，由 `vite.config.ts`、`vitest.config.ts` 和 `tsconfig.json` 同步配置。

```text
src/
├── App.tsx
├── main.tsx
├── index.css
├── components/
├── hooks/
├── lib/
├── types/
├── features/
├── generated/
├── i18n/
├── test/
└── __tests__/
```

真实参考路径：

- `vite.config.ts`：`root: "src"`、`@` alias、固定 dev server port。
- `vitest.config.ts`：同一套 `@` alias，测试环境为 `jsdom`。
- `src/main.tsx`：只做 React 挂载、全局 CSS、Sonner 和平台 class 初始化。

## 目录职责

- `src/components/ui/`：shadcn/Radix 风格基础组件和应用级 UI primitive，例如 `button.tsx`、`dialog.tsx`、`app-dialog-shell.tsx`。
- `src/components/layout/`：三栏布局、仓库列表、中栏发布配置面板、浮卡/拖拽等布局相关组件与局部 hooks。
- `src/components/publish/`、`src/components/environment/`、`src/components/release/`：发布、环境检查、release checklist 等领域 UI。
- `src/hooks/`：应用级状态编排和领域流程 hook，例如 `useAppState.ts`、`usePublishRunner.ts`、`useProjectShellState.ts`。
- `src/lib/`：不依赖 React 渲染的工具、Tauri invoke 包装、纯转换逻辑和运行时边界。
- `src/types/`：轻量 re-export 或前端特有类型适配，复杂类型源头通常在 `src/lib/store.ts` 或生成契约中。
- `src/generated/`：Rust 侧生成的 Tauri 契约，禁止手写修改。
- `src/i18n/`：按功能域组织的中英文嵌套 JSON。
- `src/features/`：目前只承载少量 feature-scoped utility，尚不是主组织方式。

真实参考路径：

- `src/components/layout/RepositoryList.tsx` 搭配 `RepositoryRow.tsx`、`usePointerListReorder.ts`、`RepositoryListFloatingLayer.tsx` 组成左栏列表模块。
- `src/components/publish/ConfigDialog.tsx` 搭配 `DotnetPublishConfigFormSections.tsx`、参数编辑器组件组成发布配置表单。
- `src/lib/dotnetPublishConfig.ts` 与 `src/lib/__tests__/dotnetPublishConfig.test.ts` 展示纯逻辑放在 `lib` 并就近测试。

## 命名与导入

- 组件文件使用 PascalCase，例如 `PublishRunCard.tsx`、`SettingsDialog.tsx`。
- 自定义 hook 使用 `useXxx`，包括组件目录内的局部 hook，例如 `src/components/layout/useFloatingListCard.ts`。
- 跨目录导入优先用 `@/`；同目录紧密协作文件可用相对导入，例如 `src/components/publish/ParameterEditor.tsx` 导入 `./BooleanParameter`。
- 测试文件放在被测层级的 `__tests__/` 下；浏览器级 e2e 放在 `tests/e2e/`。

## 新增文件落点

- 新 UI primitive 放 `src/components/ui/`，并保持 `cn`、forwardRef、Radix/shadcn 风格。
- 面向用户流程的组件按领域放入 `components/layout`、`components/publish`、`components/environment` 或 `components/release`。
- 跨组件复用的有状态逻辑放 `src/hooks/`；只服务某个布局模块的 hook 可留在该组件目录。
- Tauri 命令包装、数据标准化、命令渲染、路径处理等非 React 逻辑放 `src/lib/`。
- 不要为前端状态新建 `src/store/` 这类并行目录；当前状态入口是 `src/lib/store.ts` 与 `src/hooks/useAppState.ts`。
