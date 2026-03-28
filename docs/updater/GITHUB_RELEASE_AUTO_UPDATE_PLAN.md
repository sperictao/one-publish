# GitHub Release 自动更新接入计划

> 注意：本文是历史规划文档，部分公开资产清单已过时。当前实现请以
> `build-release.yml`、`docs/updater/SETUP.md` 与
> `docs/release/GITHUB_RELEASE.md` 为准。
>
> 当前公开 release 页面默认只保留 `latest.json`、macOS
> `aarch64/x64 .app.tar.gz`、`aarch64/x64/universal .dmg`、Windows `.msi`、
> Linux `.AppImage` / `.deb`；`*.sig` 仅用于 manifest 生成与签名校验，
> 不再公开上传。

## 文档目标

本计划用于收敛 OnePublish 基于 **GitHub Release + Tauri Updater**
的自动更新方案，明确：

1. 要解决的问题
2. 当前仓库基线
3. 目标架构与更新链路
4. 具体实施步骤
5. 验收方式
6. 风险与回滚策略

本文档面向后续维护者、发布负责人和实现该方案的工程人员。

---

## 背景

当前 OnePublish 已具备以下 updater 基础能力：

- Tauri 侧已注册 `tauri-plugin-updater`
- 前端设置页已存在“检查更新 / 更新”入口
- 后端已提供：
  - `check_update`
  - `install_update`
  - `get_updater_config_health`
  - `get_updater_help_paths`
  - `open_updater_help`

但仅有这些还不够形成完整更新闭环。要让客户端真正从 GitHub
获取最新版本并完成安装，还需要补齐：

- updater 生产配置
- updater 产物生成
- GitHub Release 资产组织
- `latest.json` 生成
- 签名链路
- 启动时自动检查更新

---

## 目标

### 产品目标

- 应用启动时自动检查最新正式版
- 发现新版本后提示用户更新
- 用户可在“设置 > 关于”中查看版本、更新说明并执行安装
- 更新包从 GitHub Release 下载
- 安装过程由 Tauri Updater 完成签名校验

### 工程目标

- 不自写 GitHub Release 版本比较逻辑
- 继续复用现有 Tauri updater 接口
- 保持开发环境未配置 updater 时也不会崩溃
- 将更新链路标准化到现有 release workflow 中

---

## 非目标

本计划 **不包含** 以下内容：

- 预发布通道（beta / rc）切换
- 静默后台下载
- 强制自动重启
- 自建更新服务器
- 额外的版本灰度策略
- 移动端或 Web 端更新能力

---

## 当前仓库基线

截至本计划落地时，仓库内与 updater 相关的关键位置如下：

- `src-tauri/src/commands/updater.rs`
  - 已有检查更新、安装更新、配置健康检查等命令
- `src/components/layout/SettingsDialog.tsx`
  - 已有版本信息与手动检查更新 UI
- `src/hooks/useAppUpdater.ts`
  - 应用级 updater 状态与启动自动检查逻辑
- `src-tauri/tauri.conf.json`
  - 开发环境默认空 updater 配置
- `src-tauri/tauri.conf.updater.example.json`
  - updater 生产配置模板
- `.github/workflows/build-release.yml`
  - GitHub Release 多平台构建工作流
- `scripts/generate-updater-config.mjs`
  - 生成 updater 生产 overlay
- `scripts/generate-latest-json.mjs`
  - 生成 GitHub Release 使用的 `latest.json`
- `docs/updater/SETUP.md`
  - updater 配置说明
- `docs/release/GITHUB_RELEASE.md`
  - GitHub Release 发布说明

---

## 目标方案概览

### 核心原则

- **更新源固定为 GitHub Release 的 `latest.json`**
- **版本比较交给 Tauri Updater**
- **只跟踪 stable release**
- **安装由用户确认触发**

### 更新链路

```text
应用启动
  -> useAppUpdater 自动调用 check_update
  -> Tauri Updater 读取 latest.json
  -> 比较当前版本与远端版本
  -> 若有新版本，前端弹提示
  -> 用户打开 设置 > 关于
  -> 用户点击 更新
  -> install_update 下载 GitHub Release 资产
  -> 使用 minisign 公钥校验签名
  -> 安装完成
  -> 用户手动重启应用生效
```

---

## 更新源设计

### 远端入口

默认更新入口固定为：

```text
https://github.com/sperictao/one-publish/releases/latest/download/latest.json
```

### `latest.json` 结构

使用 Tauri Updater v2 的静态 `platforms` 结构：

```json
{
  "version": "0.2.0",
  "notes": "release notes",
  "pub_date": "2026-03-28T00:00:00.000Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "base64-signature",
      "url": "https://github.com/.../OnePublish_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "base64-signature",
      "url": "https://github.com/.../OnePublish_0.2.0_x64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "base64-signature",
      "url": "https://github.com/.../OnePublish_0.2.0_x64_en-US.msi.zip"
    },
    "linux-x86_64": {
      "signature": "base64-signature",
      "url": "https://github.com/.../OnePublish_0.2.0_amd64.AppImage.tar.gz"
    }
  }
}
```

### 版本通道规则

- 仅使用正式版 tag / release
- 默认忽略 prerelease / draft
- `latest.json` 只指向当前 stable 发布

---

## 配置设计

### 开发环境

开发环境保留空 updater 配置：

```json
"plugins": {
  "updater": {
    "pubkey": "",
    "endpoints": []
  }
}
```

目的：

- 本地开发不依赖真实更新源
- 手动点“检查更新”时返回可读提示
- 不影响开发构建与调试

### 生产环境

生产环境使用 overlay 配置，包含：

- `bundle.createUpdaterArtifacts: true`
- `plugins.updater.pubkey`
- `plugins.updater.endpoints`

生产配置不直接提交真实公钥，统一通过环境变量生成：

- `TAURI_UPDATER_PUBKEY`
- `TAURI_UPDATER_ENDPOINT`（可选）

---

## Secrets 与环境变量

### 本地 / CI 共用

- `TAURI_UPDATER_PUBKEY`

### CI 发布必需

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（如有）

### 说明

- `TAURI_UPDATER_PUBKEY` 用于客户端校验更新包签名
- `TAURI_SIGNING_PRIVATE_KEY` 用于构建时生成 updater 资产签名
- 公钥和私钥必须匹配，否则安装阶段会失败

---

## 前端实现计划

### 目标

将 updater 状态从“设置页局部逻辑”提升为“应用级共享状态”。

### 实现方式

新增 `src/hooks/useAppUpdater.ts`，统一负责：

- 获取当前版本
- 检查更新
- 安装更新
- 获取 updater 配置健康状态
- 获取 updater 帮助路径
- 打开 updater 指南
- 启动时自动检查

### 交互规则

#### 启动自动检查

- 仅在 `isTauri()` 为真时触发
- 应用启动后只检查一次
- 有更新时弹 toast
- 无更新时不提示
- 失败时静默，不打扰用户

#### 设置页手动检查

- 点击“检查更新”时主动刷新状态
- 无更新时显示“没有可用的更新”
- 失败时显示错误消息
- 若未配置 updater，则展示帮助路径与快速打开入口

#### 安装更新

- 用户点击“更新”后触发安装
- 成功后显示“请重启应用以生效”
- 不执行强制自动重启

---

## 后端实现计划

### 保持现有命令边界

继续复用：

- `check_update`
- `install_update`
- `get_updater_config_health`
- `get_updater_help_paths`
- `open_updater_help`
- `get_current_version`

### 后端侧要求

- 开发态未配置 updater 时，返回可读错误，不 panic
- 安装失败时返回明确错误描述
- 安装成功时返回用户可理解的完成提示

---

## 发布工作流计划

### release workflow 目标

在现有 GitHub Actions 流水线上补齐 updater 所需资产。

### build job

构建阶段切到：

```bash
pnpm build:updater -- <tauri_args>
```

这样会：

1. 生成 `src-tauri/tauri.conf.updater.prod.json`
2. 校验 updater 配置
3. 用 updater 生产配置构建
4. 产出 updater 资产与签名

### release job

release job 需要：

1. 下载所有 bundle artifacts
2. 收集普通安装包 + updater 包 + `.sig`
3. 生成 `release-assets/latest.json`
4. 读取 `release-notes/<tag>.md`
5. 创建 GitHub Release
6. 上传 `release-assets` 下全部文件

---

## 资产组织规则

### release-assets 中应包含

- 普通安装包
  - `.dmg`
  - `.msi`
  - `*-setup.exe`
  - `.AppImage`
  - `.deb`
  - `.rpm`

- updater 资产
  - `.app.tar.gz`
  - `.msi.zip`
  - `*-setup.exe.zip`
  - `.AppImage.tar.gz`

- 对应签名
  - `*.sig`

- 远端 manifest
  - `latest.json`

### `latest.json` 生成规则

- `version`：当前 tag 去掉 `v`
- `notes`：默认可为空；后续可扩展为 release notes 摘要
- `pub_date`：生成时的 UTC 时间
- `platforms`：从 `release-assets` 中自动匹配

---

## 版本管理规则

发布前必须保持以下版本一致：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.lock`

### 约束

- 不允许前端版本和 Tauri 版本分裂
- GitHub tag 必须与版本文件一致
- 客户端展示版本以 Tauri 实际版本为准

---

## 实施步骤

### 阶段 1：版本与配置收口

- 统一版本号
- 更新 updater 模板配置
- 增加 `generate-updater-config.mjs`
- 更新配置文档

### 阶段 2：前端 updater 状态提升

- 新增 `useAppUpdater`
- 在 `App.tsx` 挂应用级 updater hook
- 设置页改为消费共享 updater 状态
- 启动时自动检查更新

### 阶段 3：工作流接线

- 构建步骤切到 `build:updater`
- 注入 updater / signing secrets
- 收集 updater 资产与 `.sig`
- 生成 `latest.json`
- 将全部资产上传到 GitHub Release

### 阶段 4：测试与验收

- 类型检查
- workflow 静态断言
- 配置脚本烟测
- `latest.json` 生成脚本烟测
- 真实 tag / release 验收

---

## 验收标准

### 本地静态验证

- `pnpm typecheck` 通过
- `pnpm test:workflow` 通过
- `generate-updater-config.mjs` 可生成有效 overlay
- `generate-latest-json.mjs` 可产出合法 `latest.json`

### 真实发布验证

以旧版本客户端验证：

1. 启动应用后自动检测到新版本
2. 设置页能显示：
   - 当前版本
   - 新版本
   - 更新说明
3. 点击“更新”后能下载 GitHub Release 中的 updater 资产
4. 签名校验通过
5. 安装成功
6. 重启后版本更新成功

### 开发环境回归

- 开发环境空 updater 配置下不崩溃
- 手动检查更新时可看到清晰提示
- 非 Tauri 环境不触发自动检查错误

---

## 失败场景与处理策略

### 1. 未配置公钥

现象：

- `build:updater` 失败
- 设置页显示“更新源未配置”

处理：

- 补 `TAURI_UPDATER_PUBKEY`
- 重新生成 updater 生产配置

### 2. 未配置签名私钥

现象：

- CI 构建 updater 产物失败
- 无法生成 `.sig`

处理：

- 在 GitHub Actions secrets 中补：
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 3. `latest.json` 与 Release 资产不匹配

现象：

- 客户端检测到新版本但安装失败
- 平台 key 存在，URL 404 或签名不匹配

处理：

- 检查 `release-assets` 文件名
- 检查 `latest.json` 生成规则
- 核对 `.sig` 与目标文件是否一一对应

### 4. GitHub Release 上传成功但客户端无更新

现象：

- 客户端始终提示当前已是最新版本

处理：

- 确认 tag 版本高于当前客户端版本
- 确认 `latest.json` 已上传到 `releases/latest/download/latest.json`
- 确认客户端读取的是 stable release

---

## 回滚策略

若发布后发现 updater 链路异常，可按以下顺序回滚：

1. 暂停继续发新 tag
2. 修复或删除错误的 `latest.json`
3. 若需要，重新创建同版本 GitHub Release 资产
4. 保持客户端手动检查仍可给出可读错误，而不是崩溃

> 原则：优先让“检查更新失败但应用可正常使用”，而不是让更新逻辑影响主功能。

---

## 维护建议

- updater 相关说明集中维护在：
  - `docs/updater/SETUP.md`
  - `docs/updater/GITHUB_RELEASE_AUTO_UPDATE_PLAN.md`
  - `docs/release/GITHUB_RELEASE.md`

- 每次改动 release workflow 时，同步更新：
  - `scripts/test-build-release-workflow.mjs`

- 每次改动 updater 资产命名规则时，同步更新：
  - `scripts/generate-latest-json.mjs`

---

## 建议执行顺序

### 首次上线

1. 配好 GitHub secrets
2. 本地执行：

```bash
pnpm typecheck
pnpm test:workflow
```

3. 创建测试版本 tag
4. 等待 GitHub Actions 完成
5. 用旧版本客户端验证自动更新

### 后续每次发布

1. 统一版本号
2. 生成 release notes
3. 创建 tag
4. 等待 workflow 构建并生成 GitHub Release
5. 验证 `latest.json` 与资产完整性

---

## 当前状态

截至本计划文档生成时，仓库已完成：

- updater 应用级状态管理
- 启动自动检查
- GitHub Release `latest.json` 生成脚本
- updater 生产配置生成脚本
- workflow 侧 updater 资产收集与 manifest 生成
- 类型检查与 workflow 断言验证

剩余实际上线动作主要是：

- 配置真实 secrets
- 触发真实 tag 发布
- 完成旧版本到新版本的安装验证

---

## 附录：相关文档

- `docs/updater/SETUP.md`
- `docs/release/GITHUB_RELEASE.md`
- `.github/workflows/build-release.yml`
- `scripts/generate-updater-config.mjs`
- `scripts/generate-latest-json.mjs`
