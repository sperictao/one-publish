import fs from "node:fs";
import path from "node:path";

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

        return pattern.includes.every((token) => file.includes(token));
      });

      if (!assetName) {
        continue;
      }

      const signatureName = `${assetName}.sig`;
      if (!files.includes(signatureName)) {
        continue;
      }

      return { assetName, signatureName };
    }

    return null;
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
const notes = args.notes ?? "";

if (!version) {
  fail("缺少 --version");
}

if (!baseUrl) {
  fail("缺少 --baseUrl");
}

if (!fs.existsSync(inputDir)) {
  fail(`输入目录不存在: ${inputDir}`);
}

const files = fs
  .readdirSync(inputDir)
  .filter((name) => fs.statSync(path.join(inputDir, name)).isFile())
  .sort();

const findAsset = createAssetMatcher(files);

const platformDefinitions = [
  {
    key: "darwin-aarch64",
    patterns: [
      { includes: ["aarch64"], endsWith: ".app.tar.gz" },
      { includes: ["arm64"], endsWith: ".app.tar.gz" },
    ],
  },
  {
    key: "darwin-x86_64",
    patterns: [
      { includes: ["x64"], endsWith: ".app.tar.gz" },
      { includes: ["x86_64"], endsWith: ".app.tar.gz" },
    ],
  },
  {
    key: "windows-x86_64",
    patterns: [
      { includes: ["x64"], endsWith: ".msi.zip" },
      { includes: ["x86_64"], endsWith: ".msi.zip" },
      { includes: ["x64"], endsWith: "-setup.exe.zip" },
      { includes: ["x86_64"], endsWith: "-setup.exe.zip" },
      { includes: ["x64"], endsWith: ".msi" },
      { includes: ["x86_64"], endsWith: ".msi" },
      { includes: ["x64"], endsWith: "-setup.exe" },
      { includes: ["x86_64"], endsWith: "-setup.exe" },
    ],
  },
  {
    key: "linux-x86_64",
    patterns: [
      { includes: ["amd64"], endsWith: ".AppImage.tar.gz" },
      { includes: ["x86_64"], endsWith: ".AppImage.tar.gz" },
      { includes: ["amd64"], endsWith: ".deb" },
      { includes: ["x86_64"], endsWith: ".deb" },
      { includes: ["amd64"], endsWith: ".AppImage" },
      { includes: ["x86_64"], endsWith: ".AppImage" },
      { includes: ["x86_64"], endsWith: ".rpm" },
      { includes: ["amd64"], endsWith: ".rpm" },
    ],
  },
];

const platforms = {};

for (const platform of platformDefinitions) {
  const matched = findAsset(platform.patterns);
  if (!matched) {
    continue;
  }

  const signature = fs
    .readFileSync(path.join(inputDir, matched.signatureName), "utf8")
    .trim();

  platforms[platform.key] = {
    signature,
    url: `${baseUrl}/${encodeURIComponent(matched.assetName)}`,
  };
}

if (Object.keys(platforms).length === 0) {
  fail("未找到任何可用于 updater 的平台资产。");
}

const payload = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`✅ 已生成 latest.json: ${outputPath}`);
