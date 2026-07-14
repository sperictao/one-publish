# 细节收口与 a11y 现状（2026-07-13 主会话调研）

## 已有能力

- 焦点环体系统一：index.css:717-720 `.focus-ring` 工具类（ring-2 + offset-2），:536-538 全局清除原生 outline 防双环。ui 组件（button/dialog/dropdown/switch）均已挂 focus-ring。
- 键盘可达性有基础：RowActionsMenu.tsx:52 悬停显示按钮带 `group-focus-within:opacity-75`，键盘聚焦不丢失。
- ShortcutsDialog 动态列出快捷键（从运行时注册表读取），有 kbd 样式。
- aria-label 全库 46 处。

## 缺口

1. **aria-live 全库仅 1 处**（PublishRunCard 状态面板）。发布日志追加、分支刷新、配置保存等异步结果对读屏用户静默。
2. **aria-label 分布不均**：PublishRunCard.tsx 0 处（折叠按钮、输出目录按钮依赖可见文本，尚可；但需逐个核对 icon-only 按钮）；RepositoryList 仅 4 处、PublishConfigPanel 仅 5 处，两者 icon-only 按钮密度高。
3. **快捷键可发现性弱**：快捷键只存在于 ShortcutsDialog 中，界面内 Tooltip 均不带 kbd 提示；用户不打开帮助对话框无法得知快捷键存在。
4. **HelpTip 覆盖偏科**：仅用于参数表单类 7 个文件（StringParameter/MapParameter/BooleanParameter/ArrayParameter 等），布局层的复杂概念（分支连通性、provider 检测、发布配置分组）无帮助说明。
5. **微文案标点混用**：zh.json:627 出现 “ ” 直角引号与其他处「」混用，需全量抽查统一。
6. 低对比 token（--text-fine、muted-foreground/60、/70 等透明度修饰用法）散布，需按 WCAG AA 抽查（RepositoryList.tsx:346 `text-foreground/60`、:464 `text-muted-foreground/60` 等）。
7. 任意值（arbitrary values）主要是 token 消费（`text-[hsl(var(--terminal-bg))]`）属正常；`tracking-[0.15em]` 大写标签样式在 PublishRunCard.tsx:409,422 重复出现，可提取。
