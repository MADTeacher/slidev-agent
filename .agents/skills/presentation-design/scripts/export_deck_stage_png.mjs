#!/usr/bin/env node
/**
 * export_deck_stage_png.mjs — экспортирует однофайловую <deck-stage> презентацию в PNG.
 *
 * Использование:
 *   node export_deck_stage_png.mjs --html <deck.html> --out <dir> --slides <n> [--width 1920] [--height 1080] [--scale 2] [--wait 300]
 *
 * Когда использовать этот скрипт:
 *   - презентация — это один HTML-файл, все слайды — `<section>`, обернутые в `<deck-stage>`
 *   - `export_deck_png.mjs` здесь не подходит, потому что он рассчитан на папку HTML-слайдов
 *
 * Зависимость: npm install playwright
 * Перед экспортом требуется asset-manifest.json в рабочей директории презентации.
 */

import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { checkAssetGate } from './asset_gate_check.mjs';

function parseArgs() {
  const args = { width: 1920, height: 1080, scale: 2, wait: 300 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    args[k] = a[i + 1];
  }
  if (!args.html || !args.out || !args.slides) {
    console.error('Использование: node export_deck_stage_png.mjs --html <deck.html> --out <dir> --slides <n> [--width 1920] [--height 1080] [--scale 2] [--wait 300]');
    process.exit(1);
  }
  args.width = parseInt(args.width, 10);
  args.height = parseInt(args.height, 10);
  args.scale = parseFloat(args.scale);
  args.slides = parseInt(args.slides, 10);
  args.wait = parseInt(args.wait, 10);
  if (!Number.isFinite(args.slides) || args.slides <= 0) {
    console.error('--slides должен быть положительным числом.');
    process.exit(1);
  }
  return args;
}

async function main() {
  const { html, out, slides, width, height, scale, wait } = parseArgs();
  const htmlAbs = path.resolve(html);
  const outDir = path.resolve(out);

  const assetGate = await checkAssetGate({ mode: 'preexport' });
  for (const warning of assetGate.warnings) console.error(`Предупреждение asset gate: ${warning}`);
  if (assetGate.errors.length) {
    console.error(`Asset gate failed: ${assetGate.manifestPath}`);
    assetGate.errors.forEach(error => console.error(`- ${error}`));
    process.exit(1);
  }

  await fs.access(htmlAbs).catch(() => {
    console.error(`HTML-файл не найден: ${htmlAbs}`);
    process.exit(1);
  });
  await fs.mkdir(outDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await ctx.addInitScript(() => {
    try { localStorage.clear(); } catch (e) {}
  });

  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlAbs).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForFunction(() => {
    const stage = document.querySelector('deck-stage');
    return Boolean(stage && stage.totalSlides > 0);
  });
  await page.waitForTimeout(wait);

  const actualSlides = await page.evaluate(() => document.querySelector('deck-stage').totalSlides);
  if (actualSlides !== slides) {
    await browser.close();
    console.error(`Ожидалось слайдов: ${slides}, найдено в <deck-stage>: ${actualSlides}. Исправьте --slides или структуру deck.`);
    process.exit(1);
  }

  const stem = path.basename(htmlAbs, path.extname(htmlAbs));
  console.log(`Экспортируем PNG из deck-stage: ${actualSlides} слайдов`);

  for (let i = 0; i < actualSlides; i++) {
    await page.evaluate((idx) => {
      document.querySelector('deck-stage').goTo(idx);
    }, i);
    await page.waitForTimeout(wait);

    const output = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${stem}.png`);
    await page.screenshot({ path: output, fullPage: false });
    console.log(`  [${i + 1}/${actualSlides}] ${output}`);
  }

  await browser.close();
  console.log(`\nГотово: ${outDir}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
