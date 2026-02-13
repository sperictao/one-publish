import fs from "node:fs";
import path from "node:path";

const workflowPath = path.resolve(".github/workflows/build-release.yml");
const content = fs.readFileSync(workflowPath, "utf8");

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

console.log("PASS: Setup pnpm 在 Setup Node 之前。");
