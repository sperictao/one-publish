# UI 状态完整性现状（2026-07-13 主会话调研）

## 已有能力

- 空态文案 i18n 覆盖广：zh.json 20+ 个 empty/暂无 类 key（noRepositories:244、noBranches:289、noProfiles:363、publishLogEmpty:526、noConfigs:781 等），en.json 对应存在。
- 质量标杆空态：RepositoryList.tsx:340-352 仓库空态有完整设计（surface-raised 图标容器 + FolderGit2 + 主文案 + 行动提示「点击下方添加仓库」）。
- 错误呈现三通道已存在：sonner toast、ProviderRuntimeBanner（provider 运行时错误横幅，App.tsx:92-101）、PublishRunCard 失败消息块。
- 全局 boot loading：App.tsx:67-78 居中 Loader2 + 文案。

## 缺口

1. **零骨架屏**：全库 grep `skeleton` 无结果。所有加载态都是 spinner 或空白。
2. **Suspense fallback 全是空白**：
   - App.tsx:83,110,141,154,166 五处 fallback 为空 div —— 三栏懒加载期间白块；
   - PublishContentSection.tsx:46,61 fallback=null —— home/history 视图切换闪空；
   - AppDialogs.tsx:189,198,214,247,270 等 fallback=null（对话框场景可接受）。
3. **空态质量不均**：RepositoryList 是完整设计，而 ConfigDialog.tsx:354（暂无保存的配置文件）、ShortcutsDialog.tsx:53（暂无快捷键）只有一行灰字，无图标、无行动指引。
4. **spinner 泛滥**：animate-spin 12+ 处（PublishConfigPanel.tsx:228,1121,1330、EditRepositoryDialog.tsx:765,820,859、SettingsDialog.tsx:999,1015 等），部分场景（列表加载、面板刷新）更适合骨架或就地占位。
5. 分支连通性失败（branchConnectivityByRepoId）与环境检查失败的呈现方式需在实施时逐个确认（本轮未深入 BranchPanel/EnvironmentCheckDialog）。
