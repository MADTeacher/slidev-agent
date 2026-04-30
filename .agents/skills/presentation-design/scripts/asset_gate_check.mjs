#!/usr/bin/env node
/**
 * asset_gate_check.mjs — проверяет asset-manifest.json до дизайна и экспорта.
 *
 * Использование:
 *   node scripts/asset_gate_check.mjs --manifest asset-manifest.json --mode predesign
 *   node scripts/asset_gate_check.mjs --slides slides --manifest asset-manifest.json --mode preexport
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const VALID_MODES = new Set(['predesign', 'preexport']);
const RASTER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PASSING_SOURCE_KINDS = new Set(['local', 'user', 'open_source', 'imagegen']);
const FALLBACK_KINDS = new Set(['svg_fallback', 'placeholder']);
const FORBIDDEN_CREATED_WITH = new Set([
  'svg',
  'svg_origin',
  'svg-origin',
  'html_css',
  'html/css',
  'canvas',
  'screenshot',
]);
const PROTECTED_TYPES = new Set([
  'character',
  'person',
  'people',
  'child',
  'human',
  'body',
  'anatomy',
  'clothes',
  'clothing',
  'accessory',
  'scene',
  'object',
  'food',
  'animal',
  'plant',
  'transport',
  'product',
  'place',
  'historical image',
  'historical_image',
  'lesson visual',
  'lesson_visual',
  'young esl card',
  'young_esl_card',
  'subject card',
  'subject_card',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: 'preexport', manifest: 'asset-manifest.json' };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    args[key] = argv[i + 1];
    i += 1;
  }
  if (!VALID_MODES.has(args.mode)) {
    throw new Error(`Неверный --mode "${args.mode}". Используй predesign или preexport.`);
  }
  return args;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function isProtected(visual) {
  if (visual.protected === true) return true;
  return PROTECTED_TYPES.has(normalize(visual.visual_type));
}

function isFallback(visual) {
  return FALLBACK_KINDS.has(normalize(visual.source_kind)) || FALLBACK_KINDS.has(normalize(visual.status));
}

function hasSvgData(value) {
  return /^data:image\/svg\+xml/i.test(String(value || '').trim());
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function loadManifest(manifestPath) {
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Не найден ${manifestPath}. Создай asset-manifest.json в рабочей директории презентации. ` +
        'Для презентации без предметных визуалов допустимо {"target_format":"html","visuals":[]}.'
      );
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${manifestPath} содержит невалидный JSON: ${error.message}`);
  }
}

async function checkVisual(visual, index, rootDir, slidesDir) {
  const errors = [];
  const warnings = [];
  const label = visual && visual.id ? `visual "${visual.id}"` : `visual #${index + 1}`;

  if (!visual || typeof visual !== 'object' || Array.isArray(visual)) {
    return { errors: [`${label}: запись должна быть JSON-объектом.`], warnings };
  }

  const protectedVisual = isProtected(visual);
  const fallback = isFallback(visual);
  const sourceKind = normalize(visual.source_kind);
  const status = normalize(visual.status);
  const createdWith = normalize(visual.created_with);
  const visualPath = String(visual.path || '').trim();

  if (!visual.id) errors.push(`${label}: нет обязательного id.`);
  if (!visual.visual_type) errors.push(`${label}: нет visual_type.`);
  if (!visual.role) warnings.push(`${label}: role пустой; агенту будет сложнее понять назначение визуала.`);

  if (slidesDir && Array.isArray(visual.slides)) {
    for (const slide of visual.slides) {
      const slidePath = path.resolve(slidesDir, slide);
      if (!await fileExists(slidePath)) {
        errors.push(`${label}: slide "${slide}" не найден в ${slidesDir}.`);
      }
    }
  }

  if (!protectedVisual) {
    if (visualPath && !hasSvgData(visualPath)) {
      const resolved = path.resolve(rootDir, visualPath);
      if (!await fileExists(resolved)) {
        warnings.push(`${label}: файл ${visualPath} не найден. Для непредметного визуала это warning, но экспорт может упасть позже.`);
      }
    }
    return { errors, warnings };
  }

  if (fallback) {
    if (visual.fallback_approved_by_user !== true) {
      errors.push(`${label}: fallback для protected visual не подтвержден пользователем.`);
    }
    if (!visual.fallback_reason) {
      errors.push(`${label}: fallback_reason обязателен для protected visual fallback.`);
    }
    if (visualPath && !hasSvgData(visualPath)) {
      const resolved = path.resolve(rootDir, visualPath);
      if (!await fileExists(resolved)) {
        errors.push(`${label}: fallback-файл ${visualPath} не найден.`);
      }
    }
    if (hasSvgData(visualPath)) {
      warnings.push(`${label}: используется data:image/svg fallback; он должен быть явно назван как fallback в сдаче.`);
    }
    return { errors, warnings };
  }

  if (!PASSING_SOURCE_KINDS.has(sourceKind)) {
    errors.push(`${label}: source_kind "${visual.source_kind || ''}" не проходит gate. Нужен local, user, open_source или imagegen.`);
  }
  if (status !== 'ok') {
    errors.push(`${label}: status должен быть "ok" для реального raster visual.`);
  }
  if (!visualPath) {
    errors.push(`${label}: path обязателен для protected visual.`);
  } else if (hasSvgData(visualPath)) {
    errors.push(`${label}: data:image/svg+xml запрещен для protected visual.`);
  } else {
    const ext = path.extname(visualPath).toLowerCase();
    if (!RASTER_EXTS.has(ext)) {
      errors.push(`${label}: path должен вести к PNG/JPG/JPEG/WebP, получено "${ext || 'без расширения'}".`);
    }
    const resolved = path.resolve(rootDir, visualPath);
    if (!await fileExists(resolved)) {
      errors.push(`${label}: файл ${visualPath} не найден.`);
    }
  }
  if (FORBIDDEN_CREATED_WITH.has(createdWith)) {
    errors.push(`${label}: created_with "${visual.created_with}" запрещен для protected visual.`);
  }
  if ((sourceKind === 'imagegen' || sourceKind === 'open_source' || sourceKind === 'user') && !visual.evidence) {
    errors.push(`${label}: evidence обязателен для source_kind "${sourceKind}".`);
  }

  return { errors, warnings };
}

export async function checkAssetGate(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const manifestPath = path.resolve(rootDir, options.manifest || 'asset-manifest.json');
  const slidesDir = options.slides ? path.resolve(rootDir, options.slides) : null;
  const manifest = await loadManifest(manifestPath);
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push('asset-manifest.json должен быть JSON-объектом.');
  }
  if (!Array.isArray(manifest.visuals)) {
    errors.push('asset-manifest.json должен содержать массив visuals.');
  }
  if (errors.length) return { errors, warnings, manifestPath };

  for (let i = 0; i < manifest.visuals.length; i++) {
    const result = await checkVisual(manifest.visuals[i], i, rootDir, slidesDir);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings, manifestPath };
}

async function runCli() {
  const args = parseArgs();
  const result = await checkAssetGate({
    manifest: args.manifest,
    slides: args.slides,
    mode: args.mode,
  });

  for (const warning of result.warnings) console.error(`Предупреждение: ${warning}`);
  if (result.errors.length) {
    console.error(`Asset gate failed: ${result.manifestPath}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Asset gate OK: ${result.manifestPath}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
