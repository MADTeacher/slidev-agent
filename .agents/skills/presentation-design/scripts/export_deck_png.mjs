#!/usr/bin/env node
/**
 * export_deck_png.mjs — экспортирует многофайловую HTML-презентацию в PNG.
 *
 * Использование:
 *   node export_deck_png.mjs --slides <dir> --out <dir> [--width 1920] [--height 1080] [--scale 2]
 *
 * Слайды сортируются по имени файла.
 * Перед экспортом требуется asset-manifest.json в рабочей директории презентации.
 * Зависимость: npm install playwright
 */

import fs from 'fs/promises';
import path from 'path';
import { checkAssetGate } from './asset_gate_check.mjs';

function parseArgs() {
  const args = { width: 1920, height: 1080, scale: 2 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    args[k] = a[i + 1];
  }
  if (!args.slides || !args.out) {
    console.error('Использование: node export_deck_png.mjs --slides <dir> --out <dir> [--width 1920] [--height 1080] [--scale 2]');
    process.exit(1);
  }
  args.width = parseInt(args.width, 10);
  args.height = parseInt(args.height, 10);
  args.scale = parseFloat(args.scale);
  return args;
}

async function main() {
  const { slides, out, width, height, scale } = parseArgs();
  const slidesDir = path.resolve(slides);
  const outDir = path.resolve(out);

  const assetGate = await checkAssetGate({ slides, mode: 'preexport' });
  for (const warning of assetGate.warnings) console.error(`Предупреждение asset gate: ${warning}`);
  if (assetGate.errors.length) {
    console.error(`Asset gate failed: ${assetGate.manifestPath}`);
    assetGate.errors.forEach(error => console.error(`- ${error}`));
    process.exit(1);
  }

  const files = (await fs.readdir(slidesDir))
    .filter(f => f.endsWith('.html'))
    .sort();
  if (!files.length) {
    console.error(`В ${slidesDir} не найдены .html-файлы`);
    process.exit(1);
  }

  await fs.mkdir(outDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });

  console.log(`Экспортируем PNG: ${files.length} слайдов`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const page = await ctx.newPage();
    const url = 'file://' + path.join(slidesDir, file);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(300);

    const base = path.basename(file, '.html');
    const output = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${base}.png`);
    await page.screenshot({ path: output, fullPage: false });
    await page.close();
    console.log(`  [${i + 1}/${files.length}] ${output}`);
  }

  await browser.close();
  console.log(`\nГотово: ${outDir}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
