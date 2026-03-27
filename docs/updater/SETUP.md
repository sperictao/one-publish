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
- `bundle.createUpdaterArtifacts` 需要开启，release 工作流会上传 `latest.json`、updater 包和 `.sig`。
