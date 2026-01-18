/**
 * 生成托盘图标脚本
 * 用于生成 macOS template 图标和 Windows 托盘图标
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ICONS_DIR = join(__dirname, '../src-tauri/icons');
const TRAY_DIR = join(ICONS_DIR, 'tray');

async function generateMacOSTemplateIcons() {
  console.log('生成 macOS template 图标...');

  const svgPath = join(TRAY_DIR, 'macos/statusbar_template.svg');
  const svgBuffer = readFileSync(svgPath);

  // 生成 22x22 (@1x)
  await sharp(svgBuffer)
    .resize(22, 22)
    .png()
    .toFile(join(TRAY_DIR, 'macos/statusbar_template.png'));
  console.log('  ✓ statusbar_template.png (22x22)');

  // 生成 44x44 (@2x) - 使用更大的 SVG 重新渲染以保持清晰度
  const svg2x = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="44" height="44" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="11" cy="11" r="2.5" fill="black"/>
  <path d="M 5.5 5.5 A 7.5 7.5 0 1 1 5.5 16.5"
        fill="none"
        stroke="black"
        stroke-width="2"
        stroke-linecap="round"/>
</svg>`;

  await sharp(Buffer.from(svg2x))
    .resize(44, 44)
    .png()
    .toFile(join(TRAY_DIR, 'macos/statusbar_template@2x.png'));
  console.log('  ✓ statusbar_template@2x.png (44x44)');
}

async function generateWindowsTrayIcon() {
  console.log('生成 Windows 托盘图标...');

  const windowsDir = join(TRAY_DIR, 'windows');
  if (!existsSync(windowsDir)) {
    mkdirSync(windowsDir, { recursive: true });
  }

  // 复制现有的 32x32 彩色图标
  const sourcePath = join(ICONS_DIR, '32x32.png');
  const destPath = join(windowsDir, 'tray_icon.png');

  copyFileSync(sourcePath, destPath);
  console.log('  ✓ tray_icon.png (32x32, 彩色)');
}

async function main() {
  console.log('开始生成托盘图标...\n');

  await generateMacOSTemplateIcons();
  await generateWindowsTrayIcon();

  console.log('\n托盘图标生成完成！');
}

main().catch(console.error);
