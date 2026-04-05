# GitHub Release 一键发布

## 目标

仓库提供一条本地命令，完成下面整套动作：

1. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock` 版本
2. 自动生成 `release-notes/<tag>.md`
3. 运行最小校验：`pnpm typecheck`、`pnpm test:workflow`、`pnpm test:updater`
4. 提交发布 commit
5. 创建并推送 tag
6. 触发 GitHub Actions 构建多平台安装包并创建 GitHub Release
7. 本地命令持续等待远端 workflow 完成，并回显每个 job 的最终状态

## 使用方式

正式发布：

```bash
pnpm release --version 0.2.1
# 或
pnpm release -v 0.2.1
```

预演发布内容（不改文件、不提交、不推送）：

```bash
pnpm release --version 0.2.1 --dry-run
# 或
pnpm release -v 0.2.1 -d
```

> 说明：位置参数方式已移除，必须显式传入 `--version` 或 `-v`。不需要额外写 `--`。

## 前置条件

- 当前分支必须是 `main`
- 工作区必须干净
- 本地已安装依赖：`pnpm install`
- 本地具备远端仓库 push 权限
- 本地能够访问 GitHub API；建议提前配置 `GH_TOKEN` / `GITHUB_TOKEN`，或执行 `gh auth login`

## Release Notes 规则

- 发布说明文件位于 `release-notes/<tag>.md`
- 文件内容由脚本根据上一条 tag 之后的提交自动生成
- 生成内容包含：
  - 发布日期
  - 版本标签
  - 对比范围
  - 按提交类型分组的变更摘要
- GitHub Actions 在 release job 中读取该文件，并作为 GitHub Release 的正文

## 远端工作流行为

tag 推送后，`.github/workflows/build-release.yml` 会：

1. 构建 macOS / Windows / Linux 安装包
2. 收集 updater 必需产物到 `updater-assets`
3. 读取 `release-notes/<tag>.md`
4. 用同一份 `release-notes/<tag>.md` 生成 `updater-assets/latest.json`
5. 组装公开的 `release-assets`
6. 创建同名 GitHub Release 并上传附件

公开 release 页面默认只保留这几类文件：

- `latest.json`
- macOS `*aarch64*.app.tar.gz`
- macOS `*x64*.app.tar.gz`
- macOS `*aarch64*.dmg`
- macOS `*x64*.dmg`
- macOS `*universal*.dmg`
- Windows `*-setup.exe`
- Linux `*.AppImage`
- Linux `*.deb`

`*.sig` 仅用于 manifest 生成与签名校验，不再公开上传。

本地 `pnpm release` 命令会继续轮询这次 `build-release` run，直到：

- 每个 job 都进入最终状态
- 控制台输出每个 job 的成功 / 失败结果
- 若有失败 job，进一步输出失败步骤、annotation 和日志摘录

## 常见失败点

- 工作区不干净：先提交或清理本地改动
- 不在 `main` 分支：切回 `main`
- tag 已存在：换新版本号
- `pnpm typecheck`、`pnpm test:workflow` 或 `pnpm test:updater` 失败：先修复再发版
- `pnpm test:release` 失败：先修复 release 脚本等待 / 汇总逻辑
- 远端 push 失败：确认 GitHub 权限或分支保护规则
- GitHub API 查询失败或被限流：补 `GH_TOKEN` / `GITHUB_TOKEN`，或重新执行 `gh auth login`

## 发布后检查

- GitHub Actions：`Actions` 页面确认 `build-release` 成功
- GitHub Releases：确认 tag、release notes、附件齐全，且页面不再出现 `*.sig`、`*.rpm`、`*.msi`
- 本地版本文件与 release tag 一致
- 若命令本身返回非 0，请优先查看控制台里输出的失败 job 链接、annotation 和日志摘录
