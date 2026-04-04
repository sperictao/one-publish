import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const contractPath = path.join(rootDir, "src", "generated", "tauri-contracts.ts");
const manifestPath = path.join(rootDir, "src-tauri", "Cargo.toml");

function readContractFile() {
  if (!fs.existsSync(contractPath)) {
    return null;
  }

  return fs.readFileSync(contractPath, "utf8");
}

function fail(message, details = "") {
  process.stderr.write(`${message}\n`);
  if (details.trim()) {
    process.stderr.write(`${details.trim()}\n`);
  }
  process.exit(1);
}

const before = readContractFile();
const result = spawnSync(
  "cargo",
  ["run", "--manifest-path", manifestPath, "--example", "generate_tauri_contracts"],
  {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
  }
);

if (result.error) {
  fail("执行 Tauri 合同生成失败。", result.error.message);
}

if (result.status !== 0) {
  fail(
    "执行 Tauri 合同生成失败。",
    result.stderr || result.stdout || `退出码 ${result.status ?? 1}`
  );
}

const after = readContractFile();
if (before !== after) {
  fail(
    "检测到 Tauri 共享合同漂移，已自动重新生成 `src/generated/tauri-contracts.ts`。请检查并提交该文件。",
    result.stdout
  );
}

process.stdout.write("Tauri 共享合同已同步。\n");
