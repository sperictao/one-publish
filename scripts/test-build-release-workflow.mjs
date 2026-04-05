import fs from "node:fs";
import path from "node:path";

import {
  workflowReleaseAssetRules,
  workflowUpdaterAssetRules,
} from "./release-asset-rules.mjs";

const workflowPath = path.resolve(".github/workflows/build-release.yml");
const content = fs.readFileSync(workflowPath, "utf8");
const lines = content.split(/\r?\n/);

const setupNodeIndex = content.indexOf("- name: Setup Node");
const setupPnpmIndex = content.indexOf("- name: Setup pnpm");

if (setupNodeIndex === -1 || setupPnpmIndex === -1) {
  throw new Error("workflow 缺少 Setup Node 或 Setup pnpm 步骤。");
}

if (setupPnpmIndex > setupNodeIndex) {
  throw new Error(
    "复现成功：Setup Node 出现在 Setup pnpm 之前，cache: pnpm 会找不到 pnpm 可执行文件。"
  );
}

const getStepIf = (stepName) => {
  const marker = `- name: ${stepName}`;
  const stepStart = lines.findIndex((line) => line.trim() === marker);
  if (stepStart === -1) {
    return null;
  }

  for (let index = stepStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("- name:")) {
      break;
    }
    if (trimmed.startsWith("if:")) {
      return trimmed.slice(3).trim();
    }
  }

  return null;
};

const getStepBlock = (stepName) => {
  const marker = `- name: ${stepName}`;
  const stepStart = lines.findIndex((line) => line.trim() === marker);
  if (stepStart === -1) {
    return "";
  }

  const block = [lines[stepStart]];
  for (let index = stepStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("- name:")) {
      break;
    }
    block.push(line);
  }

  return block.join("\n");
};

const assertIfContains = (stepName, requiredFragments) => {
  const condition = getStepIf(stepName);
  if (!condition) {
    throw new Error(`复现成功：${stepName} 缺少 if 条件保护。`);
  }

  for (const fragment of requiredFragments) {
    if (!condition.includes(fragment)) {
      throw new Error(
        `复现成功：${stepName} 的 if 条件缺少 "${fragment}"，当前为 "${condition}"。`
      );
    }
  }
};

const assertContains = (fragment, message) => {
  if (!content.includes(fragment)) {
    throw new Error(`复现成功：${message}`);
  }
};

const assertStepContains = (stepName, fragment, message) => {
  const block = getStepBlock(stepName);
  if (!block.includes(fragment)) {
    throw new Error(`复现成功：${message}`);
  }
};

const assertStepNotContains = (stepName, fragment, message) => {
  const block = getStepBlock(stepName);
  if (block.includes(fragment)) {
    throw new Error(`复现成功：${message}`);
  }
};

assertIfContains("Import Apple Developer Certificate", [
  "matrix.os == 'macos-latest'",
  "env.HAS_APPLE_CERT == 'true'",
]);

assertIfContains("Import Windows Certificate", [
  "matrix.os == 'windows-latest'",
  "env.HAS_WINDOWS_CERT == 'true'",
]);

assertIfContains("Build (macOS signed)", [
  "matrix.os == 'macos-latest'",
  "env.HAS_APPLE_SIGNING == 'true'",
]);

assertIfContains("Build (macOS unsigned)", [
  "matrix.os == 'macos-latest'",
  "env.HAS_APPLE_SIGNING != 'true'",
]);

assertContains(
  "bundle_path: src-tauri/target/aarch64-apple-darwin/release/bundle/**",
  "macOS aarch64 bundle_path 未配置为 target 子目录。"
);
assertContains(
  "bundle_path: src-tauri/target/x86_64-apple-darwin/release/bundle/**",
  "macOS x86_64 bundle_path 未配置为 target 子目录。"
);
assertContains(
  "bundle_path: src-tauri/target/universal-apple-darwin/release/bundle/**",
  "macOS universal bundle_path 未配置为 target 子目录。"
);
assertContains(
  "TAURI_UPDATER_PUBKEY",
  "workflow 未注入 TAURI_UPDATER_PUBKEY。"
);
assertContains(
  "TAURI_SIGNING_PRIVATE_KEY",
  "workflow 未注入 TAURI_SIGNING_PRIVATE_KEY。"
);
assertContains(
  "if-no-files-found: error",
  "Upload bundles 未启用 if-no-files-found: error，可能掩盖产物缺失。"
);
assertContains(
  "pnpm build:updater --",
  "构建步骤仍未切到 build:updater。"
);
assertContains(
  'node-version: "20"',
  "Setup Node 仍未升级到兼容 Vite 7 的版本。"
);
assertContains(
  "uses: actions/checkout@v5",
  "workflow 仍在使用不支持 Node 24 的 actions/checkout 主版本。"
);
assertContains(
  "uses: actions/setup-node@v5",
  "workflow 仍在使用不支持 Node 24 的 actions/setup-node 主版本。"
);
assertContains(
  "uses: pnpm/action-setup@v5",
  "workflow 仍在使用不支持 Node 24 的 pnpm/action-setup 主版本。"
);
assertContains(
  "- name: Prepare updater assets",
  "缺少 updater 资产预处理步骤。"
);
assertContains(
  "mkdir -p ./updater-assets",
  "workflow 未创建 updater-assets staging 目录。"
);
for (const rule of workflowUpdaterAssetRules) {
  assertContains(rule.fragment, rule.message);
}
assertContains(
  "- name: Prepare release assets",
  "缺少 release 资产预处理步骤。"
);
assertContains(
  "mkdir -p ./release-assets",
  "workflow 未创建 release-assets staging 目录。"
);
for (const rule of workflowReleaseAssetRules) {
  assertContains(rule.fragment, rule.message);
}
assertContains(
  "- name: Remove existing release",
  "缺少旧 release 清理步骤。"
);
assertContains(
  "- name: Checkout release ref",
  "release job 缺少仓库 checkout，无法读取 release notes 文件。"
);
assertContains(
  "- name: Resolve release notes",
  "缺少 release notes 解析步骤。"
);
assertContains(
  "release_notes_path=\"./release-notes/${GITHUB_REF_NAME}.md\"",
  "release notes 文件路径未绑定到 tag。"
);
assertContains(
  "gh release create",
  "Release 仍未使用 gh release create。"
);
assertStepNotContains(
  "Download bundles",
  "merge-multiple: true",
  "Download bundles 仍在平铺 artifact，macOS 重名产物会互相覆盖。"
);
assertContains(
  "find ./release-assets -type f -print0",
  "gh release create 未从 release-assets 上传文件。"
);
assertContains(
  "- name: Generate latest updater manifest",
  "缺少 latest.json 生成步骤。"
);
assertContains(
  "scripts/generate-latest-json.mjs",
  "workflow 未调用 latest.json 生成脚本。"
);
assertStepContains(
  "Generate latest updater manifest",
  "--input ./updater-assets",
  "latest.json 生成步骤未改为读取 updater-assets。"
);
assertStepContains(
  "Generate latest updater manifest",
  "--output ./updater-assets/latest.json",
  "latest.json 未先写入 updater-assets。"
);
assertStepContains(
  "Generate latest updater manifest",
  "--notes-file \"${RELEASE_NOTES_PATH}\"",
  "latest.json 生成步骤未注入 release notes 文件。"
);
assertStepNotContains(
  "Prepare release assets",
  "universal.app.tar.gz",
  "release-assets 不应公开收集 macOS universal updater tarball。"
);
assertStepNotContains(
  "Prepare release assets",
  ".sig",
  "release-assets 仍在公开收集 .sig 文件。"
);
assertStepNotContains(
  "Prepare release assets",
  "*.rpm",
  "release-assets 仍在公开收集 rpm。"
);
assertStepNotContains(
  "Prepare release assets",
  "*.msi",
  "release-assets 仍在公开收集 Windows msi。"
);
assertStepContains(
  "Prepare release assets",
  "*-setup.exe",
  "release-assets 未公开收集 Windows setup.exe。"
);
assertStepNotContains(
  "Prepare updater assets",
  "*.msi",
  "updater-assets 仍在收集 Windows msi。"
);
assertStepNotContains(
  "Prepare updater assets",
  "*.msi.sig",
  "updater-assets 仍在收集 Windows msi 签名。"
);
assertStepNotContains(
  "Prepare release assets",
  "*.msi.sig",
  "release-assets 不应公开收集 Windows msi 签名。"
);
assertStepContains(
  "Create GitHub Release",
  "--notes-file \"${RELEASE_NOTES_PATH}\"",
  "GitHub Release 未使用 release notes 文件。"
);

console.log("PASS: build-release workflow 通过顺序与 secrets 保护检查。");
