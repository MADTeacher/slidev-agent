#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const TOOL_NAME = 'presentation_svg_pipeline.mjs';
const RENDER_TIMEOUT_MS = 15000;

const blockedElementPatterns = [
  { label: '<script>', re: /<\s*script\b/i },
  { label: '<foreignObject>', re: /<\s*foreignObject\b/i },
  { label: '<iframe>', re: /<\s*iframe\b/i },
  { label: '<object>', re: /<\s*object\b/i },
  { label: '<embed>', re: /<\s*embed\b/i },
  { label: '<audio>', re: /<\s*audio\b/i },
  { label: '<video>', re: /<\s*video\b/i },
  { label: '<canvas>', re: /<\s*canvas\b/i }
];

const blockedTextPatterns = [
  { label: 'обработчик события on*', re: /\s+on[a-z0-9_-]+\s*=/i },
  { label: 'javascript:', re: /javascript\s*:/i },
  { label: 'data:', re: /data\s*:/i },
  { label: 'внешний href', re: /\b(?:xlink:)?href\s*=\s*['"](?!#)[^'"]+['"]/i },
  { label: 'src=', re: /\bsrc\s*=/i },
  { label: '@import', re: /@import\b/i },
  { label: 'внешний url(...)', re: /url\(\s*['"]?\s*(?:https?:|file:|\/\/|data:)/i },
  { label: '<!DOCTYPE>', re: /<!DOCTYPE\b/i },
  { label: '<!ENTITY>', re: /<!ENTITY\b/i }
];

function printHelp() {
  console.log(`Использование:
  node ${TOOL_NAME} validate <file.svg>
  node ${TOOL_NAME} render <file.svg> <preview.png> [--width 1920] [--height 1080] [--renderer auto|sharp|rsvg-convert|magick|inkscape]
  node ${TOOL_NAME} audit <file.svg> <preview.png> [--width 1920] [--height 1080] [--renderer auto|sharp|rsvg-convert|magick|inkscape]
  node ${TOOL_NAME} --smoke [--require-render]

Команды:
  validate  Проверяет структуру SVG и опасные конструкции.
  render    Создаёт PNG через доступный рендерер.
  audit     Запускает validate, затем render.
  --smoke   Создаёт временный SVG, проверяет его и пробует PNG-рендер.
`);
}

function fail(message, code = 1) {
  console.error(`Ошибка: ${message}`);
  process.exit(code);
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function parseOptions(args) {
  const options = {
    width: undefined,
    height: undefined,
    renderer: 'auto',
    requireRender: false
  };
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const item = args[i];
    if (item === '--width') {
      options.width = readPositiveInt(args[++i], '--width');
    } else if (item === '--height') {
      options.height = readPositiveInt(args[++i], '--height');
    } else if (item === '--renderer') {
      options.renderer = args[++i] || 'auto';
    } else if (item === '--require-render') {
      options.requireRender = true;
    } else {
      rest.push(item);
    }
  }

  return { rest, options };
}

function readPositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${flag} ждёт положительное целое число.`);
  }
  return parsed;
}

function ensureFile(path) {
  if (!path) fail('не указан путь к SVG.');
  if (!existsSync(path)) fail(`файл не найден: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) fail(`это не файл: ${path}`);
}

function validateSvg(filePath, { quiet = false } = {}) {
  ensureFile(filePath);
  const text = readFileSync(filePath, 'utf8');
  const errors = [];
  const warnings = [];

  if (extname(filePath).toLowerCase() !== '.svg') {
    warnings.push('расширение файла не .svg');
  }
  if (!/<\s*svg\b/i.test(text)) {
    errors.push('не найден корневой элемент <svg>');
  }
  if (!/<\s*\/\s*svg\s*>/i.test(text)) {
    warnings.push('не найден явный закрывающий </svg>; проверьте XML вручную');
  }
  if (!/viewBox\s*=\s*['"][^'"]+['"]/i.test(text)) {
    warnings.push('нет viewBox; PNG может обрезаться или масштабироваться странно');
  }
  if (!/<\s*title\b/i.test(text)) {
    warnings.push('нет <title>; доступность хуже');
  }
  if (!/<\s*desc\b/i.test(text)) {
    warnings.push('нет <desc>; описание изображения отсутствует');
  }
  if (Buffer.byteLength(text, 'utf8') > 2_000_000) {
    warnings.push('файл больше 2 МБ; проверьте лишние точки, фильтры и невидимые группы');
  }

  for (const item of blockedElementPatterns) {
    if (item.re.test(text)) errors.push(`найден запрещённый элемент: ${item.label}`);
  }
  for (const item of blockedTextPatterns) {
    if (item.re.test(text)) errors.push(`найден запрещённый признак: ${item.label}`);
  }

  const xmlLint = commandExists('xmllint');
  if (xmlLint) {
    const result = spawnSync('xmllint', ['--noout', filePath], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0) {
      errors.push(`xmllint сообщил об ошибке XML: ${(result.stderr || result.stdout || '').trim()}`);
    }
  } else {
    warnings.push('xmllint не найден; выполнена базовая проверка XML и безопасности');
  }

  if (!quiet) {
    for (const warning of warnings) console.warn(`Предупреждение: ${warning}`);
    if (errors.length > 0) {
      for (const error of errors) console.error(`Ошибка: ${error}`);
    }
  }

  return { errors, warnings };
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (!result.error) return true;
  return result.error.code !== 'ENOENT';
}

function sharpAvailable() {
  try {
    require.resolve('sharp');
    return true;
  } catch {
    return false;
  }
}

function rendererCandidates(requested) {
  const allowed = ['auto', 'sharp', 'rsvg-convert', 'magick', 'inkscape'];
  if (!allowed.includes(requested)) {
    fail(`неизвестный рендерер: ${requested}. Разрешены: ${allowed.join(', ')}.`);
  }
  return requested === 'auto' ? ['sharp', 'rsvg-convert', 'magick', 'inkscape'] : [requested];
}

async function trySharp(inputSvg, outputPng, options) {
  if (!sharpAvailable()) {
    return { ok: false, error: 'sharp не установлен' };
  }
  try {
    const sharp = require('sharp');
    let pipeline = sharp(inputSvg, { density: 144 });
    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width, options.height, { fit: 'contain', withoutEnlargement: false });
    }
    await pipeline.png().toFile(outputPng);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function commandForRenderer(renderer, inputSvg, outputPng, options) {
  if (renderer === 'rsvg-convert') {
    const args = ['--format=png', '-o', outputPng];
    if (options.width) args.push('-w', String(options.width));
    if (options.height) args.push('-h', String(options.height));
    args.push(inputSvg);
    return { command: 'rsvg-convert', args };
  }

  if (renderer === 'magick') {
    const args = [inputSvg];
    if (options.width || options.height) {
      const width = options.width ? String(options.width) : '';
      const height = options.height ? String(options.height) : '';
      args.push('-resize', `${width}x${height}`);
    }
    args.push(outputPng);
    return { command: 'magick', args };
  }

  if (renderer === 'inkscape') {
    const args = [inputSvg, '--export-type=png', `--export-filename=${outputPng}`];
    if (options.width) args.push(`--export-width=${options.width}`);
    if (options.height) args.push(`--export-height=${options.height}`);
    return { command: 'inkscape', args };
  }

  return null;
}

function tryCommandRenderer(renderer, inputSvg, outputPng, options) {
  const spec = commandForRenderer(renderer, inputSvg, outputPng, options);
  if (!spec) return { ok: false, error: `рендерер не поддержан: ${renderer}` };
  if (!commandExists(spec.command)) return { ok: false, error: `${spec.command} не найден` };

  const result = spawnSync(spec.command, spec.args, { encoding: 'utf8', timeout: RENDER_TIMEOUT_MS });
  if (result.error) {
    const text = result.error.code === 'ETIMEDOUT'
      ? `таймаут ${RENDER_TIMEOUT_MS} мс`
      : result.error.message;
    return { ok: false, error: text };
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    return { ok: false, error: details || `код выхода ${result.status}` };
  }
  return { ok: true };
}

async function attemptRenderSvg(inputSvg, outputPng, options) {
  ensureFile(inputSvg);
  if (!outputPng) fail('не указан путь к PNG.');
  mkdirSync(dirname(outputPng), { recursive: true });

  const attempts = [];
  for (const renderer of rendererCandidates(options.renderer)) {
    const result = renderer === 'sharp'
      ? await trySharp(inputSvg, outputPng, options)
      : tryCommandRenderer(renderer, inputSvg, outputPng, options);

    if (result.ok && existsSync(outputPng) && statSync(outputPng).size > 0) {
      return { ok: true, renderer };
    }
    attempts.push(`${renderer}: ${result.error || 'PNG не создан'}`);
  }

  return { ok: false, attempts };
}

async function renderSvg(inputSvg, outputPng, options) {
  const result = await attemptRenderSvg(inputSvg, outputPng, options);
  if (!result.ok) {
    fail(`PNG-рендер не выполнен. Попытки: ${result.attempts.join('; ')}`, 2);
  }
  ok(`PNG создан через ${result.renderer}: ${outputPng}`);
  return result.renderer;
}

async function smoke(options) {
  const dir = await mkdtemp(join(tmpdir(), 'presentation-svg-pipeline-'));
  const svgPath = join(dir, 'smoke.svg');
  const pngPath = join(dir, 'smoke.png');
  const smokeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" role="img" aria-labelledby="title desc">
  <title id="title">Проверочный презентационный SVG</title>
  <desc id="desc">Простой безопасный 16:9 SVG для проверки скрипта презентационного навыка.</desc>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="1" stop-color="#67e8f9"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#g)"/>
  <circle cx="1280" cy="540" r="170" fill="#fef3c7" opacity="0.88"/>
  <path d="M420 390H900M420 510H780M420 630H680" stroke="#ffffff" stroke-width="28" stroke-linecap="round" opacity="0.8"/>
</svg>`;
  writeFileSync(svgPath, smokeSvg, 'utf8');

  try {
    const validation = validateSvg(svgPath);
    if (validation.errors.length > 0) fail('smoke SVG не прошёл validate.');
    ok('smoke validate прошёл');

    const renderResult = await attemptRenderSvg(svgPath, pngPath, options);
    if (renderResult.ok) {
      ok(`PNG создан через ${renderResult.renderer}: ${pngPath}`);
      ok('smoke render прошёл');
    } else if (options.requireRender) {
      fail(`smoke render не прошёл. Попытки: ${renderResult.attempts.join('; ')}`, 2);
    } else {
      console.warn(`Предупреждение: smoke render пропущен или не прошёл: ${renderResult.attempts.join('; ')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    return;
  }

  const { rest, options } = parseOptions(rawArgs);
  if (rest.includes('--smoke')) {
    await smoke(options);
    return;
  }

  const command = rest[0];
  const inputSvg = rest[1] ? resolve(rest[1]) : undefined;
  const outputPng = rest[2] ? resolve(rest[2]) : undefined;

  if (command === 'validate') {
    const validation = validateSvg(inputSvg);
    if (validation.errors.length > 0) process.exit(1);
    ok(`SVG прошёл проверку: ${inputSvg}`);
    return;
  }

  if (command === 'render') {
    await renderSvg(inputSvg, outputPng, options);
    return;
  }

  if (command === 'audit') {
    const validation = validateSvg(inputSvg);
    if (validation.errors.length > 0) process.exit(1);
    ok(`SVG прошёл проверку: ${inputSvg}`);
    await renderSvg(inputSvg, outputPng, options);
    ok('audit завершён: откройте PNG и проверьте слайдовую читаемость');
    return;
  }

  fail(`неизвестная команда: ${command}`);
}

main().catch((error) => {
  fail(error?.message || String(error));
});
