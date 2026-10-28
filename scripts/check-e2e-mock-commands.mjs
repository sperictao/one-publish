import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// 校验 e2e mock 命令面与 generate_handler! 注册命令保持同步：
// 新增 Tauri 命令必须在 tests/e2e/fixtures/mock-tauri.ts 有对应
// case 分支，或登记进 EXPECTED_UNMOCKED（写明原因）。mock 的
// default 分支对未知命令静默返回 null——没有本检查，改名的
// 命令会让 e2e 在无感知下穿透到 null 而非真实语义。

const rootDir = process.cwd();
const libPath = path.join(rootDir, "src-tauri", "src", "lib.rs");
const mockPath = path.join(
  rootDir,
  "tests",
  "e2e",
  "fixtures",
  "mock-tauri.ts"
);

// 刻意不在 e2e mock 中实现的注册命令（每行必须附原因注释）。
// 新增命令默认要求有 mock；只有主机壳层命令（托盘/窗口/单实例）
// 才适合列入此名单。
const EXPECTED_UNMOCKED = new Set([
  // 当前为空——所有注册命令均已 mock。
]);

function fail(message, details = "") {
  process.stderr.write(`${message}\n`);
  if (details.trim()) {
    process.stderr.write(`${details.trim()}\n`);
  }
  process.exit(1);
}

const libSource = fs.readFileSync(libPath, "utf8");
const handlerBlock = libSource.match(/generate_handler!\s*\[([\s\S]*?)\]/);
if (!handlerBlock) {
  fail("无法解析 lib.rs 中的 generate_handler! 注册块。");
}

const registered = new Set();
for (const match of handlerBlock[1].matchAll(/[a-z_]+(?:::[a-z_]+)+/g)) {
  registered.add(match[0].split("::").pop());
}

const mockSource = fs.readFileSync(mockPath, "utf8");
const mocked = new Set();
for (const match of mockSource.matchAll(/case "([a-z_]+)"/g)) {
  mocked.add(match[1]);
}

const missing = [...registered].filter(
  (name) => !mocked.has(name) && !EXPECTED_UNMOCKED.has(name)
);
const stale = [...mocked].filter((name) => !registered.has(name));
const unmockedUnknown = [...EXPECTED_UNMOCKED].filter(
  (name) => !registered.has(name)
);
const unmockedButMocked = [...EXPECTED_UNMOCKED].filter((name) =>
  mocked.has(name)
);

const problems = [];
if (missing.length) {
  problems.push(
    `未 mock 的注册命令（实现 case 分支或登记 EXPECTED_UNMOCKED）：\n  ${missing.join("\n  ")}`
  );
}
if (stale.length) {
  problems.push(
    `mock 中已不存在的命令（删除失效 case 分支）：\n  ${stale.join("\n  ")}`
  );
}
if (unmockedUnknown.length) {
  problems.push(
    `EXPECTED_UNMOCKED 中不是注册命令的条目：\n  ${unmockedUnknown.join("\n  ")}`
  );
}
if (unmockedButMocked.length) {
  problems.push(
    `EXPECTED_UNMOCKED 中已有 mock 的条目（从名单中移除）：\n  ${unmockedButMocked.join("\n  ")}`
  );
}

if (problems.length) {
  fail("e2e mock 命令面与注册命令漂移：", problems.join("\n\n"));
}

console.log(
  `e2e mock command parity: ${registered.size} registered, ${mocked.size} mocked, ${EXPECTED_UNMOCKED.size} exempted`
);
