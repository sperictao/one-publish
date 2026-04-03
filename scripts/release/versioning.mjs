import fs from "node:fs";
import path from "node:path";

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function updateJsonVersion(filePath, version) {
  const data = JSON.parse(readText(filePath));
  data.version = version;
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function replaceOrThrow(content, pattern, replacement, label) {
  const nextContent = content.replace(pattern, replacement);

  if (nextContent === content) {
    throw new Error(`未找到 ${label} 的版本字段，无法继续发布。`);
  }

  return nextContent;
}

export function updateCargoTomlVersion(filePath, version) {
  const content = readText(filePath);
  const nextContent = replaceOrThrow(
    content,
    /(\[package\][\s\S]*?^version = ")([^"]+)(")/m,
    `$1${version}$3`,
    "Cargo.toml"
  );
  writeText(filePath, nextContent);
}

export function updateCargoLockVersion(filePath, version) {
  const content = readText(filePath);
  const nextContent = replaceOrThrow(
    content,
    /(\[\[package\]\]\nname = "one-publish"\nversion = ")([^"]+)(")/,
    `$1${version}$3`,
    "Cargo.lock"
  );
  writeText(filePath, nextContent);
}

export function getCurrentJsonVersion(filePath) {
  const pkg = JSON.parse(readText(filePath));
  return pkg.version;
}
