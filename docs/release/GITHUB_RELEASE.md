# GitHub Release 一键发布

## 目标

仓库提供一条本地命令，完成下面整套动作：

1. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock` 版本
2. 自动生成 `release-notes/<tag>.md`
3. 运行最小校验：`pnpm typecheck`、`pnpm test:workflow`
4. 提交发布 commit
5. 创建并推送 tag
6. 触发 GitHub Actions 构建多平台安装包并创建 GitHub Release

## 使用方式

正式发布：

```bash
pnpm release -- 0.2.1
```

预演发布内容（不改文件、不提交、不推送）：

```bash
pnpm release -- 0.2.1 --dry-run
```

## 前置条件

- 当前分支必须是 `main`
- 工作区必须干净
- 本地已安装依赖：`pnpm install`
- 本地具备远端仓库 push 权限

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
2. 汇总产物到 `release-assets`
3. 读取 `release-notes/<tag>.md`
4. 创建同名 GitHub Release 并上传附件

## 常见失败点

- 工作区不干净：先提交或清理本地改动
- 不在 `main` 分支：切回 `main`
- tag 已存在：换新版本号
- `pnpm typecheck` 或 `pnpm test:workflow` 失败：先修复再发版
- 远端 push 失败：确认 GitHub 权限或分支保护规则

## 发布后检查

- GitHub Actions：`Actions` 页面确认 `build-release` 成功
- GitHub Releases：确认 tag、release notes、附件齐全
- 本地版本文件与 release tag 一致
