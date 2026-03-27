# OnePublish

跨平台 .NET 项目发布工具，提供图形化界面来执行 `dotnet publish` 命令。

## 技术栈

- **前端**: React 18 + TypeScript + Vite 7
- **样式**: TailwindCSS 3 + shadcn/ui 组件
- **桌面框架**: Tauri 2.x (Rust)
- **图标**: Lucide React
- **通知**: Sonner

## 功能特性

- 🔍 **自动检测项目** - 自动扫描 .sln 和 .csproj 文件
- 📋 **预设配置** - 支持多种预设发布配置（Release/Debug, 多平台）
- 📁 **发布配置文件** - 支持从 PublishProfiles 读取自定义配置
- ⚙️ **自定义模式** - 支持完全自定义发布参数
- 📊 **实时日志** - 显示发布过程的输出日志
- 🎨 **现代 UI** - macOS 风格的现代界面设计

## 开发

### 前置要求

- Node.js 18+
- pnpm
- Rust 1.77+
- .NET SDK (用于执行 dotnet publish)

### 安装依赖

```bash
cd one-publish
pnpm install
```

### 开发模式

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm build
```

## 项目结构

```
one-publish/
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   │   └── ui/            # shadcn/ui 组件
│   ├── lib/               # 工具函数
│   ├── App.tsx            # 主应用组件
│   ├── main.tsx           # 入口文件
│   └── index.css          # 全局样式
├── src-tauri/             # Tauri 后端
│   ├── src/
│   │   ├── main.rs        # 主入口
│   │   ├── lib.rs         # 库入口
│   │   └── commands.rs    # Tauri 命令
│   ├── Cargo.toml         # Rust 依赖
│   └── tauri.conf.json    # Tauri 配置
├── package.json           # 前端依赖
├── vite.config.ts         # Vite 配置
├── tailwind.config.cjs    # TailwindCSS 配置
└── tsconfig.json          # TypeScript 配置
```

## 设计理念

- 产品/工程设计理念：`docs/design-philosophy.md`
- 渐进式升级路线图：`docs/roadmap/MASTER_PLAN.md`

## 使用方法

1. 启动应用后，会自动扫描当前目录下的 .NET 项目
2. 也可以点击"选择目录"手动选择项目目录
3. 选择预设发布配置或切换到自定义模式
4. 点击"执行发布"开始发布过程
5. 查看输出日志了解发布结果

## Updater（更新管线）

- 配置说明：`docs/updater/SETUP.md`
- 生产模板：`src-tauri/tauri.conf.updater.example.json`

## GitHub Release

- 一键发布说明：`docs/release/GITHUB_RELEASE.md`
- 命令示例：`pnpm release --version 0.2.1` 或 `pnpm release -v 0.2.1`

## 许可证

MIT
