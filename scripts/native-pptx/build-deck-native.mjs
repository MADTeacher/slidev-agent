import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import { cleanupGeneratedPptx, countPackagePlaceholders } from "./cleanup-pptx-package.mjs";
import { loadDeckSpec } from "../deck-spec.mjs";
import { resolveDeckNativeConfig } from "./deck-configs/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const W = 1280;
const H = 720;
const PX_PER_INCH = 96;

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT_DIR, "output");

const BG = "#08121C";
const PANEL = "#102130";
const PANEL_ALT = "#0D1B27";
const PANEL_SOFT = "#11293A";
const GRID = "#173245";
const FRAME = "#12455F";
const TEXT = "#F3F7FB";
const MUTED = "#A6B5C2";
const MUTED_2 = "#8092A0";
const PRIMARY = "#35E0FF";
const ACCENT = "#FFBF3C";
const DANGER = "#FF6A46";
const WHITE = "#FFFFFF";
const TRANSPARENT = "#00000000";

const TITLE_FACE = "Aptos Display";
const BODY_FACE = "Aptos";
const MONO_FACE = "Aptos Mono";
const execFileAsync = promisify(execFile);

const inspectRecords = [];
let DECK_ID = null;
let DECK_SPEC_PATH = null;
let APPROVED_PNG_DIR = null;
let OUTPUT_PPTX = null;
let SCRATCH_DIR = null;
let PREVIEW_DIR = null;
let DIAGRAM_ASSET_DIR = null;
let VERIFICATION_DIR = null;
let INSPECT_PATH = null;
let NATIVE_CONFIG = {};
let OVERRIDES = {};

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--input" || arg === "--deck-spec") && argv[index + 1]) {
      options.input = argv[index + 1];
      index += 1;
    } else if (arg === "--slug" && argv[index + 1]) {
      options.slug = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function resolveSpecSlug(spec, specPath) {
  if (spec?.metadata?.slug) {
    return spec.metadata.slug;
  }
  return path.basename(specPath, ".deck-spec.json");
}

async function initializeBuildContext(options = {}) {
  const { spec, path: specPath } = loadDeckSpec(options.input);
  const slug = options.slug || resolveSpecSlug(spec, specPath);

  NATIVE_CONFIG = resolveDeckNativeConfig(slug);
  OVERRIDES = NATIVE_CONFIG.overrides || {};

  DECK_SPEC_PATH = specPath;
  DECK_ID = NATIVE_CONFIG.deckId || `${slug}-native`;
  APPROVED_PNG_DIR = path.join(ROOT_DIR, "output", slug);
  OUTPUT_PPTX = path.join(OUT_DIR, `${slug}.pptx`);
  SCRATCH_DIR = path.join(ROOT_DIR, "tmp", "slides", DECK_ID);
  PREVIEW_DIR = path.join(SCRATCH_DIR, "preview");
  DIAGRAM_ASSET_DIR = path.join(SCRATCH_DIR, "diagram-assets");
  VERIFICATION_DIR = path.join(SCRATCH_DIR, "verification");
  INSPECT_PATH = path.join(SCRATCH_DIR, "inspect.ndjson");

  inspectRecords.length = 0;
  return { spec, slug, specPath };
}

async function ensureDirs() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await fs.mkdir(DIAGRAM_ASSET_DIR, { recursive: true });
  await fs.mkdir(VERIFICATION_DIR, { recursive: true });
}

async function readDeckSpec() {
  return JSON.parse(await fs.readFile(DECK_SPEC_PATH, "utf8"));
}

function line(fill = TRANSPARENT, width = 0) {
  if (!fill || fill === TRANSPARENT || width <= 0) {
    return { color: "000000", transparency: 100, width: 0, type: "none" };
  }
  const parsed = parseColor(fill);
  return { color: parsed.color, transparency: parsed.transparency, width, type: "solid" };
}

function normalizeColor(value, fallback = "000000") {
  const raw = String(value || fallback).trim().replace(/^#/, "");
  if (!raw) return fallback;
  return raw.length === 8 ? raw.slice(0, 6) : raw;
}

function parseColor(value, fallback = "000000") {
  const raw = String(value || fallback).trim().replace(/^#/, "");
  if (!raw) {
    return { color: fallback, transparency: 0 };
  }
  if (raw.length === 8) {
    const alpha = parseInt(raw.slice(6, 8), 16);
    return {
      color: raw.slice(0, 6),
      transparency: Math.max(0, Math.min(100, 100 - Math.round((alpha / 255) * 100))),
    };
  }
  return { color: raw, transparency: 0 };
}

function fillProps(fill) {
  if (!fill || fill === TRANSPARENT) {
    return { color: "000000", transparency: 100 };
  }
  return parseColor(fill);
}

function inches(value) {
  return Number(value || 0) / PX_PER_INCH;
}

function geometryBox(slide, left, top, width, height) {
  const offsetX = slide?._offsetX || 0;
  const offsetY = slide?._offsetY || 0;
  return {
    x: inches(left + offsetX),
    y: inches(top + offsetY),
    w: inches(width),
    h: inches(height),
  };
}

function baseSlide(slide) {
  return slide?._pptxSlide || slide;
}

function offsetSlide(slide, offsetX, offsetY) {
  return {
    _pptxSlide: baseSlide(slide),
    _offsetX: (slide?._offsetX || 0) + offsetX,
    _offsetY: (slide?._offsetY || 0) + offsetY,
  };
}

function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "")).join("\n");
  }
  return String(value ?? "");
}

function wrapText(text, widthChars = 28) {
  const value = normalizeText(text);
  if (!value) return "";
  const lines = [];
  for (const paragraph of value.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > widthChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    if (!words.length) lines.push("");
  }
  return lines.join("\n");
}

function recordShape(slideNo, role, kind, bbox, text = null) {
  if (!slideNo || slideNo < 1) return;
  inspectRecords.push({
    kind,
    slide: slideNo,
    role,
    bbox,
    ...(text ? { text, textChars: text.length, textLines: normalizeText(text).split(/\n/).length } : {}),
  });
}

function addShape(slide, slideNo, geometry, left, top, width, height, fill, stroke = TRANSPARENT, strokeWidth = 0, role = geometry) {
  baseSlide(slide).addShape(geometry, {
    ...geometryBox(slide, left, top, width, height),
    fill: fillProps(fill),
    line: line(stroke, strokeWidth),
    objectName: role,
  });
  recordShape(slideNo, role, "shape", [left, top, width, height]);
}

function addTextBox(
  slide,
  slideNo,
  text,
  left,
  top,
  width,
  height,
  {
    fontSize = 24,
    color = TEXT,
    bold = false,
    face = BODY_FACE,
    align = "left",
    valign = "top",
    fill = TRANSPARENT,
    stroke = TRANSPARENT,
    strokeWidth = 0,
    autoFit = "shrinkText",
    role = "text",
  } = {},
) {
  baseSlide(slide).addText(normalizeText(text), {
    ...geometryBox(slide, left, top, width, height),
    shape: "rect",
    margin: 0,
    valign,
    align,
    bold,
    color: normalizeColor(color, TEXT),
    fontFace: face,
    fontSize,
    fit: autoFit === "shrinkText" ? "shrink" : "none",
    fill: fillProps(fill),
    line: line(stroke, strokeWidth),
    objectName: role,
  });
  recordShape(slideNo, role, "textbox", [left, top, width, height], normalizeText(text));
}

function addRoundPanel(slide, slideNo, left, top, width, height, role, options = {}) {
  addShape(
    slide,
    slideNo,
    "roundRect",
    left,
    top,
    width,
    height,
    options.fill || PANEL,
    options.stroke || FRAME,
    options.strokeWidth ?? 1.2,
    role,
  );
}

function addLine(slide, slideNo, left, top, width, height, fill, role) {
  addShape(slide, slideNo, "rect", left, top, width, height, fill, TRANSPARENT, 0, role);
}

function addPill(slide, slideNo, text, left, top, width, height, options = {}) {
  addRoundPanel(slide, slideNo, left, top, width, height, options.role || "pill", {
    fill: options.fill || PANEL_ALT,
    stroke: options.stroke || PRIMARY,
    strokeWidth: options.strokeWidth ?? 1.6,
  });
  if (options.dot) {
    addShape(slide, slideNo, "ellipse", left + 16, top + height / 2 - 4, 8, 8, options.dotColor || ACCENT, TRANSPARENT, 0, "pill dot");
  }
  addTextBox(slide, slideNo, text, left + (options.dot ? 34 : 16), top + 5, width - (options.dot ? 50 : 32), height - 10, {
    fontSize: options.fontSize || 14,
    color: options.color || PRIMARY,
    bold: true,
    face: MONO_FACE,
    align: "center",
    valign: "middle",
    role: options.textRole || "pill text",
  });
}

async function addImageElement(slide, slideNo, filePath, left, top, width, height, options = {}) {
  const sizingType = options.fit === "cover" ? "cover" : options.fit === "crop" ? "crop" : "contain";
  baseSlide(slide).addImage({
    path: filePath,
    ...geometryBox(slide, left, top, width, height),
    sizing: {
      type: sizingType,
      w: inches(width),
      h: inches(height),
    },
    altText: options.alt || path.basename(filePath),
    objectName: options.role || "image",
  });
  recordShape(slideNo, options.role || "image", "image", [left, top, width, height], options.alt || null);
}

function addTitleBlock(slide, slideNo, spec, options = {}) {
  const override = OVERRIDES[slideNo] || {};
  if (options.kicker || override.kicker) {
    addPill(
      slide,
      slideNo,
      String(options.kicker || override.kicker).toUpperCase(),
      options.kickerLeft ?? 74,
      options.kickerTop ?? 42,
      options.kickerWidth ?? 260,
      34,
      { dot: true, fontSize: 12, role: "kicker" },
    );
  }

  addTextBox(slide, slideNo, options.title || spec.title, options.titleLeft ?? 74, options.titleTop ?? 102, options.titleWidth ?? 520, options.titleHeight ?? 120, {
    fontSize: options.titleSize ?? 48,
    bold: true,
    face: TITLE_FACE,
    role: "title",
  });

  if (options.subtitle || spec.subtitle) {
    addTextBox(
      slide,
      slideNo,
      options.subtitle || spec.subtitle,
      options.subtitleLeft ?? 76,
      options.subtitleTop ?? 218,
      options.subtitleWidth ?? 540,
      options.subtitleHeight ?? 48,
      {
        fontSize: options.subtitleSize ?? 21,
        color: MUTED,
        role: "subtitle",
      },
    );
  }
}

function drawBackground(slide, slideNo, options = {}) {
  baseSlide(slide).background = { color: normalizeColor(BG) };

  for (let x = 84; x < W - 84; x += 128) {
    addLine(slide, slideNo, x, 0, 1, H, GRID, "grid vertical");
  }
  for (let y = 96; y < H - 20; y += 96) {
    addLine(slide, slideNo, 0, y, W, 1, GRID, "grid horizontal");
  }

  addRoundPanel(slide, slideNo, 14, 16, W - 28, H - 32, "outer frame", {
    fill: "#09141E10",
    stroke: "#113043",
    strokeWidth: 1.2,
  });
  addRoundPanel(slide, slideNo, 40, 40, W - 80, H - 80, "inner frame", {
    fill: TRANSPARENT,
    stroke: "#13465E",
    strokeWidth: 1.2,
  });

  if (options.heroPanel) {
    addRoundPanel(slide, slideNo, 136, 40, 1012, 640, "hero shell", {
      fill: "#123042",
      stroke: "#155572",
      strokeWidth: 1.3,
    });
  }

  if (options.orbits) {
    addShape(slide, slideNo, "ellipse", 500, 186, 370, 210, TRANSPARENT, "#155572", 2, "orbit");
    addShape(slide, slideNo, "ellipse", 448, 150, 480, 280, TRANSPARENT, "#124055", 1.4, "orbit");
    addShape(slide, slideNo, "ellipse", 600, 210, 250, 150, TRANSPARENT, "#2B6B86", 1.5, "orbit");
  }
}

function addPanelLine(slide, slideNo, left, top, width, color = PRIMARY) {
  addLine(slide, slideNo, left, top, width, 2, color, "panel line");
}

function addBodyPanel(slide, slideNo, left, top, width, height, role = "body panel") {
  addRoundPanel(slide, slideNo, left, top, width, height, role, {
    fill: PANEL_SOFT,
    stroke: "#14526E",
    strokeWidth: 1.2,
  });
  addPanelLine(slide, slideNo, left + 26, top + 22, width - 52);
}

function addBulletPanel(slide, slideNo, items, left, top, width, height) {
  addBodyPanel(slide, slideNo, left, top, width, height, "bullet panel");
  const bulletText = (items || []).map((item) => `• ${item}`).join("\n");
  addTextBox(slide, slideNo, bulletText, left + 38, top + 48, width - 70, height - 66, {
    fontSize: 20,
    role: "bullet text",
  });
}

function formatWrappedBullets(items, widthChars = 24) {
  return (items || [])
    .map((item) => {
      const lines = wrapText(item, widthChars).split("\n");
      return lines.map((line, index) => `${index === 0 ? "•" : " "} ${line}`).join("\n");
    })
    .join("\n\n");
}

function addInfoCard(slide, slideNo, title, body, left, top, width, height, accent = PRIMARY) {
  addBodyPanel(slide, slideNo, left, top, width, height, `info card ${title}`);
  addTextBox(slide, slideNo, String(title).toUpperCase(), left + 24, top + 36, width - 48, 26, {
    fontSize: 16,
    bold: true,
    face: MONO_FACE,
    color: accent,
    role: "card title",
  });
  addTextBox(slide, slideNo, wrapText(body, Math.max(22, Math.floor(width / 14))), left + 24, top + 80, width - 48, height - 98, {
    fontSize: 18,
    color: MUTED,
    role: "card body",
  });
}

function addStatCard(slide, slideNo, value, label, left, top, width, height, accent = PRIMARY) {
  addRoundPanel(slide, slideNo, left, top, width, height, `stat ${label}`, {
    fill: PANEL_SOFT,
    stroke: "#14526E",
    strokeWidth: 1.2,
  });
  addPanelLine(slide, slideNo, left + 24, top + 20, width - 48, accent);
  addTextBox(slide, slideNo, value, left + 24, top + 52, width - 48, 48, {
    fontSize: 26,
    bold: true,
    color: accent,
    align: "center",
    valign: "middle",
    role: "stat value",
  });
  addTextBox(slide, slideNo, wrapText(label, Math.max(18, Math.floor(width / 18))), left + 22, top + 108, width - 44, 42, {
    fontSize: 13,
    color: MUTED,
    face: BODY_FACE,
    align: "center",
    role: "stat label",
  });
}

function addArrow(slide, slideNo, left, top, width, height = 18, color = ACCENT) {
  addShape(slide, slideNo, "rightArrow", left, top, width, height, color, TRANSPARENT, 0, "arrow");
}

function addNode(slide, slideNo, title, body, left, top, width, height, options = {}) {
  addRoundPanel(slide, slideNo, left, top, width, height, `node ${title}`, {
    fill: options.fill || PANEL_SOFT,
    stroke: options.stroke || PRIMARY,
    strokeWidth: 1.2,
  });
  addTextBox(slide, slideNo, title, left + 16, top + 16, width - 32, 26, {
    fontSize: options.titleSize || 16,
    face: MONO_FACE,
    color: options.titleColor || PRIMARY,
    bold: true,
    align: "center",
    role: "node title",
  });
  if (body) {
    addTextBox(slide, slideNo, wrapText(body, Math.max(14, Math.floor(width / 16))), left + 18, top + 48, width - 36, height - 62, {
      fontSize: options.bodySize || 14,
      color: MUTED,
      align: "center",
      role: "node body",
    });
  }
}

function addChipsRow(slide, slideNo, chips, startLeft, top, options = {}) {
  let x = startLeft;
  (chips || []).forEach((chip, index) => {
    const width = Math.max(options.minWidth || 148, chip.length * (options.charWidth || 8) + 48);
    const accent = options.accentIndex === index ? ACCENT : PRIMARY;
    addPill(slide, slideNo, chip.toUpperCase(), x, top, width, options.height || 34, {
      color: accent,
      stroke: accent,
      fontSize: options.fontSize || 12,
      role: "chip",
    });
    x += width + 18;
  });
}

function addSectionSlide(slide, slideNo, spec) {
  const override = OVERRIDES[slideNo];
  drawBackground(slide, slideNo, { heroPanel: true });
  addRoundPanel(slide, slideNo, 136, 198, 1008, 324, "section plate", {
    fill: "#102534",
    stroke: "#14526E",
    strokeWidth: 1.3,
  });
  addPill(slide, slideNo, override.kicker.toUpperCase(), 186, 234, 154, 34, {
    dot: true,
    role: "section kicker",
  });
  addTextBox(slide, slideNo, override.sectionNo, 188, 308, 144, 128, {
    fontSize: 96,
    bold: true,
    color: "#123247",
    face: TITLE_FACE,
    role: "section number",
  });
  const plainTitle = spec.title.replace(/^Слой\s+\d+\.\s*/, "");
  addTextBox(slide, slideNo, plainTitle, 354, 314, 610, 72, {
    fontSize: 34,
    bold: true,
    face: TITLE_FACE,
    role: "section title",
  });
  addTextBox(slide, slideNo, spec.body?.[0] || spec.subtitle || "", 356, 390, 620, 72, {
    fontSize: 22,
    color: MUTED,
    role: "section body",
  });
}

function addToolVisual(slide, slideNo) {
  addRoundPanel(slide, slideNo, 72, 164, 470, 432, "tool visual frame", {
    fill: "#0C1A26",
    stroke: "#14526E",
    strokeWidth: 1.4,
  });
  addShape(slide, slideNo, "ellipse", 232, 314, 150, 150, "#102A39", "#14526E", 1.4, "hub");
  addTextBox(slide, slideNo, "TOOL BUS", 252, 366, 110, 24, {
    fontSize: 16,
    face: MONO_FACE,
    color: PRIMARY,
    bold: true,
    align: "center",
    role: "tool bus",
  });

  const chips = [
    { text: "READ", left: 114, top: 214, accent: PRIMARY },
    { text: "SEARCH", left: 326, top: 214, accent: PRIMARY },
    { text: "WRITE", left: 114, top: 508, accent: PRIMARY },
    { text: "DEPLOY", left: 318, top: 508, accent: ACCENT },
  ];
  for (const chip of chips) {
    addPill(slide, slideNo, chip.text, chip.left, chip.top, 118, 34, {
      color: chip.accent,
      stroke: chip.accent,
      role: "tool chip",
    });
  }

  addLine(slide, slideNo, 230, 306, 2, 78, "#20566E", "tool spoke");
  addLine(slide, slideNo, 380, 306, 2, 78, "#20566E", "tool spoke");
  addLine(slide, slideNo, 230, 388, 2, 84, "#20566E", "tool spoke");
  addLine(slide, slideNo, 380, 388, 2, 84, "#20566E", "tool spoke");
  addLine(slide, slideNo, 168, 348, 86, 2, "#20566E", "tool spoke");
  addLine(slide, slideNo, 358, 348, 88, 2, "#20566E", "tool spoke");
  addLine(slide, slideNo, 168, 452, 86, 2, "#20566E", "tool spoke");
  addLine(slide, slideNo, 358, 452, 88, 2, "#20566E", "tool spoke");
}

function addRoleVisual(slide, slideNo) {
  drawBackground(slide, slideNo);
  addRoundPanel(slide, slideNo, 132, 92, 1010, 548, "role frame", {
    fill: "#0D1C28",
    stroke: "#14526E",
    strokeWidth: 1.3,
  });
  addTextBox(slide, slideNo, "Планировщик, диспетчер, исполнитель", 164, 224, 720, 52, {
    fontSize: 34,
    bold: true,
    face: TITLE_FACE,
    role: "roles title",
  });
  addTextBox(slide, slideNo, "Три роли внутри одного контура.", 166, 284, 420, 34, {
    fontSize: 18,
    color: MUTED,
    role: "roles subtitle",
  });

  addNode(slide, slideNo, "Планировщик", "Разбирает запрос и выбирает стратегию.", 214, 380, 232, 132, {
    stroke: PRIMARY,
    titleColor: PRIMARY,
    titleSize: 18,
  });
  addNode(slide, slideNo, "Диспетчер", "Маршрутизирует шаги по агентам и инструментам.", 524, 322, 232, 132, {
    stroke: ACCENT,
    titleColor: ACCENT,
    titleSize: 18,
  });
  addNode(slide, slideNo, "Исполнитель", "Делает вызов, собирает артефакт, шлет статус.", 832, 380, 232, 132, {
    stroke: DANGER,
    titleColor: DANGER,
    titleSize: 18,
  });
  addArrow(slide, slideNo, 454, 426, 52, 18, ACCENT);
  addArrow(slide, slideNo, 764, 426, 52, 18, ACCENT);
}

function addTimelinePanel(slide, slideNo, title, items, left, top, width, height) {
  addBodyPanel(slide, slideNo, left, top, width, height, "timeline panel");
  addTextBox(slide, slideNo, title.toUpperCase(), left + 26, top + 34, width - 52, 22, {
    fontSize: 14,
    face: MONO_FACE,
    bold: true,
    color: PRIMARY,
    role: "timeline title",
  });
  let y = top + 84;
  items.forEach((item) => {
    addLine(slide, slideNo, left + 36, y + 16, 2, 42, "#20566E", "timeline stem");
    addShape(slide, slideNo, "ellipse", left + 28, y + 10, 16, 16, PRIMARY, TRANSPARENT, 0, "timeline dot");
    addTextBox(slide, slideNo, item, left + 62, y, width - 88, 48, {
      fontSize: 16,
      color: MUTED,
      role: "timeline item",
    });
    y += 78;
  });
}

function addTableRows(slide, slideNo, rows, left, top, width) {
  addBodyPanel(slide, slideNo, left, top, width, 412, "table panel");
  const colWidths = [156, 160, 160, 152];
  rows.forEach((row, rowIndex) => {
    const y = top + 42 + rowIndex * 92;
    let cursor = left + 24;
    row.forEach((cell, cellIndex) => {
      const cellW = colWidths[cellIndex] || 150;
      addRoundPanel(slide, slideNo, cursor, y, cellW, 68, `table cell ${rowIndex}-${cellIndex}`, {
        fill: rowIndex === 0 ? "#123246" : "#11202D",
        stroke: rowIndex === 0 ? ACCENT : "#1E4D66",
        strokeWidth: 1,
      });
      addTextBox(slide, slideNo, wrapText(cell, cellIndex === 0 ? 14 : 18), cursor, y + 22, cellW, 40, {
        fontSize: cellIndex === 0 ? 13 : 15,
        bold: rowIndex === 0,
        color: rowIndex === 0 ? TEXT : MUTED,
        align: "center",
        role: "table text",
      });
      cursor += cellW + 16;
    });
  });
}

function addProcessDiagram(slide, slideNo, steps, options = {}) {
  const count = steps.length;
  const nodeW = options.nodeWidth || (count >= 5 ? 140 : 180);
  const nodeH = options.nodeHeight || 98;
  const gap = options.gap || 32;
  let x = options.left || 646;
  const y = options.top || 286;

  steps.forEach((step, index) => {
    addNode(slide, slideNo, step.title, step.body, x, y, nodeW, nodeH, {
      stroke: index === count - 1 && options.lastAccent ? options.lastAccent : PRIMARY,
      titleColor: index === count - 1 && options.lastAccent ? options.lastAccent : PRIMARY,
      bodySize: options.bodySize || 13,
      titleSize: options.titleSize || 15,
    });
    if (index < count - 1) {
      addArrow(slide, slideNo, x + nodeW + 8, y + nodeH / 2 - 9, gap - 14, 18, ACCENT);
    }
    x += nodeW + gap;
  });
}

function addFanOutDiagram(slide, slideNo) {
  addNode(slide, slideNo, "Общий контекст", "Одна база для всех веток.", 640, 294, 168, 92, {
    bodySize: 13,
  });
  const branchTitles = [
    ["Контент", 902, 150],
    ["Дизайн", 1038, 254],
    ["Иллюстрации", 1038, 388],
    ["Диаграммы", 902, 492],
  ];
  branchTitles.forEach(([title, x, y]) => {
    addNode(slide, slideNo, title, "Своя ветка и артефакт.", x, y, 152, 84, {
      bodySize: 12,
      titleSize: 14,
      stroke: PRIMARY,
    });
  });
  addNode(slide, slideNo, "Сборка", "Сведение в единый пакет.", 1118, 294, 120, 84, {
    bodySize: 12,
    titleSize: 14,
    stroke: ACCENT,
    titleColor: ACCENT,
  });
  addNode(slide, slideNo, "Ревью", "Только после review ветки готовы.", 1110, 430, 132, 84, {
    bodySize: 12,
    titleSize: 14,
    stroke: DANGER,
    titleColor: DANGER,
  });

  addArrow(slide, slideNo, 814, 327, 74, 16, ACCENT);
  addLine(slide, slideNo, 838, 270, 2, 192, "#20566E", "fan stem");
  addLine(slide, slideNo, 840, 190, 40, 2, "#20566E", "fan branch");
  addLine(slide, slideNo, 840, 304, 176, 2, "#20566E", "fan branch");
  addLine(slide, slideNo, 840, 438, 176, 2, "#20566E", "fan branch");
  addLine(slide, slideNo, 840, 542, 40, 2, "#20566E", "fan branch");
  addArrow(slide, slideNo, 1066, 316, 42, 16, ACCENT);
  addArrow(slide, slideNo, 1180, 398, 40, 16, DANGER);
}

function addPipelineDiagram(slide, slideNo, steps) {
  const y = 318;
  let x = 106;
  steps.forEach((step, index) => {
    const width = index === 2 ? 226 : 188;
    const accent = index === steps.length - 1 ? ACCENT : PRIMARY;
    addNode(slide, slideNo, step.title, step.body, x, y, width, 100, {
      stroke: accent,
      titleColor: accent,
      bodySize: 13,
      titleSize: 15,
    });
    if (index < steps.length - 1) {
      addArrow(slide, slideNo, x + width + 10, y + 40, 46, 18, ACCENT);
    }
    x += width + 56;
  });
}

function addPipelineDiagramCompact(slide, slideNo, steps) {
  const y = 72;
  let x = 34;
  steps.forEach((step, index) => {
    const width = index === 2 ? 238 : index === steps.length - 1 ? 206 : 204;
    const accent = index === steps.length - 1 ? ACCENT : PRIMARY;
    addNode(slide, slideNo, step.title, step.body, x, y, width, 82, {
      stroke: accent,
      titleColor: accent,
      bodySize: 14,
      titleSize: 18,
    });
    if (index < steps.length - 1) {
      addArrow(slide, slideNo, x + width + 10, y + 36, 34, 16, ACCENT);
    }
    x += width + 46;
  });
}

async function buildApprovedDiagramCrop(spec) {
  const cropConfig = NATIVE_CONFIG.approvedDiagramCrops?.[spec.number];
  if (!cropConfig) {
    return null;
  }

  const sourceSlide = cropConfig.sourceSlide || spec.number;
  const sourcePath = path.join(APPROVED_PNG_DIR, `${sourceSlide}.png`);
  const assetPath = path.join(
    DIAGRAM_ASSET_DIR,
    cropConfig.outputName || `diagram-slide-${String(spec.number).padStart(2, "0")}-approved-crop.png`,
  );
  await fs.mkdir(DIAGRAM_ASSET_DIR, { recursive: true });
  try {
    await fs.access(sourcePath);
  } catch {
    return null;
  }
  await execFileAsync("sips", [
    "-c",
    String(cropConfig.crop.height),
    String(cropConfig.crop.width),
    "--cropOffset",
    String(cropConfig.crop.offsetY ?? 0),
    String(cropConfig.crop.offsetX ?? 0),
    sourcePath,
    "--out",
    assetPath,
  ]);
  return {
    assetPath,
    frame: cropConfig.frame,
  };
}

function addFanOutDiagramCompact(slide, slideNo) {
  addRoundPanel(slide, slideNo, 0, 0, 640, 430, "diagram image panel", {
    fill: PANEL_SOFT,
    stroke: "#14526E",
    strokeWidth: 1.2,
  });
  addPanelLine(slide, slideNo, 24, 22, 592);
  addNode(slide, slideNo, "Общий контекст", "Одна база для всех веток.", 74, 168, 168, 90, {
    bodySize: 13,
  });
  const branchTitles = [
    ["Контент", 334, 40],
    ["Дизайн", 334, 136],
    ["Иллюстрации", 334, 232],
    ["Диаграммы", 334, 328],
  ];
  branchTitles.forEach(([title, x, y]) => {
    addNode(slide, slideNo, title, "Своя ветка и артефакт.", x, y, 158, 74, {
      bodySize: 11,
      titleSize: 14,
      stroke: PRIMARY,
    });
  });
  addNode(slide, slideNo, "Сборка", "Сведение в единый пакет.", 530, 168, 94, 78, {
    bodySize: 11,
    titleSize: 13,
    stroke: ACCENT,
    titleColor: ACCENT,
  });
  addArrow(slide, slideNo, 252, 202, 48, 14, ACCENT);
  addLine(slide, slideNo, 286, 76, 2, 288, "#20566E", "fan stem compact");
  addLine(slide, slideNo, 288, 78, 32, 2, "#20566E", "fan branch compact");
  addLine(slide, slideNo, 288, 174, 32, 2, "#20566E", "fan branch compact");
  addLine(slide, slideNo, 288, 270, 32, 2, "#20566E", "fan branch compact");
  addLine(slide, slideNo, 288, 366, 32, 2, "#20566E", "fan branch compact");
  addArrow(slide, slideNo, 498, 202, 24, 14, ACCENT);
}

function buildConfiguredDiagramLayout(spec, layoutConfig) {
  if (!layoutConfig) {
    return null;
  }

  if (layoutConfig.kind === "fanOutCompact") {
    return {
      frame: layoutConfig.frame,
      asset: layoutConfig.asset,
      render(slide) {
        addFanOutDiagramCompact(slide, 0);
      },
    };
  }

  if (layoutConfig.kind === "process") {
    return {
      frame: layoutConfig.frame,
      asset: layoutConfig.asset,
      render(slide) {
        addRoundPanel(slide, 0, 0, layoutConfig.asset.width, layoutConfig.asset.height, "diagram image panel", {
          fill: PANEL_SOFT,
          stroke: "#14526E",
          strokeWidth: 1.2,
        });
        addPanelLine(slide, 0, 24, 20, layoutConfig.asset.width - 48);
        addProcessDiagram(slide, 0, spec.process.steps, layoutConfig.processOptions);
      },
    };
  }

  return null;
}

function getDiagramImageLayout(spec) {
  const configuredLayout =
    buildConfiguredDiagramLayout(spec, NATIVE_CONFIG.diagramImageLayouts?.[spec.number]) ||
    buildConfiguredDiagramLayout(spec, NATIVE_CONFIG.diagramImageLayouts?.default);
  if (configuredLayout) {
    return configuredLayout;
  }

  if (spec.number === 13) {
    return {
      frame: { left: 608, top: 144, width: 620, height: 418 },
      asset: { width: 640, height: 430 },
      render(slide) {
        addFanOutDiagramCompact(slide, 0);
      },
    };
  }

  if (spec.number === 17) {
    return {
      frame: { left: 622, top: 304, width: 586, height: 176 },
      asset: { width: 620, height: 188 },
      render(slide) {
        addRoundPanel(slide, 0, 0, 620, 188, "diagram image panel", {
          fill: PANEL_SOFT,
          stroke: "#14526E",
          strokeWidth: 1.2,
        });
        addPanelLine(slide, 0, 24, 20, 572);
        addProcessDiagram(slide, 0, spec.process.steps, {
          left: 24,
          top: 52,
          nodeWidth: 170,
          nodeHeight: 104,
          gap: 18,
          bodySize: 13,
          titleSize: 15,
          lastAccent: DANGER,
        });
      },
    };
  }

  if (spec.number === 18) {
    return {
      frame: { left: 708, top: 30, width: 500, height: 544 },
      asset: { width: 1140, height: 244 },
      render(slide) {
        addRoundPanel(slide, 0, 0, 1140, 244, "diagram image panel", {
          fill: PANEL_SOFT,
          stroke: "#14526E",
          strokeWidth: 1.2,
        });
        addPanelLine(slide, 0, 28, 24, 1084);
        addPipelineDiagramCompact(slide, 0, spec.process.steps);
      },
    };
  }

  return {
    frame: { left: 548, top: 298, width: 644, height: 214 },
    asset: { width: 664, height: 232 },
    render(slide) {
      addRoundPanel(slide, 0, 0, 664, 232, "diagram image panel", {
        fill: PANEL_SOFT,
        stroke: "#14526E",
        strokeWidth: 1.2,
      });
      addPanelLine(slide, 0, 24, 20, 616);
      const options =
        spec.number === 8
          ? {
              left: 26,
              top: 64,
              nodeWidth: 120,
              nodeHeight: 96,
              gap: 16,
              bodySize: 12,
              titleSize: 14,
              lastAccent: DANGER,
            }
          : {
              left: 18,
              top: 64,
              nodeWidth: 116,
              nodeHeight: 96,
              gap: 14,
              bodySize: 11,
              titleSize: 13,
              lastAccent: ACCENT,
            };
      addProcessDiagram(slide, 0, spec.process.steps, options);
    },
  };
}

async function buildDiagramImageAsset(spec) {
  return buildApprovedDiagramCrop(spec);
}

function addNotes(slide, spec) {
  const notes = normalizeText(spec.speakerNotes || []).trim();
  if (notes) {
    baseSlide(slide).addNotes(notes);
  }
}

function renderNativeDiagramLayout(slide, spec) {
  const layout = getDiagramImageLayout(spec);
  layout.render(offsetSlide(slide, layout.frame.left, layout.frame.top));
}

function renderCover(slide, spec) {
  const override = OVERRIDES[1];
  drawBackground(slide, 1, { heroPanel: true, orbits: true });
  addPill(slide, 1, override.kicker.toUpperCase(), 436, 76, 408, 40, { dot: true, role: "cover kicker", fontSize: 15 });
  addTextBox(slide, 1, spec.title, 330, 150, 620, 86, {
    fontSize: 58,
    bold: true,
    face: TITLE_FACE,
    align: "center",
    role: "cover title",
  });
  addTextBox(slide, 1, spec.subtitle, 368, 232, 542, 34, {
    fontSize: 22,
    color: MUTED,
    align: "center",
    role: "cover subtitle",
  });
  addTextBox(slide, 1, override.intro, 366, 286, 548, 34, {
    fontSize: 18,
    color: MUTED,
    bold: true,
    align: "center",
    role: "cover intro",
  });
  addChipsRow(slide, 1, spec.bullets, 312, 368, { accentIndex: 2, minWidth: 142, charWidth: 8, fontSize: 14 });
  override.cards.forEach((card, index) => {
    addInfoCard(slide, 1, card.title, card.body, 182 + index * 322, 452, 286, 188, PRIMARY);
  });
}

function renderComparison(slide, spec) {
  const override = OVERRIDES[spec.number] || {};
  drawBackground(slide, spec.number);
  addTitleBlock(slide, spec.number, spec, {
    kicker: override.kicker,
    titleWidth: 462,
    titleHeight: 140,
    titleSize: spec.number === 7 ? 42 : 54,
    subtitleTop: spec.number === 7 ? 228 : 230,
    subtitleWidth: 500,
  });

  addLine(slide, spec.number, 640, 58, 2, 604, "#173B4D", "divider");

  if (spec.number === 2) {
    addInfoCard(slide, spec.number, override.leftLabel, override.leftBody, 72, 324, 514, 196, ACCENT);
    addChipsRow(slide, spec.number, override.chips, 74, 548, { accentIndex: 1, minWidth: 236, charWidth: 8, fontSize: 12 });
    override.rightBoxes.forEach((box, index) => {
      addInfoCard(slide, spec.number, box.title, box.body, 694, 72 + index * 166, 512, 132, PRIMARY);
    });
    return;
  }

  addBulletPanel(slide, spec.number, spec.bullets, 74, 304, 506, 186);
  addTableRows(slide, spec.number, spec.table.rows, 692, 170, 520);
}

function renderStats(slide, spec) {
  const override = OVERRIDES[spec.number] || {};
  drawBackground(slide, spec.number, { heroPanel: spec.number === 4 || spec.number === 6 || spec.number === 12 });

  if (spec.number === 14) {
    addTitleBlock(slide, spec.number, spec, {
      kicker: override.kicker,
      titleLeft: 180,
      titleTop: 90,
      titleWidth: 510,
      titleHeight: 74,
      titleSize: 36,
      subtitleLeft: 182,
      subtitleTop: 194,
      subtitleWidth: 420,
      subtitleSize: 19,
    });
    const accents = [PRIMARY, ACCENT, DANGER, TEXT];
    spec.stats.slice(0, 4).forEach((stat, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      addStatCard(slide, spec.number, stat.value, stat.label, 182 + col * 252, 282 + row * 168, 220, 142, accents[index]);
    });
    addTextBox(slide, spec.number, normalizeText(spec.body), 182, 610, 470, 28, {
      fontSize: 16,
      color: MUTED_2,
      role: "stats footer",
    });
    addTimelinePanel(slide, spec.number, override.timelineTitle, override.timeline, 724, 138, 420, 482);
    return;
  }

  addTitleBlock(slide, spec.number, spec, {
    kicker: override.kicker,
    titleLeft: 182,
    titleTop: 88,
    titleWidth: 920,
    titleHeight: 114,
    titleSize: spec.number === 4 ? 58 : 46,
    subtitleLeft: 184,
    subtitleTop: spec.number === 4 ? 220 : 202,
    subtitleWidth: 740,
  });

  const accents = [PRIMARY, ACCENT, DANGER, TEXT];
  spec.stats.slice(0, 4).forEach((stat, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    addStatCard(
      slide,
      spec.number,
      stat.value,
      stat.label,
      184 + col * 498,
      266 + row * 188,
      444,
      162,
      accents[index],
    );
  });

  if (spec.body?.length) {
    addTextBox(slide, spec.number, normalizeText(spec.body), 184, 636, 914, 30, {
      fontSize: 16,
      color: MUTED,
      role: "stats footer",
    });
  }

  if (spec.number === 6) {
    addChipsRow(slide, spec.number, ["Система", "Задача", "История", "Память", "Инструменты", "Артефакты"], 184, 620, {
      accentIndex: 4,
      minWidth: 112,
      charWidth: 7,
      height: 30,
      fontSize: 11,
    });
  }
}

async function renderDiagram(slide, spec) {
  const override = OVERRIDES[spec.number] || {};
  drawBackground(slide, spec.number);

  const configuredDiagramSlide = NATIVE_CONFIG.diagramSlideLayouts?.[spec.number];
  if (configuredDiagramSlide?.mode === "bullet_panel_with_image") {
    addTitleBlock(slide, spec.number, spec, {
      kicker: override.kicker,
      ...configuredDiagramSlide.titleBlock,
    });
    addBodyPanel(
      slide,
      spec.number,
      configuredDiagramSlide.bulletPanel.left,
      configuredDiagramSlide.bulletPanel.top,
      configuredDiagramSlide.bulletPanel.width,
      configuredDiagramSlide.bulletPanel.height,
      "diagram bullet panel",
    );
    addTextBox(
      slide,
      spec.number,
      formatWrappedBullets(spec.bullets, configuredDiagramSlide.bulletText.wrapWidthChars),
      configuredDiagramSlide.bulletText.left,
      configuredDiagramSlide.bulletText.top,
      configuredDiagramSlide.bulletText.width,
      configuredDiagramSlide.bulletText.height,
      {
        fontSize: configuredDiagramSlide.bulletText.fontSize,
        role: "diagram bullets",
      },
    );
    const diagramImage = await buildDiagramImageAsset(spec);
    if (diagramImage) {
      await addImageElement(
        slide,
        spec.number,
        diagramImage.assetPath,
        diagramImage.frame.left,
        diagramImage.frame.top,
        diagramImage.frame.width,
        diagramImage.frame.height,
        { role: "diagram image", alt: `diagram slide ${spec.number}` },
      );
    } else {
      renderNativeDiagramLayout(slide, spec);
    }
    return;
  }

  addTitleBlock(slide, spec.number, spec, {
    kicker: override.kicker,
    titleWidth: spec.number === 17 ? 560 : 474,
    titleHeight: spec.number === 17 ? 108 : 126,
    titleSize: spec.number === 17 ? 44 : 52,
  });

  if (spec.number === 17) {
    addBulletPanel(slide, spec.number, spec.bullets, 72, 320, 462, 256);
    const diagramImage = await buildDiagramImageAsset(spec);
    if (diagramImage) {
      await addImageElement(
        slide,
        spec.number,
        diagramImage.assetPath,
        diagramImage.frame.left,
        diagramImage.frame.top,
        diagramImage.frame.width,
        diagramImage.frame.height,
        { role: "diagram image", alt: `diagram slide ${spec.number}` },
      );
    } else {
      renderNativeDiagramLayout(slide, spec);
    }
    return;
  }

  addBulletPanel(slide, spec.number, spec.bullets, 72, 302, 430, spec.number === 13 ? 230 : 364);
  const diagramImage = await buildDiagramImageAsset(spec);
  if (diagramImage) {
    await addImageElement(
      slide,
      spec.number,
      diagramImage.assetPath,
      diagramImage.frame.left,
      diagramImage.frame.top,
      diagramImage.frame.width,
      diagramImage.frame.height,
      { role: "diagram image", alt: `diagram slide ${spec.number}` },
    );
  } else {
    renderNativeDiagramLayout(slide, spec);
  }
}

function renderContent(slide, spec) {
  const override = OVERRIDES[spec.number] || {};
  drawBackground(slide, spec.number);

  if (spec.number === 19) {
    addTitleBlock(slide, spec.number, spec, {
      kicker: override.kicker,
      titleLeft: 164,
      titleTop: 92,
      titleWidth: 930,
      titleHeight: 84,
      titleSize: 48,
      subtitleLeft: 166,
      subtitleTop: 188,
      subtitleWidth: 720,
    });
    const tiles = [
      ...spec.callouts.map((item) => ({ title: item.title, body: item.body })),
    ];
    tiles.forEach((tile, index) => {
      const col = index < 3 ? index : index - 3;
      const row = index < 3 ? 0 : 1;
      const x = row === 0 ? 164 + col * 314 : 320 + col * 314;
      const y = row === 0 ? 304 : 474;
      addInfoCard(slide, spec.number, tile.title, tile.body, x, y, 262, 138, index === 1 ? ACCENT : PRIMARY);
    });
    return;
  }

  if (spec.number === 9) {
    addToolVisual(slide, spec.number);
    addTitleBlock(slide, spec.number, spec, {
      kicker: override.kicker,
      titleLeft: 618,
      titleTop: 96,
      titleWidth: 540,
      titleHeight: 120,
      titleSize: 46,
      subtitleLeft: 620,
      subtitleTop: 220,
      subtitleWidth: 460,
    });
    addBulletPanel(slide, spec.number, spec.bullets, 620, 286, 558, 182);
    spec.callouts.forEach((callout, index) => {
      addInfoCard(slide, spec.number, callout.title, callout.body, 620 + index * 188, 500, 170, 132, index === 1 ? ACCENT : PRIMARY);
    });
    return;
  }

  addTitleBlock(slide, spec.number, spec, {
    kicker: override.kicker,
    titleWidth: 512,
    titleHeight: 120,
    titleSize: 48,
  });
  addBulletPanel(slide, spec.number, spec.bullets, 72, 286, 482, 210);

  if (spec.number === 16) {
    addInfoCard(slide, spec.number, spec.callouts[0].title, spec.callouts[0].body, 654, 166, 470, 124, PRIMARY);
    addInfoCard(slide, spec.number, spec.callouts[1].title, spec.callouts[1].body, 654, 316, 470, 124, DANGER);
    addInfoCard(slide, spec.number, spec.callouts[2].title, spec.callouts[2].body, 654, 466, 470, 124, ACCENT);
    addBodyPanel(slide, spec.number, 72, 524, 482, 114, "resilience footer");
    addTextBox(
      slide,
      spec.number,
      "Повторяем только обратимые операции. После лимита переводим шаг в review или human gate.",
      98,
      560,
      432,
      52,
      { fontSize: 18, color: MUTED, role: "resilience footer text" },
    );
  }
}

function renderImage(slide, spec) {
  addRoleVisual(slide, spec.number);
}

function renderClosing(slide, spec) {
  const override = OVERRIDES[20];
  drawBackground(slide, spec.number, { heroPanel: true, orbits: true });
  addPill(slide, spec.number, override.kicker.toUpperCase(), 502, 104, 218, 40, { dot: true, role: "closing kicker" });
  addTextBox(slide, spec.number, spec.title, 286, 210, 708, 86, {
    fontSize: 44,
    bold: true,
    face: TITLE_FACE,
    align: "center",
    role: "closing title",
  });
  addTextBox(slide, spec.number, spec.subtitle, 350, 296, 580, 36, {
    fontSize: 22,
    color: MUTED,
    align: "center",
    role: "closing subtitle",
  });
  addChipsRow(slide, spec.number, override.chips, 300, 388, { accentIndex: 1, minWidth: 170, charWidth: 8, fontSize: 12 });
  addTextBox(slide, spec.number, spec.body?.[0] || "", 236, 510, 808, 42, {
    fontSize: 28,
    bold: true,
    align: "center",
    role: "closing statement",
  });
}

async function renderSlide(slide, spec) {
  if (spec.kind === "cover") {
    renderCover(slide, spec);
  } else if (spec.kind === "section") {
    addSectionSlide(slide, spec.number, spec);
  } else if (spec.kind === "stats") {
    renderStats(slide, spec);
  } else if (spec.kind === "comparison") {
    renderComparison(slide, spec);
  } else if (spec.kind === "diagram") {
    await renderDiagram(slide, spec);
  } else if (spec.kind === "content") {
    renderContent(slide, spec);
  } else if (spec.kind === "image") {
    renderImage(slide, spec);
  } else if (spec.kind === "closing") {
    renderClosing(slide, spec);
  }
}

async function writeInspect(slideCount) {
  const records = [
    JSON.stringify({ kind: "deck", id: DECK_ID, slideCount, slideSize: { width: W, height: H } }),
    ...inspectRecords.map((record) => JSON.stringify(record)),
  ];
  await fs.writeFile(INSPECT_PATH, records.join("\n") + "\n", "utf8");
}

async function currentRenderLoopCount() {
  try {
    const log = await fs.readFile(path.join(VERIFICATION_DIR, "render_verify_loops.ndjson"), "utf8");
    return log.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function createDeck() {
  const deck = await readDeckSpec();
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "Slidev Agent";
  presentation.company = "Slidev Agent";
  presentation.subject = deck.metadata?.title || DECK_ID;
  presentation.title = deck.metadata?.title || DECK_ID;
  presentation.lang = "ru-RU";

  for (const spec of deck.slides) {
    const slide = presentation.addSlide();
    await renderSlide(slide, spec);
    addNotes(slide, spec);
  }

  return { presentation, slideCount: deck.slides.length };
}

async function verifyAndExport(presentation, slideCount) {
  await ensureDirs();
  const loop = (await currentRenderLoopCount()) + 1;

  await writeInspect(slideCount);
  const previewPaths = [];

  await presentation.writeFile({ fileName: OUTPUT_PPTX });
  const cleanup = await cleanupGeneratedPptx(OUTPUT_PPTX);
  const placeholderCount = await countPackagePlaceholders(OUTPUT_PPTX);

  const loopRecord = {
    kind: "render_verify_loop",
    deckId: DECK_ID,
    loop,
    timestamp: new Date().toISOString(),
    slideCount,
    previewDir: PREVIEW_DIR,
    inspectPath: INSPECT_PATH,
    pptxPath: OUTPUT_PPTX,
    cleanupTouchedFiles: cleanup.touchedFiles,
    placeholderCount,
  };
  await fs.appendFile(path.join(VERIFICATION_DIR, "render_verify_loops.ndjson"), `${JSON.stringify(loopRecord)}\n`, "utf8");

  return { previewPaths, pptxPath: OUTPUT_PPTX, placeholderCount };
}

export async function runNativeDeckBuild(options = {}) {
  await initializeBuildContext(options);
  const { presentation, slideCount } = await createDeck();
  const result = await verifyAndExport(presentation, slideCount);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runNativeDeckBuild(parseCliArgs());
  console.log(result.pptxPath);
}
