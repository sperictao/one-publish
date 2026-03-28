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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "one-publish-updater-"));

try {
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

  const assets = [
    {
      platform: "darwin-aarch64",
      assetName: "OnePublish_0.2.0_aarch64.app.tar.gz",
      signature: "sig-darwin-aarch64",
    },
    {
      platform: "darwin-x86_64",
      assetName: "OnePublish_0.2.0_x64.app.tar.gz",
      signature: "sig-darwin-x86_64",
    },
    {
      platform: "windows-x86_64",
      assetName: "OnePublish_0.2.0_x64_en-US.msi.zip",
      signature: "sig-windows-x86_64",
    },
    {
      platform: "linux-x86_64",
      assetName: "OnePublish_0.2.0_amd64.AppImage.tar.gz",
      signature: "sig-linux-x86_64",
    },
  ];

  for (const asset of assets) {
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

  for (const asset of assets) {
    ensure(
      manifest.platforms?.[asset.platform]?.signature === asset.signature,
      `latest.json 缺少 ${asset.platform} 签名。`
    );
    ensure(
      manifest.platforms?.[asset.platform]?.url ===
        `${baseUrl}/${encodeURIComponent(asset.assetName)}`,
      `latest.json 缺少 ${asset.platform} 资产 URL。`
    );
  }

  console.log("PASS: updater 配置与 latest.json 脚本烟测通过。");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
