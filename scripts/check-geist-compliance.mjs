import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

const BANNED = [
  ["bare-rounded",      /(?<![-\w])rounded(?![-\w])/,        "裸 rounded=4px，用 rounded-sm"],
  ["rounded-lg-or-xl",  /rounded-(lg|xl|2xl|3xl)\b/,          "16px+ 仅限全屏面，控件用 rounded-sm，模态 rounded-md"],
  ["stock-text-size",   /text-(xs|sm|base|lg|xl|2xl)\b/,      "禁原生字号，用 text-label-*/copy-*/heading-*/button-*"],
  ["arbitrary-text",    /text-\[\d+px\]/,                     "禁任意值字号"],
  ["hand-tracking",     /tracking-\[/,                        "禁手写字距"],
  ["hand-leading",      /leading-\[/,                         "禁任意值行高"],
  ["accent-as-hover",   /hover:bg-(accent|muted)\b/,          "悬停用 gray-alpha 阶梯"],
  ["opacity-disabled",  /disabled:opacity-\d+/,               "禁用态用 gray-100 底 + gray-700 字"],
  ["stock-palette",     /\b(bg|text|border)-(slate|zinc|stone|neutral|sky|indigo|violet|rose|orange|lime|emerald|cyan|fuchsia)-\d+/, "禁原生调色板"],
  ["raw-hex-class",     /(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/, "禁裸 hex"],
  ["important-size",    /!(h|w|size)-/,                       "禁 !important 尺寸"],
  ["offscale-height",   /(?<![-\w])(h|size)-(9|11)\b/,        "36/44px 不在控件刻度"],
  ["decorative-anim",   /animate-(pulse|bounce|ping)\b/,      "循环动画仅限进行中指示"],
];

const ALLOWLIST = [
  { file: "src/components/layout/SettingsDialog.tsx", rule: "decorative-anim", reason: "下载进度条不确定态" },
  { file: "src/components/ui/switch.tsx", rule: "opacity-disabled", reason: "Radix Switch 整体禁用惯例" },
  { file: "src/components/publish/PublishRunCard.tsx", rule: "opacity-disabled", reason: "取消钮 disabled:opacity-100 保持不透明非降调" },
];

function isExcluded(path) {
  return (
    path.includes("/__tests__/") ||
    path.startsWith("src/generated/") ||
    path.startsWith("src/components/prototype/") ||
    /\.test\.[^/]+$/.test(path)
  );
}

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function isAllowed(file, rule) {
  return ALLOWLIST.some(
    (entry) => file.endsWith(entry.file) && entry.rule === rule
  );
}

const files = collectSourceFiles(ROOT).filter((file) => !isExcluded(file));
const violations = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [rule, pattern] of BANNED) {
      if (pattern.test(line) && !isAllowed(file, rule)) {
        const content = line.trim().slice(0, 120);
        violations.push(`${file}:${index + 1} -> [${rule}] ${content}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `Source contains ${violations.length} Geist violations:\n${violations.join("\n")}`
  );
  process.exit(1);
}

console.log(`Geist compliance: OK (${files.length} files scanned)`);
