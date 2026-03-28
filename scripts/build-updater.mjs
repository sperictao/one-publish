import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const updaterConfigPath = "src-tauri/tauri.conf.updater.prod.json";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
  });

  if (result.error) {
    fail(`执行 ${command} 失败：${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`执行 ${command} ${args.join(" ")} 失败：退出码 ${result.status ?? 1}`);
  }
}

function normalizeForwardedArgs(args = []) {
  return args.filter((arg) => arg !== "--");
}

function buildTauriBuildArgs(args = []) {
  return ["tauri", "build", "--config", updaterConfigPath, ...normalizeForwardedArgs(args)];
}

function getPnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function main(argv = process.argv.slice(2)) {
  run(process.execPath, ["scripts/generate-updater-config.mjs"]);
  run(process.execPath, ["scripts/validate-updater-config.mjs", updaterConfigPath]);

  // 这里必须把 target 等参数直接传给 Tauri CLI，避免落到 Cargo 的 `--` 分隔符后面。
  run(getPnpmCommand(), buildTauriBuildArgs(argv));
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

export { buildTauriBuildArgs, getPnpmCommand, normalizeForwardedArgs };

if (isDirectExecution) {
  main();
}
