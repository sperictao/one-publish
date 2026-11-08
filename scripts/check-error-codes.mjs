import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// 后端错误码登记检查：所有随 AppError 返回的 code 必须在 errors.* 有本地化
// 条目，否则 localizeInvokeError 会把后端原始消息（中英混杂）兜底显示。
const rootDir = process.cwd();
const srcTauriDir = path.join(rootDir, "src-tauri", "src");
const enLocalePath = path.join(rootDir, "src", "i18n", "en.json");

// 测试夹具与非错误码字面量的豁免名单；新增豁免必须附理由。
const IGNORED_CODES = new Set([
  "unknown", // parameter.rs 测试夹具里的占位键，不是 AppError code
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      yield full;
    }
  }
}

function collectCodes() {
  const codes = new Set();
  const patterns = [
    // *_with_code(message, "code") / *_error(message, "code") 助手族的第二个字面量
    /(?:_with_code|_error)\s*\(\s*(?:format!\s*\([^)]*\)|"[^"]*"|[^,]+)\s*,\s*"([a-z][a-z0-9_]{5,})"/g,
    // .with_code("code") 构建器
    /\.with_code\(\s*"([a-z][a-z0-9_]{5,})"\s*\)/g,
    // code: "x" / code: Some("x") 字段
    /code:\s*(?:Some\(\s*)?"([a-z][a-z0-9_]{5,})"/g,
  ];
  for (const file of walk(srcTauriDir)) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        codes.add(match[1]);
      }
    }
  }
  return codes;
}

const enLocale = JSON.parse(fs.readFileSync(enLocalePath, "utf8"));
const registered = new Set(Object.keys(enLocale.errors ?? {}));
const codes = collectCodes();
const missing = [...codes]
  .filter((code) => !registered.has(code) && !IGNORED_CODES.has(code))
  .sort();

if (missing.length > 0) {
  fail(
    `backend error codes missing errors.* entries (${missing.length}):\n` +
      missing.map((code) => `  - ${code}`).join("\n") +
      `\nAdd zh.json + en.json entries, or extend IGNORED_CODES in ` +
      `scripts/check-error-codes.mjs with a justification.`
  );
}

process.stdout.write(
  `error code coverage: ${codes.size} backend codes, ${missing.length} unregistered\n`
);
