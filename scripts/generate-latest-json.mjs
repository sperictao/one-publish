import fs from "node:fs";
import path from "node:path";

import { updaterManifestAssets } from "./release-asset-rules.mjs";

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    args[current.slice(2)] = argv[index + 1];
    index += 1;
  }

  return args;
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function createAssetMatcher(files) {
  return (patterns) => {
    for (const pattern of patterns) {
      const assetName = files.find((file) => {
        if (file.endsWith(".sig")) {
          return false;
        }

        if (!file.endsWith(pattern.endsWith)) {
          return false;
        }

        const includes = pattern.includes ?? [];
        const excludes = pattern.excludes ?? [];

        return (
          includes.every((token) => file.includes(token)) &&
          excludes.every((token) => !file.includes(token))
        );
      });

      if (!assetName) {
        continue;
      }

      return assetName;
    }

    return null;
  };
}

function requireSignedAsset(findAsset, files, label, patterns) {
  const assetName = findAsset(patterns);
  if (!assetName) {
    fail(`缺少 ${label}`);
  }

  const signatureName = `${assetName}.sig`;
  if (!files.includes(signatureName)) {
    fail(`${label} 缺少对应签名文件: ${signatureName}`);
  }

  return {
    assetName,
    signatureName,
  };
}

function createPlatformEntry(inputDir, baseUrl, asset) {
  const signature = fs
    .readFileSync(path.join(inputDir, asset.signatureName), "utf8")
    .trim();

  return {
    signature,
    url: `${baseUrl}/${encodeURIComponent(asset.assetName)}`,
  };
}

const args = parseArgs(process.argv.slice(2));
const inputDir = path.resolve(process.cwd(), args.input || "release-assets");
const outputPath = path.resolve(
  process.cwd(),
  args.output || "release-assets/latest.json"
);
const version = String(args.version || "").trim();
const baseUrl = String(args.baseUrl || "").trim().replace(/\/$/, "");
const notesFile = String(args["notes-file"] || "").trim();
let notes = args.notes ?? "";

if (!version) {
  fail("缺少 --version");
}

if (!baseUrl) {
  fail("缺少 --baseUrl");
}

if (!fs.existsSync(inputDir)) {
  fail(`输入目录不存在: ${inputDir}`);
}

if (notesFile) {
  const resolvedNotesPath = path.resolve(process.cwd(), notesFile);
  if (!fs.existsSync(resolvedNotesPath)) {
    fail(`notes 文件不存在: ${resolvedNotesPath}`);
  }

  if (!notes) {
    notes = fs.readFileSync(resolvedNotesPath, "utf8").trim();
  }
}

const files = fs
  .readdirSync(inputDir)
  .filter((name) => fs.statSync(path.join(inputDir, name)).isFile())
  .sort();

const findAsset = createAssetMatcher(files);
const platforms = Object.fromEntries(
  updaterManifestAssets.map((definition) => {
    const asset = requireSignedAsset(
      findAsset,
      files,
      definition.label,
      definition.patterns
    );

    return [definition.platform, createPlatformEntry(inputDir, baseUrl, asset)];
  })
);

const payload = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`✅ 已生成 latest.json: ${outputPath}`);
