export const updaterManifestAssets = [
  {
    platform: "darwin-aarch64",
    label: "macOS aarch64 updater 包",
    patterns: [
      { includes: ["aarch64"], endsWith: ".app.tar.gz" },
      { includes: ["arm64"], endsWith: ".app.tar.gz" },
    ],
  },
  {
    platform: "darwin-x86_64",
    label: "macOS x64 updater 包",
    patterns: [
      { includes: ["x64"], endsWith: ".app.tar.gz" },
      { includes: ["x86_64"], endsWith: ".app.tar.gz" },
    ],
  },
  {
    platform: "windows-x86_64",
    label: "Windows MSI updater 包",
    patterns: [
      { includes: ["x64"], endsWith: ".msi" },
      { includes: ["x86_64"], endsWith: ".msi" },
      { endsWith: ".msi" },
    ],
  },
  {
    platform: "linux-x86_64",
    label: "Linux AppImage updater 包",
    patterns: [
      { includes: ["amd64"], endsWith: ".AppImage" },
      { includes: ["x86_64"], endsWith: ".AppImage" },
      { endsWith: ".AppImage" },
    ],
  },
];

export const workflowUpdaterAssetRules = [
  {
    fragment:
      "copy_single_as ./artifacts/bundles-macos-aarch64 '*.app.tar.gz' \"./updater-assets/OnePublish_${version}_aarch64.app.tar.gz\"",
    message: "updater 资产未固定选取 macOS aarch64 tarball。",
  },
  {
    fragment:
      "copy_single_as ./artifacts/bundles-macos-aarch64 '*.app.tar.gz.sig' \"./updater-assets/OnePublish_${version}_aarch64.app.tar.gz.sig\"",
    message: "updater 资产未收集 macOS aarch64 签名。",
  },
  {
    fragment:
      "copy_single_as ./artifacts/bundles-macos-x86_64 '*.app.tar.gz' \"./updater-assets/OnePublish_${version}_x64.app.tar.gz\"",
    message: "updater 资产未固定选取 macOS x64 tarball。",
  },
  {
    fragment:
      "copy_single_as ./artifacts/bundles-macos-x86_64 '*.app.tar.gz.sig' \"./updater-assets/OnePublish_${version}_x64.app.tar.gz.sig\"",
    message: "updater 资产未收集 macOS x64 签名。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-windows '*.msi' ./updater-assets",
    message: "updater 资产未固定选取 Windows msi。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-windows '*.msi.sig' ./updater-assets",
    message: "updater 资产未收集 Windows msi 签名。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-linux '*.AppImage' ./updater-assets",
    message: "updater 资产未固定选取 Linux AppImage。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-linux '*.AppImage.sig' ./updater-assets",
    message: "updater 资产未收集 Linux AppImage 签名。",
  },
];

export const workflowReleaseAssetRules = [
  {
    fragment: "copy_single ./updater-assets latest.json ./release-assets",
    message: "release 资产未包含 latest.json。",
  },
  {
    fragment: "copy_single ./updater-assets '*aarch64.app.tar.gz' ./release-assets",
    message: "release 资产未包含 macOS aarch64 updater tarball。",
  },
  {
    fragment: "copy_single ./updater-assets '*x64.app.tar.gz' ./release-assets",
    message: "release 资产未包含 macOS x64 updater tarball。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-macos-aarch64 '*aarch64*.dmg' ./release-assets",
    message: "release 资产未包含 macOS aarch64 dmg。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-macos-x86_64 '*x64*.dmg' ./release-assets",
    message: "release 资产未包含 macOS x64 dmg。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-macos-universal '*universal*.dmg' ./release-assets",
    message: "release 资产未固定选取 macOS universal dmg。",
  },
  {
    fragment: "copy_single ./updater-assets '*.msi' ./release-assets",
    message: "release 资产未包含 Windows msi。",
  },
  {
    fragment: "copy_single ./updater-assets '*.AppImage' ./release-assets",
    message: "release 资产未包含 Linux AppImage。",
  },
  {
    fragment: "copy_single ./artifacts/bundles-linux '*.deb' ./release-assets",
    message: "release 资产未包含 Linux deb。",
  },
];
