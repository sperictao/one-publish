import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildTauriBuildArgs,
  getPnpmCommand,
  getPnpmRunOptions,
  normalizeForwardedArgs,
} from "./build-updater.mjs";

const rootDir = process.cwd();
const defaultUpdaterEndpoint =
  "https://github.com/sperictao/one-publish/releases/latest/download/latest.json";

function fail(message) {
  throw new Error(message);
}

function ensure(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.error) {
    fail(`执行 ${command} 失败：${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    fail(
      `执行 ${command} ${args.join(" ")} 失败：${stderr || stdout || `退出码 ${result.status}`}`
    );
  }

  return result;
}

function runExpectFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.error) {
    fail(`执行 ${command} 失败：${result.error.message}`);
  }

  if (result.status === 0) {
    fail(`执行 ${command} ${args.join(" ")} 应失败但成功了。`);
  }

  return `${result.stderr || ""}${result.stdout || ""}`;
}

function getCargoMetadata() {
  const result = run("cargo", [
    "metadata",
    "--manifest-path",
    path.join(rootDir, "src-tauri", "Cargo.toml"),
    "--no-deps",
    "--format-version",
    "1",
  ]);

  return JSON.parse(result.stdout);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "one-publish-updater-"));

try {
  const windowsConfigPath = path.join(rootDir, "src-tauri", "tauri.windows.conf.json");
  const windowsConfig = JSON.parse(fs.readFileSync(windowsConfigPath, "utf8"));
  ensure(
    JSON.stringify(windowsConfig.bundle?.targets) === JSON.stringify(["nsis"]),
    "Windows 平台配置未固定为 NSIS installer。"
  );

  const cargoMetadata = getCargoMetadata();
  const packageMetadata = cargoMetadata.packages.find(
    (entry) => entry.manifest_path === path.join(rootDir, "src-tauri", "Cargo.toml")
  );
  ensure(packageMetadata, "未找到 src-tauri Cargo package 元数据。");

  const binTargets = packageMetadata.targets
    .filter((target) => Array.isArray(target.kind) && target.kind.includes("bin"))
    .map((target) => target.name);
  ensure(
    JSON.stringify(binTargets) === JSON.stringify(["one-publish"]),
    `src-tauri app package 不应暴露额外 bin target，当前为：${binTargets.join(", ") || "(none)"}。`
  );

  const forwardedArgs = normalizeForwardedArgs(["--", "--target", "universal-apple-darwin"]);
  ensure(
    JSON.stringify(forwardedArgs) === JSON.stringify(["--target", "universal-apple-darwin"]),
    "build-updater 未正确清理 pnpm 透传参数里的独立分隔符。"
  );

  const tauriBuildArgs = buildTauriBuildArgs(["--", "--target", "universal-apple-darwin"]);
  ensure(
    JSON.stringify(tauriBuildArgs) ===
      JSON.stringify([
        "tauri",
        "build",
        "--config",
        "src-tauri/tauri.conf.updater.prod.json",
        "--target",
        "universal-apple-darwin",
      ]),
    "build-updater 未把 target 作为 Tauri CLI 参数拼接。"
  );
  ensure(
    !tauriBuildArgs.includes("--"),
    "build-updater 错误地把参数留在 Cargo runner 分隔符之后。"
  );

  ensure(getPnpmCommand("win32") === "pnpm", "Windows 下应通过 shell 调用 pnpm。");
  ensure(getPnpmRunOptions("win32").shell === true, "Windows 下应开启 shell 运行 pnpm。");
  ensure(getPnpmRunOptions("darwin").shell === false, "非 Windows 下不应开启 shell。");

  const configPath = path.join(tempDir, "tauri.conf.updater.prod.json");
  const releaseAssetsDir = path.join(tempDir, "release-assets");
  const latestJsonPath = path.join(releaseAssetsDir, "latest.json");
  const notesPath = path.join(tempDir, "release-notes.md");
  const releaseNotes = [
    "# OnePublish v0.2.0",
    "",
    "- 发布日期：2026-03-28",
    "- 版本标签：`v0.2.0`",
    "",
    "## 变更摘要",
    "",
    "### 新功能",
    "- 接入 GitHub Release 自动更新",
  ].join("\n");

  run(process.execPath, ["scripts/generate-updater-config.mjs", configPath], {
    env: {
      ...process.env,
      TAURI_UPDATER_PUBKEY: "test-minisign-pubkey",
    },
  });
  run(process.execPath, ["scripts/validate-updater-config.mjs", configPath]);

  const updaterConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  ensure(
    updaterConfig.bundle?.createUpdaterArtifacts === true,
    "generate-updater-config 未开启 createUpdaterArtifacts。"
  );
  ensure(
    updaterConfig.plugins?.updater?.pubkey === "test-minisign-pubkey",
    "generate-updater-config 未写入 pubkey。"
  );
  ensure(
    updaterConfig.plugins?.updater?.endpoints?.[0] === defaultUpdaterEndpoint,
    "generate-updater-config 未写入默认 GitHub Release endpoint。"
  );

  fs.mkdirSync(releaseAssetsDir, { recursive: true });
  fs.writeFileSync(notesPath, `${releaseNotes}\n`, "utf8");

  const macAarch64UpdaterAsset = {
    assetName: "OnePublish_0.2.0_aarch64.app.tar.gz",
    signature: "sig-darwin-aarch64",
  };
  const macX64UpdaterAsset = {
    assetName: "OnePublish_0.2.0_x64.app.tar.gz",
    signature: "sig-darwin-x64",
  };
  const windowsUpdaterAsset = {
    assetName: "OnePublish_0.2.0_x64-setup.exe",
    signature: "sig-windows-x86_64",
  };
  const linuxUpdaterAsset = {
    assetName: "OnePublish_0.2.0_amd64.AppImage",
    signature: "sig-linux-x86_64",
  };
  const updaterAssets = [
    macAarch64UpdaterAsset,
    macX64UpdaterAsset,
    windowsUpdaterAsset,
    linuxUpdaterAsset,
  ];

  for (const asset of updaterAssets) {
    fs.writeFileSync(path.join(releaseAssetsDir, asset.assetName), "placeholder", "utf8");
    fs.writeFileSync(
      path.join(releaseAssetsDir, `${asset.assetName}.sig`),
      `${asset.signature}\n`,
      "utf8"
    );
  }

  const baseUrl =
    "https://github.com/sperictao/one-publish/releases/download/v0.2.0";
  run(process.execPath, [
    "scripts/generate-latest-json.mjs",
    "--input",
    releaseAssetsDir,
    "--output",
    latestJsonPath,
    "--version",
    "0.2.0",
    "--baseUrl",
    baseUrl,
    "--notes-file",
    notesPath,
  ]);

  const manifest = JSON.parse(fs.readFileSync(latestJsonPath, "utf8"));
  ensure(manifest.version === "0.2.0", "latest.json version 不正确。");
  ensure(manifest.notes === releaseNotes, "latest.json 未写入 release notes。");
  ensure(
    Number.isFinite(Date.parse(manifest.pub_date)),
    "latest.json pub_date 不是合法时间。"
  );

  ensure(
    manifest.platforms?.["darwin-aarch64"]?.signature === macAarch64UpdaterAsset.signature,
    "latest.json 缺少 darwin-aarch64 签名。"
  );
  ensure(
    manifest.platforms?.["darwin-x86_64"]?.signature === macX64UpdaterAsset.signature,
    "latest.json 缺少 darwin-x86_64 签名。"
  );
  ensure(
    manifest.platforms?.["darwin-aarch64"]?.url ===
      `${baseUrl}/${encodeURIComponent(macAarch64UpdaterAsset.assetName)}`,
    "latest.json 缺少 darwin-aarch64 资产 URL。"
  );
  ensure(
    manifest.platforms?.["darwin-x86_64"]?.url ===
      `${baseUrl}/${encodeURIComponent(macX64UpdaterAsset.assetName)}`,
    "latest.json 缺少 darwin-x86_64 资产 URL。"
  );
  ensure(
    manifest.platforms?.["windows-x86_64"]?.signature === windowsUpdaterAsset.signature,
    "latest.json 缺少 windows-x86_64 签名。"
  );
  ensure(
    manifest.platforms?.["windows-x86_64"]?.url ===
      `${baseUrl}/${encodeURIComponent(windowsUpdaterAsset.assetName)}`,
    "latest.json 缺少 windows-x86_64 资产 URL。"
  );
  ensure(
    manifest.platforms?.["linux-x86_64"]?.signature === linuxUpdaterAsset.signature,
    "latest.json 缺少 linux-x86_64 签名。"
  );
  ensure(
    manifest.platforms?.["linux-x86_64"]?.url ===
      `${baseUrl}/${encodeURIComponent(linuxUpdaterAsset.assetName)}`,
    "latest.json 缺少 linux-x86_64 资产 URL。"
  );

  const missingMacSigDir = path.join(tempDir, "missing-mac-sig");
  fs.mkdirSync(missingMacSigDir, { recursive: true });
  for (const asset of updaterAssets) {
    fs.writeFileSync(path.join(missingMacSigDir, asset.assetName), "placeholder", "utf8");
    if (asset !== macAarch64UpdaterAsset) {
      fs.writeFileSync(
        path.join(missingMacSigDir, `${asset.assetName}.sig`),
        `${asset.signature}\n`,
        "utf8"
      );
    }
  }

  const missingMacSigOutput = runExpectFailure(process.execPath, [
    "scripts/generate-latest-json.mjs",
    "--input",
    missingMacSigDir,
    "--output",
    path.join(missingMacSigDir, "latest.json"),
    "--version",
    "0.2.0",
    "--baseUrl",
    baseUrl,
    "--notes-file",
    notesPath,
  ]);
  ensure(
    missingMacSigOutput.includes("macOS aarch64 updater 包 缺少对应签名文件"),
    "缺少 macOS aarch64 签名时未返回可读错误。"
  );

  const missingMacX64Dir = path.join(tempDir, "missing-mac-x64");
  fs.mkdirSync(missingMacX64Dir, { recursive: true });
  for (const asset of [macAarch64UpdaterAsset, windowsUpdaterAsset, linuxUpdaterAsset]) {
    fs.writeFileSync(path.join(missingMacX64Dir, asset.assetName), "placeholder", "utf8");
    fs.writeFileSync(
      path.join(missingMacX64Dir, `${asset.assetName}.sig`),
      `${asset.signature}\n`,
      "utf8"
    );
  }

  const missingMacX64Output = runExpectFailure(process.execPath, [
    "scripts/generate-latest-json.mjs",
    "--input",
    missingMacX64Dir,
    "--output",
    path.join(missingMacX64Dir, "latest.json"),
    "--version",
    "0.2.0",
    "--baseUrl",
    baseUrl,
    "--notes-file",
    notesPath,
  ]);
  ensure(
    missingMacX64Output.includes("缺少 macOS x64 updater 包"),
    "缺少 macOS x64 tarball 时未返回可读错误。"
  );

  const missingWindowsDir = path.join(tempDir, "missing-windows-setup-exe");
  fs.mkdirSync(missingWindowsDir, { recursive: true });
  for (const asset of [macAarch64UpdaterAsset, macX64UpdaterAsset, linuxUpdaterAsset]) {
    fs.writeFileSync(path.join(missingWindowsDir, asset.assetName), "placeholder", "utf8");
    fs.writeFileSync(
      path.join(missingWindowsDir, `${asset.assetName}.sig`),
      `${asset.signature}\n`,
      "utf8"
    );
  }

  const missingWindowsOutput = runExpectFailure(process.execPath, [
    "scripts/generate-latest-json.mjs",
    "--input",
    missingWindowsDir,
    "--output",
    path.join(missingWindowsDir, "latest.json"),
    "--version",
    "0.2.0",
    "--baseUrl",
    baseUrl,
    "--notes-file",
    notesPath,
  ]);
  ensure(
    missingWindowsOutput.includes("缺少 Windows setup.exe updater 包"),
    "缺少 Windows setup.exe 时未返回可读错误。"
  );

  const missingLinuxDir = path.join(tempDir, "missing-linux-appimage");
  fs.mkdirSync(missingLinuxDir, { recursive: true });
  for (const asset of [macAarch64UpdaterAsset, macX64UpdaterAsset, windowsUpdaterAsset]) {
    fs.writeFileSync(path.join(missingLinuxDir, asset.assetName), "placeholder", "utf8");
    fs.writeFileSync(
      path.join(missingLinuxDir, `${asset.assetName}.sig`),
      `${asset.signature}\n`,
      "utf8"
    );
  }

  const missingLinuxOutput = runExpectFailure(process.execPath, [
    "scripts/generate-latest-json.mjs",
    "--input",
    missingLinuxDir,
    "--output",
    path.join(missingLinuxDir, "latest.json"),
    "--version",
    "0.2.0",
    "--baseUrl",
    baseUrl,
    "--notes-file",
    notesPath,
  ]);
  ensure(
    missingLinuxOutput.includes("缺少 Linux AppImage updater 包"),
    "缺少 Linux AppImage 时未返回可读错误。"
  );

  console.log("PASS: updater 配置与 latest.json 脚本烟测通过。");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
