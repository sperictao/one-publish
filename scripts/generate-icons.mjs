import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');

// 读取 SVG 文件
const svgPath = path.join(iconsDir, 'icon.svg');
const svgContent = fs.readFileSync(svgPath, 'utf-8');

// 超采样倍数（4x 可以显著提高质量）
const SUPERSAMPLE_FACTOR = 4;

// 定义需要生成的尺寸
const sizes = {
  // macOS / Linux
  '32x32.png': 32,
  '64x64.png': 64,
  '128x128.png': 128,
  '128x128@2x.png': 256,
  'icon.png': 1024,

  // Windows
  'Square30x30Logo.png': 30,
  'Square44x44Logo.png': 44,
  'Square71x71Logo.png': 71,
  'Square89x89Logo.png': 89,
  'Square107x107Logo.png': 107,
  'Square142x142Logo.png': 142,
  'Square150x150Logo.png': 150,
  'Square284x284Logo.png': 284,
  'Square310x310Logo.png': 310,
  'StoreLogo.png': 50,
};

const icnsEntries = [
  { type: 'icp4', size: 16 },
  { type: 'ic11', size: 32 },
  { type: 'icp5', size: 32 },
  { type: 'ic12', size: 64 },
  { type: 'ic07', size: 128 },
  { type: 'ic13', size: 256 },
  { type: 'ic08', size: 256 },
  { type: 'ic14', size: 512 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
];

/**
 * 使用超采样渲染高质量图标
 * @param {string} svgContent - SVG 内容
 * @param {number} targetSize - 目标尺寸
 * @returns {Promise<Buffer>} PNG Buffer
 */
async function renderHighQuality(svgContent, targetSize) {
  // 计算超采样尺寸（最大不超过 4096，避免内存问题）
  const supersampleSize = Math.min(targetSize * SUPERSAMPLE_FACTOR, 4096);

  // 如果目标尺寸已经很大，不需要超采样
  const actualSupersample = supersampleSize > targetSize ? supersampleSize : targetSize;

  // 使用 resvg 渲染超采样尺寸
  const resvg = new Resvg(svgContent, {
    fitTo: {
      mode: 'width',
      value: actualSupersample,
    },
    // 启用字体抗锯齿
    font: {
      loadSystemFonts: true,
    },
    // 图像渲染质量
    imageRendering: 0, // optimizeQuality
    shapeRendering: 2, // geometricPrecision
  });

  const pngData = resvg.render();
  const supersampledBuffer = pngData.asPng();

  // 如果不需要缩放，直接返回
  if (actualSupersample === targetSize) {
    return supersampledBuffer;
  }

  // 使用 sharp 进行高质量缩放
  const resizedBuffer = await sharp(supersampledBuffer)
    .resize(targetSize, targetSize, {
      kernel: sharp.kernel.lanczos3, // Lanczos3 算法，高质量缩放
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({
      compressionLevel: 9, // 最高压缩
      adaptiveFiltering: true,
      palette: false, // 保持真彩色
    })
    .toBuffer();

  return resizedBuffer;
}

function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });

  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 'ascii');
  fileHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);

  return Buffer.concat([fileHeader, ...chunks]);
}

console.log('🎨 生成高质量 PNG 图标 (4x 超采样 + Lanczos3)...\n');

const renderedBufferCache = new Map();

async function getRenderedBuffer(size) {
  if (!renderedBufferCache.has(size)) {
    renderedBufferCache.set(size, await renderHighQuality(svgContent, size));
  }
  return renderedBufferCache.get(size);
}

for (const [filename, size] of Object.entries(sizes)) {
  const buffer = await getRenderedBuffer(size);
  const outputPath = path.join(iconsDir, filename);
  fs.writeFileSync(outputPath, buffer);

  const supersampleSize = Math.min(size * SUPERSAMPLE_FACTOR, 4096);
  const ratio = supersampleSize > size ? `${SUPERSAMPLE_FACTOR}x` : '1x';
  console.log(`✅ ${filename} (${size}x${size}, ${ratio} 超采样)`);
}

console.log('\n✨ PNG 图标生成完成！');

// 生成 ICO 文件 (Windows)
console.log('\n🪟 生成 Windows ICO 文件...');
try {
  const pngFiles = [
    path.join(iconsDir, '32x32.png'),
    path.join(iconsDir, '64x64.png'),
    path.join(iconsDir, '128x128.png'),
    path.join(iconsDir, '128x128@2x.png'),
  ];
  const icoBuffer = await pngToIco(pngFiles);
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
  console.log('✅ icon.ico 生成成功');
} catch (err) {
  console.error('❌ ICO 生成失败:', err.message);
}

// 生成 ICNS 文件 (macOS)
console.log('\n🍎 生成 macOS ICNS 文件...');
try {
  const icnsBuffer = buildIcns(
    await Promise.all(
      icnsEntries.map(async ({ type, size }) => ({
        type,
        data: await getRenderedBuffer(size),
      }))
    )
  );

  fs.writeFileSync(path.join(iconsDir, 'icon.icns'), icnsBuffer);
  console.log('✅ icon.icns 生成成功');
} catch (err) {
  console.error('❌ ICNS 生成失败:', err.message);
  console.log('   提示: ICNS 生成需要标准 PNG 数据与有效的 ICNS chunk 映射');
}

console.log('\n🎉 所有图标生成完成！');
console.log('\n📊 质量优化说明:');
console.log('   • 使用 4x 超采样渲染');
console.log('   • Lanczos3 高质量缩放算法');
console.log('   • PNG 最高压缩级别');
