import fs from "node:fs";
import path from "node:path";

const outputPath = path.resolve(
  process.cwd(),
  process.argv[2] || "src-tauri/tauri.conf.updater.prod.json"
);
const updaterEndpoint =
  process.env.TAURI_UPDATER_ENDPOINT?.trim() ||
  "https://github.com/sperictao/one-publish/releases/latest/download/latest.json";
const updaterPubkey = process.env.TAURI_UPDATER_PUBKEY?.trim() || "";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!updaterPubkey) {
  fail("缺少环境变量 TAURI_UPDATER_PUBKEY，无法生成 updater 生产配置。");
}

const payload = {
  bundle: {
    createUpdaterArtifacts: true,
  },
  plugins: {
    updater: {
      pubkey: updaterPubkey,
      endpoints: [updaterEndpoint],
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`✅ 已生成 updater 配置: ${outputPath}`);
