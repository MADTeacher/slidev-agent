#!/usr/bin/env node
/**
 * export_deck_stage_pdf.mjs — экспорт PDF для однофайловой архитектуры <deck-stage>
 *
 * Использование:
 *   node export_deck_stage_pdf.mjs --html <deck.html> --out <file.pdf> [--width 1920] [--height 1080]
 *
 * Когда использовать этот скрипт:
 *   - презентация — это **один HTML-файл**, все слайды — `<section>`, обернутые в `<deck-stage>`
 *   - `export_deck_pdf.mjs` здесь не подходит, потому что он рассчитан на многофайловые презентации
 *
 * Почему нельзя просто вызвать `page.pdf()` (заметка о проблеме от 2026-04-20):
 *   1. Shadow CSS deck-stage `::slotted(section) { display: none }` оставляет видимым только активный слайд
 *   2. В print media внешний `!important` не перебивает правила shadow DOM
 *   3. Итог: PDF всегда содержит только 1 страницу (активный слайд)
 *
 * Решение:
 *   После открытия HTML через page.evaluate достаем все section из slot внутри deck-stage,
 *   переносим их в обычный div под body, инлайн-стилями задаем position:relative и фиксированный размер,
 *   каждому section ставим page-break-after: always, а последнему auto, чтобы не получить пустую страницу в конце.
 *
 * Зависимости: playwright
 *   npm install playwright
 *
 * Особенности вывода:
 *   - Текст остается векторным (можно копировать и искать)
 *   - Визуальная точность 1:1
 *   - Шрифты должны загружаться Chromium (локальные шрифты или Google Fonts)
 * Перед экспортом требуется asset-manifest.json в рабочей директории презентации.
 */

import fs from 'fs/promises';
import path from 'path';
import { checkAssetGate } from './asset_gate_check.mjs';

function parseArgs() {
  const args = { width: 1920, height: 1080 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    args[k] = a[i + 1];
  }
  if (!args.html || !args.out) {
    console.error('Использование: node export_deck_stage_pdf.mjs --html <deck.html> --out <file.pdf> [--width 1920] [--height 1080]');
    process.exit(1);
  }
  args.width = parseInt(args.width);
  args.height = parseInt(args.height);
  return args;
}

async function main() {
  const { html, out, width, height } = parseArgs();
  const htmlAbs = path.resolve(html);
  const outFile = path.resolve(out);

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

  console.log(`Рендерим ${path.basename(htmlAbs)} → ${path.basename(outFile)}`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();

  await page.goto('file://' + htmlAbs, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);  // Ждем Google Fonts и инициализацию deck-stage

  // Ключевая правка: достаем section из slot shadow DOM и разворачиваем их в обычный поток
  const sectionCount = await page.evaluate(({ W, H }) => {
    const stage = document.querySelector('deck-stage');
    if (!stage) throw new Error('<deck-stage> не найден — этот скрипт подходит только для однофайловой архитектуры deck-stage');
    const sections = Array.from(stage.querySelectorAll(':scope > section'));
    if (!sections.length) throw new Error('Внутри <deck-stage> не найден ни один <section>');

    // Внедряем стили для печати
    const style = document.createElement('style');
    style.textContent = `
      @page { size: ${W}px ${H}px; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
      deck-stage { display: none !important; }
    `;
    document.head.appendChild(style);

    // Разворачиваем слайды под body
    const container = document.createElement('div');
    container.id = 'print-container';
    sections.forEach(s => {
      // Инлайн-стиль получает наивысший приоритет; position:relative корректно ограничивает absolute-потомков
      s.style.cssText = `
        width: ${W}px !important;
        height: ${H}px !important;
        display: block !important;
        position: relative !important;
        overflow: hidden !important;
        page-break-after: always !important;
        break-after: page !important;
        margin: 0 !important;
        padding: 0 !important;
      `;
      container.appendChild(s);
    });
    // На последней странице не добавляем разрыв, чтобы не получить пустой хвост
    const last = sections[sections.length - 1];
    last.style.pageBreakAfter = 'auto';
    last.style.breakAfter = 'auto';
    document.body.appendChild(container);
    return sections.length;
  }, { W: width, H: height });

  await page.waitForTimeout(800);

  await page.pdf({
    path: outFile,
    width: `${width}px`,
    height: `${height}px`,
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  const stat = await fs.stat(outFile);
  const kb = (stat.size / 1024).toFixed(0);
  console.log(`\n✓ Записан файл ${outFile}  (${kb} KB, страниц: ${sectionCount}, векторный PDF)`);
  console.log(`  Проверьте число страниц: mdimport "${outFile}" && pdfinfo "${outFile}" | grep Pages`);
}

main().catch(e => { console.error(e); process.exit(1); });
