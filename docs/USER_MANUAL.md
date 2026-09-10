# OnePublish 操作手册

> 版本：本文档对应 **OnePublish v1.0.0**（`v1.0.0` 标签）
>
> 这是一套面向使用者（桌面端用户）与开发者（命令行 / CI）的**完整操作手册**，覆盖软件的全部功能。所有功能均以当前仓库源码为准整理。

---

## 目录

1. [软件简介](#1-软件简介)
2. [安装与首次启动](#2-安装与首次启动)
3. [主界面概览](#3-主界面概览)
4. [仓库管理](#4-仓库管理)
5. [发布配置](#5-发布配置)
6. [执行发布](#6-执行发布)
7. [发布历史与重跑](#7-发布历史与重跑)
8. [环境诊断](#8-环境诊断)
9. [设置](#9-设置)
10. [快捷键](#10-快捷键)
11. [系统托盘](#11-系统托盘)
12. [自动化绑定与远程发布](#12-自动化绑定与远程发布)
13. [命令行与开发（CLI / 脚本 / CI）](#13-命令行与开发-cli--脚本--ci)
14. [常见问题与排障](#14-常见问题与排障)
15. [术语速查](#15-术语速查)

---

## 1. 软件简介

**OnePublish** 是一款跨平台桌面应用（Tauri 2 + React 19），用图形界面统一发布多语言软件项目。你不再需要记忆并手敲复杂的 CLI 命令：选择一个仓库，通过智能表单配置参数，一键发布。

**一套界面，多种语言**：.NET（`dotnet publish`）· Rust（`cargo build --release`）· Go（`go build`）· Java / Gradle · Tauri（桌面端打包）。

### 核心特性

| 特性                   | 说明                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| 🎯 多语言支持          | .NET / Rust / Go / Java(Gradle) / Tauri 桌面                              |
| 🧠 Schema 驱动参数     | 每个 CLI 标志、环境变量、参数都以结构化方式表达和校验，而非硬编码         |
| 📋 命令导入            | 粘贴任意构建命令，OnePublish 反向解析为结构化参数                         |
| 📊 执行历史            | 本地时间线记录最近运行，支持一键重跑                                      |
| 🔍 环境诊断            | 自动检测缺失的工具链（SDK / 运行时），给出引导式修复                      |
| 🎨 Geist 设计系统      | Vercel 风格 token 驱动 UI、P3 广色域、dark/light 主题                     |
| 🌐 国际化              | 简体中文 + English                                                        |
| 🔄 自动更新            | Tauri Updater 管线 + GitHub Releases 集成                                 |
| ⌨️ 键盘优先            | 全局快捷键，免鼠标发布                                                    |
| 📦 一键 GitHub Release | `pnpm release -v x.y.z` 同步版本、生成 notes、提交、打 tag、推送并等待 CI |

---

## 2. 安装与首次启动

### 2.1 前置依赖

| 依赖          | 版本                               | 用途                                          |
| ------------- | ---------------------------------- | --------------------------------------------- |
| **Node.js**   | ≥ 20.19                            | 前端运行时                                    |
| **pnpm**      | 10.10.0（锁定的 `packageManager`） | 包管理器                                      |
| **Rust**      | ≥ 1.77.0                           | Tauri 后端编译                                |
| **目标 SDK**  | 视需要                             | 至少一种：.NET SDK / Rust / Go / Java(Gradle) |
| **Xcode CLT** | —                                  | macOS 构建 Tauri 必需                         |

### 2.2 各平台安装依赖

**macOS**

```bash
# Xcode Command Line Tools（Tauri 在 macOS 必需）
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Linux**

```bash
# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

**Windows**

```bash
# 用 Chocolatey
choco install nodejs pnpm rust
# 或使用官方安装器：nodejs.org、rustup.rs
```

### 2.3 构建并运行

```bash
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# 安装依赖（会顺带安装 pre-commit 钩子）
pnpm install

# 开发模式（热重载：前端 Vite + 后端 Rust）
pnpm dev

# 生产构建
pnpm build
# 输出目录：src-tauri/target/release/bundle/
```

> 有关安装 / 构建的更完整命令行说明，参见[第 13 节](#13-命令行与开发-cli--脚本--ci)。

---

## 3. 主界面概览

进入应用后是**三栏式桌面布局**，顶部为窗口拖拽区（无独立标题栏）。加载时先显示「加载中…」提示。

| 栏       | 内容                               | 说明                         |
| -------- | ---------------------------------- | ---------------------------- |
| **左栏** | 仓库列表（RepositoryList）         | 管理你的项目仓库             |
| **中栏** | 发布配置列表（PublishConfigPanel） | 管理发布配置、执行发布       |
| **右栏** | 主内容区（主页 / 历史记录）        | 显示当前仓库的发布内容或历史 |

### 界面操作

- **调整面板宽度**：在左栏与中栏之间的拖拽手柄左右拖动。
- **收起 / 展开面板**：每个面板顶部有「收起」按钮；收起后右栏顶栏会出现「展开仓库列表」和「展开配置列表」按钮。
- **切换视图**：右栏顶栏的「主页」（仪表盘图标）与「历史记录」（时钟图标）按钮切换右栏内容。
- **Provider 运行时横幅**：当某个 Provider 的 schema 加载失败时，顶部显示错误横幅并带「重试」按钮。

---

## 4. 仓库管理

### 4.1 添加仓库

1. 点击左栏顶部的 **＋** 按钮 → 「添加仓库」。
2. 弹出目录选择器「选择仓库目录」，选定后应用自动：
   - `detectRepositoryProvider` 识别 Provider（.NET / Cargo / Go / Java / Tauri）。
   - 自动扫描项目候选文件（如 `.sln` / `Cargo.toml` / `go.mod` / `build.gradle` / `tauri.conf.json`）。
   - 读取 Git 分支信息。
3. 完成后仓库出现在左栏，并弹出「仓库已添加」提示。

> 若识别不到支持的 Provider，会提示「未识别到支持的 Provider」，可手动指定。

### 4.2 选择与搜索仓库

- **选择**：点击左栏任意仓库行即选中（高亮），右栏随之切换为该仓库的配置与发布状态。
- **搜索**：左栏顶部搜索框按仓库**名称**或**路径**过滤。
- **查看总数**：左栏顶部「全部」按钮显示仓库总数。

### 4.3 编辑仓库

右键仓库行的 **⋯** 菜单 → 「编辑仓库」，打开 **EditRepositoryDialog**：

- **仓库名称**（必填）。
- **Project Root 路径**：手动输入或点击文件夹图标浏览。
- **Project File**：下拉选择扫描出的项目文件，或「扫描项目文件」，或「手动输入…」。
- **Provider**：下拉选择，或点击刷新图标「自动检测 Provider」。
- **当前分支**：下拉选择，或点击刷新图标「刷新分支」。

> 左侧面板展示仓库概要：图标、名称、路径、**分支数量**、**绑定状态**（已绑定/未绑定）、**当前服务**（Provider）。

> **重要**：若仓库含多个项目文件且未显式绑定 Project File，保存时会提示「先绑定 Project File」并阻止保存。

### 4.4 打开 / 移除仓库

- **打开目录**：⋯ 菜单 → 「打开目录」，在系统文件管理器中打开仓库路径。
- **移除**：⋯ 菜单 → 「移除仓库」（红色），确认后删除。

### 4.5 排序仓库

- 左栏顶部 **⇅** 按钮「开启排序」后，每个仓库行出现拖拽手柄，可拖动改变顺序（搜索时禁用拖拽）。

### 4.6 打开设置

- 左栏底部**齿轮**按钮 → 打开应用设置对话框（见[第 9 节](#9-设置)）。

---

## 5. 发布配置

中栏 `PublishConfigPanel` 将配置分为三组：

- **最近使用**：近期用过的配置。
- **项目发布配置**：扫描自项目文件（如 `.pubxml`）的发布配置。
- **自定义发布配置组**：用户保存的配置。

### 5.1 新建配置

1. 中栏顶部 **＋** → 「新建配置」。
2. 打开 **QuickCreateProfileDialog**，配置：
   - **预置模板**：选择 Provider 预置模板。
   - **配置名称**。
   - **发布配置组**：默认分组 / 已有分组 / 自定义分组。
   - **Provider 参数表单**：按 Provider 的 schema 渲染。
3. 「创建并保存」后立即写入并应用到当前仓库。

### 5.2 选择配置

- 点击中栏任意配置项即选中（高亮），该项应用到右栏发布界面。
- 「最近使用」「项目发布配置」同样点击即选中。

### 5.3 Provider 参数表单

参数表单由各 Provider 的 schema 驱动，支持四种控件：

| 控件        | 说明       |
| ----------- | ---------- |
| **String**  | 文本框     |
| **Boolean** | 开关       |
| **Array**   | 多值列表   |
| **Map**     | 键值对表格 |

各 Provider 常用参数：

- **.NET**：configuration（Release/Debug）、runtime、framework、output、self_contained、no_build、no_restore、verbosity、no_logo、properties（MSBuild 属性，如 `-p:Version=1.2.3`）、delete_existing_files 等，全部由 schema 驱动的统一参数表单编辑。
- **Cargo**：release、target、features、all_features、no_default_features、target_dir、message_format、verbose、quiet。
- **Go**：output、target(GOOS)、arch(GOARCH)、tags、ldflags、race、v、work、trimpath。
- **Java/Gradle**：task、configuration、properties、offline、quiet、info、debug、stacktrace、rerun_tasks、exclude_task。
- **Tauri**：Tauri 2 桌面构建相关设置。

### 5.4 配置项「更多操作」菜单

每个自定义配置项的 **⋯** 菜单：

- **收藏 / 取消收藏**。
- **查看配置**（只读）。
- **更新 / 编辑配置**。
- **发布组合**：编辑执行后端（如 `github-actions`）与发布组合，保存后生成新修订。
- **删除配置**（系统默认配置不可删；被外部绑定引用时提示「删除受阻」并跳转编辑）。

`.pubxml` 项目配置项另有：**收藏**、**复制为自定义配置**、**查看配置**。

### 5.5 搜索 / 分组筛选 / 排序

- 中栏搜索框按配置名过滤。
- 顶部下拉「全部 / 默认分组」+ 数量，按分组筛选。
- **⇅** 按钮开启排序，可拖动重排各类配置。

### 5.6 命令导入（从命令创建配置）

1. 中栏顶部**终端图标**「从命令创建配置」（仅 Provider 支持命令导入时显示）。
2. 打开 **CommandImportDialog**：
   - 粘贴构建命令（文本域展示 Provider 示例命令）。
   - 点「解析命令」→ 后端 `importFromCommand` 解析出参数。
   - 展示「提取的参数」JSON 和「解析诊断」。
   - 点「导入参数」→ 自动打开 QuickCreateProfileDialog 预填参数。
3. 导入后右栏显示 **CommandImportResultCard**，列出解析诊断。

### 5.7 配置管理（导入 / 导出 / 保存）

中栏顶部 **Sliders** 按钮 → 「配置管理」，打开 **ConfigDialog**：

- **导出配置**：选择 JSON 路径，导出当前仓库全部配置为备份。
- **导入配置**：选择 JSON 文件，预览待导入清单后确认合并/覆盖。
- **保存当前配置**：输入名称，把当前参数快照保存为可复用配置。
- **已保存的配置**：列表加载（「加载」按钮）或删除。

---

## 6. 执行发布

### 6.1 命令预览

右栏「主页」视图，选中仓库 + 配置后，底部显示 **PublishRunCard**：

- **命令预览**：「将执行的命令:」及其显示命令。
- **本地发布计划**：若需要，展示 plan digest、执行后端、执行阶段（`preparedRuntime.plan.nodes`）。

### 6.2 执行 / 取消

- **执行发布**：点击「执行发布」主按钮，或快捷键 `Cmd/Ctrl+P`。
- **取消发布**：发布中显示「取消发布」按钮。
- 执行前会检查阻断条件（未选仓库 / 未绑定项目 / 运行时未就绪 / 运行时被销毁），有则 toast 提示。

### 6.3 发布状态展示

`PublishRunCard` 显示六种状态：

| 状态     | 图标     | 说明                                                |
| -------- | -------- | --------------------------------------------------- |
| 待执行   | 时钟     | 尚未开始                                            |
| 发布中   | Loader   | 正在执行                                            |
| 成功     | 绿勾     | 显示文件数 + 用时，提供「打开输出目录」「重新发布」 |
| 部分交付 | 黄色三角 | 「部分必需路线交付失败」                            |
| 已取消   | 方块     | 已取消                                              |
| 失败     | 红叉     | 显示失败原因                                        |

发布成功后还可：

- **打开输出目录**：在系统中打开产物目录。
- **打包 ZIP**：选择 zip 路径，生成 zip 并显示 sha256。
- **签名 (GPG)**：对已打包产物生成 detached signature，显示签名路径。
- **发布清单**：打开发布清单核对（见 6.5）。

### 6.4 预检（preflight）

发布前自动运行预检管线：

1. **环境检查**：检测所选 Provider 工具链是否安装。有 **critical** 问题则阻止发布，提示「环境未就绪，已阻止发布」；有 warning 则提示警告。
2. **输出目录预检**：检查输出目录。目录不兼容则阻止；访问被拒（如 macOS 受保护目录）会弹出授权请求对话框，可申请访问权限。

预检报告可经「发布清单」→「导出预检报告」导出为 Markdown / JSON。

### 6.5 发布清单（签名核对）

发布成功后点「发布清单」，打开 **ReleaseChecklistDialog**，5 步核对清单：

1. **环境检查**
2. **发布结果**
3. **产物打包**
4. **签名校验**
5. **Updater 配置**

每步显示状态（通过 / 警告 / 失败 / 待定），支持「上一步 / 下一步」浏览，并可导出预检报告。

---

## 7. 发布历史与重跑

### 7.1 历史视图

右栏顶栏点「历史记录」切换右栏为历史视图，显示 **ExecutionHistoryCard** 的最近执行记录。

### 7.2 筛选维度

- **筛选 Provider**（全部 / 各 Provider）。
- **筛选状态**（全部 / 成功 / 失败 / 已取消）。
- **时间窗口**（全部 / 最近 24 小时 / 最近 7 天 / 最近 30 天）。
- **关键词**（匹配签名 / 错误 / 命令）。
- 「清空筛选」按钮重置。

### 7.3 每条记录的操作

每条记录展示 Provider、状态、项目路径、完成时间、失败原因、警告列表。可执行：

- **打开快照**：在系统中打开执行快照 / 输出目录。
- **重新执行**：从历史记录还原原配置重新发布（不依赖当前选中配置或草稿）。
- 仅成功记录：**复制 Shell 片段**、**复制 GitLab CI 片段**（生成交接片段）。

### 7.4 历史导出

- **导出历史**：把当前筛选的执行历史导出为文件。
- **导出失败分组**：把「失败分组」导出为 bundle（按失败签名聚合，可从失败记录快速重跑）。

---

## 8. 环境诊断

**EnvironmentCheckDialog**（设置 → 「环境检查」分类，或预检被 critical 阻断时自动弹出）：

1. 选择**检查范围**（勾选要检查的 Provider，如 .NET / Cargo / Go / Java / Tauri）。
2. 点「重新检查」运行环境检查，检测各工具链是否安装及版本 / 路径。
3. 汇总**环境状态**：已就绪（绿）/ 存在警告（黄）/ 存在阻断（红）。
4. **工具状态**列表：各 Provider 是否安装 + 版本 + 路径。
5. **发现的问题**按严重级别（critical / warning / info）列出，每个问题可点「修复」：
   - **打开网址**：打开下载 / 修复页面。
   - **复制命令**：复制修复命令到剪贴板。
   - **执行命令**：确认后执行系统命令（有确认框，仅允许受信任的安装命令）。
   - 执行结果可复制。

---

## 9. 设置

左栏底部**齿轮**按钮打开 **SettingsDialog**，左侧分类栏共五类：

### 通用

- **界面语言**：简体中文 / English。
- **执行历史保留上限**：5 ~ 200 条（超出自动修正）。
- **默认发布目录**：支持相对 / 绝对路径，可浏览目录。
- **关闭窗口时最小化到托盘**：开关。

### 外观

- **外观主题**：跟随系统 / 亮色 / 暗色（含主题微缩预览卡片）。

### 环境检查

- 内嵌 EnvironmentCheckContent，可快速进入环境检查。

### 快捷键

- 列出全局快捷键；「查看快捷键」按钮打开 **ShortcutsDialog**。

### 关于

- 当前版本号。
- **更新状态**：检查更新、立即更新、下载进度条、重启应用。
- 若更新通道未配置，提供「打开配置指南」「下载模板文件」。
- **发布日志**（release notes）。

---

## 10. 快捷键

| 快捷键         | 功能                                                   |
| -------------- | ------------------------------------------------------ |
| `Cmd/Ctrl + R` | 刷新项目（校验仓库、非加载、需项目文件后调用扫描项目） |
| `Cmd/Ctrl + P` | 执行发布（若未在发布中且有选中仓库则启动发布）         |
| `Cmd/Ctrl + ,` | 打开设置                                               |

> macOS 显示为 `⌘ R` / `⌘ P` / `⌘ ,`；其他平台为 `Ctrl R` / `Ctrl P` / `Ctrl ,`。

---

## 11. 系统托盘

- **托盘菜单**：
  - **显示主界面**：恢复主窗口。
  - **最近仓库发布**：列出最近仓库（最多 6 个）及其最近的配置（每仓库最多 3 个），点击某项直接触发发布。
  - **退出应用**。
- **托盘状态标题**：空闲 / `发布中…`（带动画点）/ `发布成功` / `发布失败`。
- **托盘快速发布**：监听托盘发布事件，执行发布；成功后打开输出目录，失败则系统通知（通知不可用时恢复主窗口）。
- 设置里的「关闭窗口时最小化到托盘」控制关闭行为。

---

## 12. 自动化绑定与远程发布

中栏底部的 **AutomationBindingsSection**（针对 `tauri` Provider），用于把发布配置绑定到远端的 **GitHub Actions** 自动化：

| 操作                    | 图标          | 说明                                                                                           |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| **绑定自动化**          | GitBranchPlus | 选择发布配置 + 标签前缀（默认 `v`），预览投影差异后确认应用，写入仓库默认分支的自动化 workflow |
| **手动触发**            | Play          | 输入版本号触发远端发布                                                                         |
| **升级修订**            | ArrowUpCircle | 把远端绑定升级到当前配置修订                                                                   |
| **解除绑定**            | Unlink        | 移除自动化绑定                                                                                 |
| **同步远端证据**        | —             | 拉取远端运行证据到本地归档                                                                     |
| **查看 / 取消远端运行** | —             | 查看运行状态、取消远端运行                                                                     |

> 说明：管理远端自动化（绑定预览、升级、解除）属于**发布接入**流程；执行单次发布时不会顺带修改 workflow。托管 workflow 若与绑定不一致会形成「漂移」阻断状态，需通过更新绑定显式协调。

---

## 13. 命令行与开发（CLI / 脚本 / CI）

开发者与运维视角的命令、脚本与 CI 能力。**包管理器为 `pnpm`（10.10.0）**。

### 13.1 开发 / 构建命令

| 命令                           | 作用                                                                          | 输出                                      |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm dev`                     | 完整 Tauri 开发模式（前端 + 后端，热重载）                                    | —                                         |
| `pnpm dev:renderer`            | 仅前端 Vite dev server（端口 3000）                                           | —                                         |
| `pnpm build`                   | 生产构建完整 Tauri 安装包                                                     | `src-tauri/target/release/bundle/`        |
| `pnpm build:renderer`          | 仅前端生产构建                                                                | `dist/`                                   |
| `pnpm build:updater -- [args]` | 生成 updater 生产配置并构建（**CI 实际构建入口**，需 `TAURI_UPDATER_PUBKEY`） | `src-tauri/target/<arch>/release/bundle/` |

### 13.2 契约同步（ts-rs Rust ↔ TS）

| 命令                      | 作用                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `pnpm generate:contracts` | 重新生成 Rust→TS 的共享契约文件 `src/generated/tauri-contracts.ts` |
| `pnpm check:contracts`    | 检查契约是否漂移，不一致则报错                                     |

### 13.3 质量门禁（本地 & CI）

| 命令                                                               | 作用                                        |
| ------------------------------------------------------------------ | ------------------------------------------- |
| `pnpm typecheck`                                                   | TS 类型检查 + 契约校验                      |
| `pnpm lint`                                                        | ESLint                                      |
| `pnpm format` / `pnpm format:check`                                | Prettier 格式化 / 检查                      |
| `pnpm test` / `test:ui` / `test:watch`                             | Vitest 前端单元测试                         |
| `pnpm e2e` / `e2e:ui`                                              | Playwright E2E 测试                         |
| `pnpm check:i18n`                                                  | i18n 覆盖检查（zh/en 键一致、无硬编码中文） |
| `pnpm check:design`                                                | Geist 设计规范合规检查                      |
| `pnpm doctor`                                                      | react-doctor 代码健康检查                   |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | Rust lint                                   |
| `cargo test --manifest-path src-tauri/Cargo.toml`                  | Rust 测试                                   |
| `cargo audit`（src-tauri 下）                                      | Rust 依赖漏洞审计（CI）                     |

### 13.4 发布（核心）

```bash
# 预演（只打印，不落盘 / 不提交 / 不推送）
pnpm release --version 1.2.0 --dry-run
# 等价：pnpm release -v 1.2.0 -d

# 正式发布
pnpm release --version 1.2.0
# 等价：pnpm release -v 1.2.0
```

> **注意**：发布脚本**已移除位置参数**，必须用 `--version` / `-v`；也不要额外写 `--`（脚本会过滤掉它）。

`pnpm release` 的完整流程：

1. 校验：当前分支为 `main`、工作区干净、`v<version>` 标签不存在、当前版本 ≠ 目标版本。
2. 同步四份版本文件：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock`。
3. 生成 `release-notes/v<version>.md`（以 `v` 前缀的上一正式标签为基线，自动归类提交）。
4. 运行发布前校验：`pnpm typecheck`、`pnpm test:workflow`、`pnpm test:updater`、`pnpm test:release`。
5. 提交 `chore(release): publish v<version>`（仅含版本文件 + release notes）。
6. 打 `v<version>` 标签，`git push origin main` 再 `git push origin v<version>`。
7. 等待 GitHub Actions `build-release` workflow（最长发现 5 分钟、完成 2 小时）。
8. 汇总每个 job 结果；有失败则拉取注解与日志并以非 0 退出。

### 13.5 GitHub Actions 流水线

| Workflow         | 触发                  | 作用                                                                                                                                                                                                                                |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-release`  | 手动 + 推送 `v*` 标签 | 构建 macOS（aarch64/x86_64/universal）、Windows、Linux 五套安装包 → 组装 updater 资产 → 生成 `latest.json` → 创建 GitHub Release 并上传公开附件（含 `.app.tar.gz`、`.dmg`、`.exe`、`.AppImage`、`.deb`，不含 `.sig`/`.rpm`/`.msi`） |
| `quality`        | PR + 推送 main        | 前后端质量门禁（tsc/lint/format/test/i18n/design + cargo clippy/test/contracts/audit）                                                                                                                                              |
| `runner-release` | 推送 `runner-v*` 标签 | 构建 4 个 target 的 `one-publish-runner` 二进制，上传 `.tar.gz` + `.sha256`                                                                                                                                                         |

---

## 14. 常见问题与排障

- **发布按钮不可用**：检查是否已选中仓库 + 已绑定项目 + 运行时已就绪（未选仓库 / 未绑定项目 / 运行时未就绪 / 运行时被销毁都会阻断并 toast 提示）。
- **环境未就绪**：预检的 critical 环境问题会阻止发布。进入「设置 → 环境检查」检测工具链，按「修复」指引安装缺失 SDK / 运行时。
- **输出目录访问被拒**：macOS 受保护目录会弹出授权请求对话框，按提示申请访问权限。
- **配置含多个项目文件无法保存**：先在编辑仓库对话框里显式绑定 Project File。
- **「检查更新」提示更新源未配置**：说明 updater 未配置，参见 `docs/updater/SETUP.md` 配置 `TAURI_UPDATER_PUBKEY` 与 endpoint。
- **发布脚本报「工作区不干净」**：先提交或清理改动，再运行 `pnpm release`。
- **发布脚本报「已移除位置参数」**：改用 `pnpm release --version <V>`。

---

## 15. 术语速查

| 术语                                 | 含义                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| **仓库 / Repository**                | 你在 OnePublish 中管理的一个项目目录                              |
| **项目候选 / Project Candidate**     | 仓库中发现的可发布项目入口（如 `.sln`、`Cargo.toml`、`go.mod`）   |
| **Provider**                         | 语言 / 框架类型（.NET、Cargo、Go、Java、Tauri）                   |
| **发布配置 / Profile**               | 一次发布所需的参数集合（可保存为命名配置）                        |
| **发布来源 / PublishSource**         | 发布配置的来源：命名配置修订 / 草稿 / 模板 / 项目 profile / 历史  |
| **发布运行时 / PublishRuntime**      | 统一准备与执行发布的链路（prepare → start → 日志 → 结果）         |
| **预检 / Preflight**                 | 发布前自动检查（环境 + 输出目录）                                 |
| **产物 / Artifact**                  | 同次构建产生、可共同验证和交付的文件集合                          |
| **发布清单 / Manifest**              | 定义产物集合身份的版本化清单                                      |
| **执行后端 / Execution Backend**     | 运行发布计划的环境（本机 `local` 或 `github-actions`）            |
| **交付路线 / Delivery Route**        | 配置中对某个交付目标的一份命名设置（本地目录、GitHub Release 等） |
| **自动化绑定 / Automation Binding**  | 把发布配置的固定修订 + 执行后端安装为远程托管自动化               |
| **托管 workflow / Managed Workflow** | 由 OnePublish 根据自动化绑定生成并维护的仓库自动化                |
| **发布尝试 / Attempt**               | 一次可跨重启持续追踪的发布过程                                    |
| **发布门禁 / Release Gate**          | 不可逆副作用前的结构化验证节点                                    |

---

<div align="center">

© 2026 OnePublish · 基于 `v1.0.0` 整理

</div>
