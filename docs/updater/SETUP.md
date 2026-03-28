# Updater 配置指南

OnePublish 已接入 Tauri v2 Updater 插件。

## 开发环境（默认）

当前 `src-tauri/tauri.conf.json` 里 updater 使用空配置：

```json
"plugins": {
  "updater": {
    "pubkey": "",
    "endpoints": []
  }
}
```

这会让“检查更新”返回可读提示，不会导致应用崩溃。

## 生产环境配置

1. 准备 updater 使用的 minisign 公钥，并写入环境变量：

```bash
export TAURI_UPDATER_PUBKEY='YOUR_MINISIGN_PUBKEY'
```

2. 如需覆盖默认 GitHub Release 更新地址，可额外设置：

```bash
export TAURI_UPDATER_ENDPOINT='https://github.com/sperictao/one-publish/releases/latest/download/latest.json'
```

3. 构建时会自动生成生产 overlay，并先校验 updater 配置：

```bash
pnpm build:updater
```

生成的 `src-tauri/tauri.conf.updater.prod.json` 为本地产物，
已加入 `.gitignore`，不要手动提交。

4. CI 还需要配置：
   - `TAURI_UPDATER_PUBKEY`
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（如私钥有密码）

## 说明

- `pubkey` 与 `endpoints` 缺失时，后端会返回“更新源未配置”提示。
- 默认更新源为 GitHub Release 的 `latest.json`：

```text
https://github.com/sperictao/one-publish/releases/latest/download/latest.json
```

- 若使用非 HTTPS 地址，release 构建会被 updater 插件拦截。
- `bundle.createUpdaterArtifacts` 需要开启，release 工作流会先收集 updater 包和 `.sig` 生成 `latest.json`，再只公开上传 `latest.json` 与需要对外分发的安装包。
- `.sig` 只作为 manifest 生成与签名校验输入，不再出现在公开 GitHub Release 页面。
- macOS 自动更新现在会分别引用公开的 `aarch64` / `x64` `.app.tar.gz`，而 `universal.dmg` 仅用于手动下载。
- `latest.json` 的 `notes` 会复用 `release-notes/<tag>.md`，设置页中的“更新说明”也来自这里。
