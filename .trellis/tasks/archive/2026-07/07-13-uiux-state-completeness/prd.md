# 状态完整性系统化覆盖

## Goal

以 RepositoryList 空态（现有质量标杆）为基准，系统性补齐全应用的加载/空/错误状态：引入骨架屏原语，替换空白 Suspense fallback，统一空态组件，收敛 spinner 使用场景。

## 前置事实

见 [research/current-state.md](research/current-state.md)。核心结论：零骨架屏、五处懒加载 fallback 是空白 div、空态质量两极分化（RepositoryList 完整 vs ConfigDialog/ShortcutsDialog 一行灰字）。

## Requirements

1. **骨架原语**：新增 `src/components/ui/skeleton.tsx`（Geist 风格：gray-alpha 底 + 克制的 pulse，reduced-motion 下静态），只做一个原语组件，不做每场景一个骨架组件的过度设计。
2. **Suspense fallback 替换**：App.tsx 三栏懒加载 fallback 用骨架轮廓（列表骨架 / 表单骨架 / 内容骨架，形状对应最终布局）；PublishContentSection 视图切换 fallback 同理。对话框类 fallback=null 保持不变（弹层场景可接受）。
3. **空态组件统一（DRY）**：将 RepositoryList.tsx:340-352 的空态结构提取为共享 `EmptyState` 组件（图标 + 主文案 + 行动提示 + 可选行动按钮），ConfigDialog、ShortcutsDialog、历史列表等一行灰字场景迁移到该组件。
4. **spinner 收敛**：审计 12+ 处 animate-spin，就地行内操作（按钮内、刷新图标）保留 spinner；区域级加载（列表、面板）改骨架。产出一条使用准则写入 spec（行内 spinner / 区域骨架的分界）。
5. **错误态核对**：逐个确认分支连通性失败、环境检查失败、provider 检测失败的呈现是否有静默失败路径，缺失处补 inline 错误或 toast（只补缺，不重做已有三通道体系）。

## 非目标

- 不做离线检测/网络状态感知（桌面本地工具，YAGNI）。
- 不改 ProviderRuntimeBanner 与 toast 既有体系。

## 依赖

- 骨架 pulse 动画消费 07-13-uiux-motion-layer 的 token 与 reduced-motion 门控。

## Acceptance Criteria

- [ ] 冷启动与面板懒加载期间无空白块，骨架形状与最终布局对应。
- [ ] 全应用空态视觉结构一致（同一 EmptyState 组件），每个空态含行动指引。
- [ ] 区域级加载不再使用居中 spinner。
- [ ] 错误态审计清单落在任务 journal，静默失败路径清零。
- [ ] `pnpm typecheck`、`pnpm test` 全绿。
