# 细节收口与 a11y Polish

## Goal

在前三个子任务之后做最终收口：aria 覆盖补齐、快捷键可发现性、帮助说明覆盖、微文案统一、低对比抽查。目标是「无杂音」而非「加东西」。

## 前置事实

见 [research/current-state.md](research/current-state.md)。核心结论：焦点环体系已统一（无需动）；aria-live 全库仅 1 处；快捷键只活在帮助对话框里；HelpTip 只覆盖参数表单；文案引号混用。

## Requirements

1. **aria 补齐**：审计全部 icon-only 按钮补 aria-label；为异步操作结果（分支刷新、配置保存、日志状态）补必要的 aria-live 区域或复用现有 toast 的可达性；发布日志区加 role/label。
2. **快捷键可发现性**：Tooltip 组件支持可选 kbd 后缀，为已注册快捷键的入口（设置、快捷键面板、发布等）在 tooltip 中展示快捷键；数据源复用 ShortcutsDialog 的运行时注册表（DRY，不另建映射表）。
3. **HelpTip 补位**：为布局层 3-5 个高困惑概念（分支连通性、provider 检测、配置分组）补 HelpTip；宁缺毋滥，每个都要能一句话说清。
4. **微文案统一**：zh.json 全量过一遍：引号统一（「」为主）、句尾标点一致性、全角半角空格规则；产出规则写入 i18n spec 或检查脚本（pnpm check:i18n 若可扩展则加规则）。
5. **对比度抽查**：对 `--text-fine`、`text-foreground/60`、`text-muted-foreground/60-70` 等低对比用法按 WCAG AA 抽查，不达标处升档；辅助性装饰文本可豁免但需记录。
6. **重复样式提取**：`tracking-[0.15em]` 大写标签等重复出现的样式串提取为工具类（与既有 typography 工具类体系并轨）。

## 非目标

- 不重做焦点环体系（已统一）。
- 不做完整读屏走查（超出本轮范围，记入后续任务候选）。

## 依赖

- 排在前三个子任务之后实施，避免对同一批文件的并行改动冲突。

## Acceptance Criteria

- [ ] icon-only 按钮 aria-label 覆盖率 100%（审计清单落 journal）。
- [ ] 带快捷键的入口在 tooltip 中可见快捷键，数据与 ShortcutsDialog 同源。
- [ ] zh/en 文案标点规则成文并全量应用，`pnpm check:i18n` 通过。
- [ ] 对比度抽查清单落 journal，正文类文本无低于 AA 的组合。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm doctor` 全绿。
