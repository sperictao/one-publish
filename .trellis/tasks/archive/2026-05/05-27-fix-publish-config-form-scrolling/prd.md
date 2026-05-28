# fix publish config form scrolling

## Goal

修复发布配置查看、创建和编辑弹窗中表单内容无法滚动的问题，让长表单在固定高度弹窗内可正常滚动，同时保持页脚操作区固定可见。

## What I already know

- 用户反馈发布配置查看、 新增和修改页面表单内容无法滚动。
- 查看入口是 `ProjectPublishProfileViewerDialog`。
- 新增和编辑入口共用 `QuickCreateProfileDialog`。
- 这两个弹窗当前都通过 `AppDialogShell` 使用 `size="responsive"`、`bodyScrollable={false}` 和业务组件内层 `overflow-y-auto`。
- `AppDialogShell` 是应用大弹窗统一外壳，其他弹窗也复用它。

## Assumptions

- 问题发生在弹窗内容高度超过视口时。
- 本次只修布局和滚动容器，不改变发布配置字段、保存、加载、解析和持久化逻辑。
- 页脚按钮区应保持在表单滚动区域之外。

## Requirements

- 发布配置查看弹窗内容超过可视区域时，主体内容可以滚动。
- 发布配置创建弹窗内容超过可视区域时，主体内容可以滚动。
- 发布配置编辑弹窗内容超过可视区域时，主体内容可以滚动。
- 修复应优先复用 `AppDialogShell` 的滚动能力，避免每个业务弹窗重复定义滚动布局。
- 不引入新的状态 owner、不修改业务逻辑。

## Acceptance Criteria

- [ ] 查看发布配置弹窗的长表单可以滚动到底部。
- [ ] 创建发布配置弹窗的长表单可以滚动到底部。
- [ ] 编辑发布配置弹窗的长表单可以滚动到底部。
- [ ] `pnpm typecheck` 通过。

## Out of Scope

- 不调整字段文案、字段顺序或保存行为。
- 不处理发布流程或 `.pubxml` 解析逻辑。
- 不做无关 UI polish。

## Technical Notes

- 前端规范要求弹窗优先复用 `AppDialogShell`、`Dialog`、`AppDialogInset` 结构。
- 当前工作区在相关弹窗文件上已有未提交改动，实施时需要保持最小 diff。
