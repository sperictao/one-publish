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

1. 复制示例配置：

```bash
cp src-tauri/tauri.conf.updater.example.json src-tauri/tauri.conf.updater.prod.json
```

2. 将 `pubkey` 替换为你发布系统使用的 minisign 公钥。
3. 将 `endpoints` 替换为你的更新 JSON 服务地址（建议 HTTPS）。
4. 构建时叠加配置（命令会先校验 updater 配置）：

```bash
pnpm build:updater
```

## 说明

- `pubkey` 与 `endpoints` 缺失时，后端会返回“更新源未配置”提示。
- 若使用非 HTTPS 地址，release 构建会被 updater 插件拦截。
