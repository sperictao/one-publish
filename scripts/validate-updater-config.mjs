import fs from 'node:fs';
import path from 'node:path';

const configPath = process.argv[2] || 'src-tauri/tauri.conf.updater.prod.json';
const resolvedPath = path.resolve(process.cwd(), configPath);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!fs.existsSync(resolvedPath)) {
  fail(`未找到更新配置文件: ${resolvedPath}`);
}

let config;
try {
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  config = JSON.parse(raw);
} catch (error) {
  fail(`读取或解析 JSON 失败: ${error.message}`);
}

const updater = config?.plugins?.updater;
if (!updater || typeof updater !== 'object') {
  fail('缺少 plugins.updater 配置');
}

const pubkey = String(updater.pubkey || '').trim();
if (!pubkey || pubkey.includes('REPLACE_WITH')) {
  fail('updater.pubkey 为空或仍是占位值');
}

const endpoints = Array.isArray(updater.endpoints) ? updater.endpoints : [];
if (endpoints.length === 0) {
  fail('updater.endpoints 不能为空');
}

for (const endpoint of endpoints) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    fail('updater.endpoints 中存在空地址');
  }

  const value = endpoint.trim();
  if (!value.startsWith('https://')) {
    fail(`更新地址必须使用 https: ${value}`);
  }
}

console.log(`✅ Updater 配置校验通过: ${resolvedPath}`);
