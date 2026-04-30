#!/usr/bin/env node
/**
 * verify.mjs — обертка над Playwright для проверки HTML-презентаций
 *
 * Использование:
 *   node verify.mjs path/to/deck.html                            # базово: открыть, снять скриншот и собрать ошибки консоли
 *   node verify.mjs deck.html --viewports 1920x1080,1440x900     # несколько размеров viewport
 *   node verify.mjs deck.html --slides 10                        # снять скриншоты слайдов постранично (первые 10)
 *   node verify.mjs deck.html --output ./screenshots/            # каталог вывода
 *   node verify.mjs deck.html --strict-console                   # считать console warning фатальной ошибкой
 *   node verify.mjs deck.html --allow-console-errors             # не валить проверку на console error
 *   node verify.mjs deck.html --show                             # открыть настоящее окно браузера
 *
 * Зависимости:
 *   npm install playwright
 *   npx playwright install chromium
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

function parseViewport(s) {
  const [w, h] = s.split('x');
  return { width: parseInt(w, 10), height: parseInt(h, 10) };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {
    viewports: '1440x900',
    slides: 0,
    output: null,
    show: false,
    wait: 2000,
    strictConsole: false,
    allowConsoleErrors: false,
  };
  let htmlPath = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--show') { opts.show = true; continue; }
    if (token === '--strict-console') { opts.strictConsole = true; continue; }
    if (token === '--allow-console-errors') { opts.allowConsoleErrors = true; continue; }
    if (token.startsWith('--')) {
      const k = token.replace(/^--/, '');
      opts[k] = argv[++i];
      continue;
    }
    if (!htmlPath) htmlPath = token;
  }

  if (!htmlPath) {
    console.error('Использование: node verify.mjs <html_path> [--viewports WxH,...] [--slides N] [--output dir] [--show] [--wait ms] [--strict-console] [--allow-console-errors]');
    process.exit(1);
  }

  opts.slides = parseInt(opts.slides, 10) || 0;
  opts.wait = parseInt(opts.wait, 10) || 2000;

  return { htmlPath, ...opts };
}

async function verify() {
  const {
    htmlPath,
    viewports: vpArg,
    slides,
    output,
    show,
    wait,
    strictConsole,
    allowConsoleErrors,
  } = parseArgs();

  const resolved = path.resolve(htmlPath);
  try { await fs.access(resolved); } catch {
    console.error(`ОШИБКА: файл не найден: ${resolved}`);
    process.exit(1);
  }

  const outDir = output ? path.resolve(output) : path.join(path.dirname(resolved), 'screenshots');
  await fs.mkdir(outDir, { recursive: true });

  const fileUrl = pathToFileURL(resolved).href;
  const stem = path.basename(resolved, path.extname(resolved));
  const viewports = vpArg.split(',').map(parseViewport);

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];

  const browser = await chromium.launch({ headless: !show });

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => pageErrors.push(String(err)));

    console.log(`\n→ Открываю ${fileUrl} @ ${viewport.width}x${viewport.height}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(wait);

    if (slides > 0) {
      for (let i = 0; i < slides; i++) {
        const name = `${stem}-slide-${String(i + 1).padStart(2, '0')}.png`;
        const dest = path.join(outDir, name);
        await page.screenshot({ path: dest, fullPage: false });
        console.log(`  ✓ Слайд ${i + 1} → ${name}`);

        if (i < slides - 1) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(500);
        }
      }
    } else {
      const suffix = viewports.length > 1 ? `-${viewport.width}x${viewport.height}` : '';
      const name = `${stem}${suffix}.png`;
      const dest = path.join(outDir, name);
      await page.screenshot({ path: dest, fullPage: false });
      console.log(`  ✓ Скриншот → ${name}`);

      const fullName = `${stem}${suffix}-full.png`;
      const fullDest = path.join(outDir, fullName);
      await page.screenshot({ path: fullDest, fullPage: true });
      console.log(`  ✓ Полная страница → ${fullName}`);
    }

    if (show) {
      console.log('  (окно браузера остается открытым; нажмите Ctrl+C, чтобы закрыть)');
      await new Promise(() => {});
    }

    await context.close();
  }

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('Отчет проверки');
  console.log('='.repeat(50));

  if (pageErrors.length) {
    console.log(`\n❌ Ошибки страницы (${pageErrors.length}):`);
    for (const e of pageErrors) console.log(`  - ${e}`);
  } else {
    console.log('\n✅ Ошибок JavaScript нет');
  }

  if (consoleErrors.length) {
    console.log(`\n❌ Ошибки консоли (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 20)) console.log(`  - ${e}`);
    if (consoleErrors.length > 20) console.log(`  ... еще ${consoleErrors.length - 20}`);
  } else {
    console.log('✅ Ошибок консоли нет');
  }

  if (consoleWarnings.length) {
    const marker = strictConsole ? '❌' : '⚠️';
    console.log(`\n${marker} Предупреждения консоли (${consoleWarnings.length}):`);
    for (const e of consoleWarnings.slice(0, 20)) console.log(`  - ${e}`);
    if (consoleWarnings.length > 20) console.log(`  ... еще ${consoleWarnings.length - 20}`);
  } else {
    console.log('✅ Предупреждений консоли нет');
  }

  console.log(`\n📸 Скриншоты сохранены в: ${outDir}`);

  const fatalConsole = !allowConsoleErrors && (consoleErrors.length || (strictConsole && consoleWarnings.length));
  process.exit(pageErrors.length || fatalConsole ? 1 : 0);
}

verify().catch(e => { console.error(e); process.exit(1); });
