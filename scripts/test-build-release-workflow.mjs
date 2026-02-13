import fs from "node:fs";
import path from "node:path";

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

console.log("PASS: build-release workflow 通过顺序与 secrets 保护检查。");
