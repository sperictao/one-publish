import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const LOCALE_FILES = ["src/i18n/zh.json", "src/i18n/en.json"];
const CJK_PATTERN = /[\u3400-\u9fff]/;

const BASE_ALIAS_ROOTS = {
  appT: "app",
  artifactT: "artifact",
  branchT: "branchPanel",
  checklistTranslations: "releaseChecklist",
  commandT: "commandImport",
  commonT: "common",
  configPanelT: "configPanel",
  configT: "config",
  failureT: "failure",
  historyT: "history",
  profileT: "profiles",
  publishT: "publish",
  repoT: "repositoryList",
  rerunT: "rerun",
  shortcutT: "shortcuts",
};

const FILE_ALIAS_ROOTS = {
  "src/components/layout/PublishConfigPanel.tsx": {
    t: "configPanel",
  },
  "src/components/publish/OutputTargetBadge.tsx": {
    t: "app",
  },
  "src/components/publish/ProjectPublishProfileViewerDialog.tsx": {
    translations: "configPanel",
    t: "configPanel",
  },
};

const TRANSLATION_ALIAS_PATTERN = new RegExp(
  [
    "translations",
    ...Object.keys(BASE_ALIAS_ROOTS),
    "t",
  ].join("|")
);

function readLocale(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function flattenLocaleKeys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      return flattenLocaleKeys(child, path);
    }
    return [path];
  });
}

function getSourceFiles() {
  const result = spawnSync(
    "rg",
    [
      "--files",
      "src",
      "--glob",
      "*.ts",
      "--glob",
      "*.tsx",
      "--glob",
      "!**/__tests__/**",
      "--glob",
      "!src/generated/**",
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to list source files with rg.");
  }

  return result.stdout.trim().split("\n").filter(Boolean);
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function extractAliasRoots(file, source) {
  const aliases = {
    ...BASE_ALIAS_ROOTS,
    ...(FILE_ALIAS_ROOTS[file] || {}),
  };

  const translationAliasRegex =
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*translations((?:\??\.[A-Za-z_$][\w$]*)+)\s*\|\|\s*\{\}/g;
  let match;
  while ((match = translationAliasRegex.exec(source))) {
    aliases[match[1]] = normalizeChain(match[2]);
  }

  const forwardedAliasRegex =
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
  while ((match = forwardedAliasRegex.exec(source))) {
    const [, alias, sourceAlias] = match;
    if (aliases[sourceAlias]) {
      aliases[alias] = aliases[sourceAlias];
    }
  }

  return aliases;
}

function normalizeChain(chain) {
  return chain
    .replaceAll("?.", ".")
    .split(".")
    .filter(Boolean)
    .join(".");
}

function collectUsedTranslationKeys(file, source) {
  const aliases = extractAliasRoots(file, source);
  const used = [];
  const aliasAlternation = [
    "translations",
    ...Object.keys(aliases).sort((a, b) => b.length - a.length),
  ].join("|");

  const propertyAccessRegex = new RegExp(
    `(?<![A-Za-z0-9_$])(${aliasAlternation})((?:\\??\\.[A-Za-z_$][\\w$]*)+)`,
    "g"
  );
  let match;
  while ((match = propertyAccessRegex.exec(source))) {
    const [, alias, chain] = match;
    const normalizedChain = normalizeChain(chain);
    const root = alias === "translations" ? aliases.translations || "" : aliases[alias];
    if (!normalizedChain || (!root && alias !== "translations")) {
      continue;
    }
    used.push({
      file,
      line: lineNumberAt(source, match.index),
      key: root ? `${root}.${normalizedChain}` : normalizedChain,
    });
  }

  const directTCallRegex = /(?<![A-Za-z0-9_$])t\(\s*"([A-Za-z0-9_.-]+)"/g;
  while ((match = directTCallRegex.exec(source))) {
    used.push({
      file,
      line: lineNumberAt(source, match.index),
      key: match[1],
    });
  }

  const translateCallRegex =
    /translate\(\s*([A-Za-z_$][\w$]*)\s*,\s*"([A-Za-z0-9_]+)"/g;
  while ((match = translateCallRegex.exec(source))) {
    const [, alias, childKey] = match;
    const root = aliases[alias];
    if (!root) {
      continue;
    }
    used.push({
      file,
      line: lineNumberAt(source, match.index),
      key: `${root}.${childKey}`,
    });
  }

  return used;
}

function hasLocaleKeyOrSubtree(localeKeys, key) {
  if (localeKeys.has(key)) {
    return true;
  }

  const subtreePrefix = `${key}.`;
  for (const localeKey of localeKeys) {
    if (localeKey.startsWith(subtreePrefix)) {
      return true;
    }
  }

  return false;
}

function collectJsxTextCjk(file, source) {
  if (!file.endsWith(".tsx")) {
    return [];
  }

  const findings = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const text = node.getText(sourceFile).replace(/\s+/g, " ").trim();
      if (text && CJK_PATTERN.test(text)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({ file, line: line + 1, text });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

function collectHardcodedCjkUi(file, source) {
  const findings = [];
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    if (!CJK_PATTERN.test(line)) {
      return;
    }

    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) {
      return;
    }

    const translationContext = lines
      .slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
      .join("\n");
    const hasTranslationFallbackContext =
      TRANSLATION_ALIAS_PATTERN.test(translationContext);

    if (
      /toast\.(success|error|warning|info|message)\(\s*["'][^"']*[\u3400-\u9fff]/.test(
        line
      ) &&
      !hasTranslationFallbackContext
    ) {
      findings.push({ file, line: lineNumber, text: trimmed });
      return;
    }

    if (
      (/(title|aria-label|placeholder)=["'][^"']*[\u3400-\u9fff]/.test(line) ||
        /(title|aria-label|placeholder)=\{[^}]*["'][^"']*[\u3400-\u9fff]/.test(line)) &&
      !hasTranslationFallbackContext
    ) {
      findings.push({ file, line: lineNumber, text: trimmed });
      return;
    }

    if (
      /<[^>]+>[^<{]*[\u3400-\u9fff][^<{]*$/.test(line) ||
      /^[^<{]*[\u3400-\u9fff][^<{]*<\/[A-Za-z]/.test(trimmed)
    ) {
      findings.push({ file, line: lineNumber, text: trimmed });
      return;
    }

    if (
      /[{}]/.test(line) &&
      /["'][^"']*[\u3400-\u9fff][^"']*["']/.test(line) &&
      !hasTranslationFallbackContext &&
      !/\bconsole\./.test(line)
    ) {
      findings.push({ file, line: lineNumber, text: trimmed });
    }
  });

  return [...findings, ...collectJsxTextCjk(file, source)];
}

function formatLocation({ file, line, key, text }) {
  return key ? `${file}:${line} -> ${key}` : `${file}:${line} -> ${text}`;
}

const localeKeySets = LOCALE_FILES.map((file) => ({
  file,
  keys: new Set(flattenLocaleKeys(readLocale(file))),
}));
const canonicalKeys = localeKeySets[0].keys;
const problems = [];

for (const locale of localeKeySets) {
  const missing = [...canonicalKeys].filter((key) => !locale.keys.has(key));
  const extra = [...locale.keys].filter((key) => !canonicalKeys.has(key));

  if (missing.length > 0) {
    problems.push(
      `${locale.file} is missing ${missing.length} keys:\n${missing.join("\n")}`
    );
  }
  if (extra.length > 0) {
    problems.push(
      `${locale.file} has ${extra.length} extra keys:\n${extra.join("\n")}`
    );
  }
}

const allKeys = new Set([...canonicalKeys]);
const missingUsedKeys = [];
const hardcodedCjkUi = [];

for (const file of getSourceFiles()) {
  const source = readFileSync(file, "utf8");
  for (const used of collectUsedTranslationKeys(file, source)) {
    if (!hasLocaleKeyOrSubtree(allKeys, used.key)) {
      missingUsedKeys.push(used);
    }
  }
  hardcodedCjkUi.push(...collectHardcodedCjkUi(file, source));
}

const uniqueMissingUsedKeys = [
  ...new Map(
    missingUsedKeys.map((entry) => [
      `${entry.file}:${entry.line}:${entry.key}`,
      entry,
    ])
  ).values(),
].sort((left, right) => formatLocation(left).localeCompare(formatLocation(right)));

const uniqueHardcodedCjkUi = [
  ...new Map(
    hardcodedCjkUi.map((entry) => [
      `${entry.file}:${entry.line}:${entry.text}`,
      entry,
    ])
  ).values(),
].sort((left, right) => formatLocation(left).localeCompare(formatLocation(right)));

if (uniqueMissingUsedKeys.length > 0) {
  problems.push(
    `Source references ${uniqueMissingUsedKeys.length} missing i18n keys:\n${uniqueMissingUsedKeys
      .map(formatLocation)
      .join("\n")}`
  );
}

if (uniqueHardcodedCjkUi.length > 0) {
  problems.push(
    `Source contains ${uniqueHardcodedCjkUi.length} hardcoded CJK UI strings:\n${uniqueHardcodedCjkUi
      .map(formatLocation)
      .join("\n")}`
  );
}

if (problems.length > 0) {
  console.error(problems.join("\n\n"));
  process.exit(1);
}

console.log(
  `i18n coverage: 100% (${canonicalKeys.size} keys across ${LOCALE_FILES.length} locales)`
);
