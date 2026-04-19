import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const SCHEMA_PATH = path.join(ROOT_DIR, "schemas", "deck-spec.schema.json");
const SLIDES_PATH = path.join(ROOT_DIR, "slides.md");

function newestEntry(directory, entries) {
  return entries
    .map((name) => ({
      name,
      mtimeMs: fs.statSync(path.join(directory, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name ?? null;
}

function stripQuotes(value) {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

export function slugify(value) {
  const raw = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return raw || "presentation";
}

export function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}

export function parseSlidesHeadmatter(filePath = SLIDES_PATH) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const fields = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.includes(":") === false) {
      continue;
    }
    const fieldMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/);
    if (!fieldMatch) {
      continue;
    }
    fields[fieldMatch[1]] = stripQuotes(fieldMatch[2]);
  }

  return fields;
}

export function findLatestDeckSpecPath(outputDir = OUTPUT_DIR) {
  if (!fs.existsSync(outputDir)) {
    return null;
  }

  const specs = fs.readdirSync(outputDir).filter((name) => name.endsWith(".deck-spec.json"));
  const latest = newestEntry(outputDir, specs);
  return latest ? path.join(outputDir, latest) : null;
}

export function loadDeckSpec(specPath) {
  const resolvedPath = specPath ? path.resolve(ROOT_DIR, specPath) : findLatestDeckSpecPath();
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error(
      "No deck spec found in ./output/. Re-run the updated assembly pipeline or create output/<slug>.deck-spec.json first.",
    );
  }

  const spec = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return { spec, path: resolvedPath };
}

export function resolveDeckIdentity(options = {}) {
  const { preferDeckSpec = true } = options;
  if (preferDeckSpec) {
    try {
      const { spec, path: specPath } = loadDeckSpec();
      return {
        title: spec.metadata.title,
        slug: spec.metadata.slug,
        specPath,
      };
    } catch {
      // Fall back to slides.md.
    }
  }

  const headmatter = parseSlidesHeadmatter();
  const title = headmatter.title || "Presentation";
  const slug = slugify(headmatter.exportFilename || headmatter.title || "presentation");
  return { title, slug, specPath: null };
}

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

let compiledValidator = null;

function getValidator() {
  if (!compiledValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    compiledValidator = ajv.compile(loadSchema());
  }
  return compiledValidator;
}

export function formatValidationErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("\n");
}

export function validateDeckSpec(spec) {
  const validate = getValidator();
  const valid = validate(spec);
  return {
    valid,
    errors: validate.errors ?? [],
  };
}

export function resolveAssetPath(assetPath) {
  if (!assetPath) {
    return null;
  }

  if (path.isAbsolute(assetPath)) {
    return assetPath;
  }

  if (assetPath.startsWith("/")) {
    return path.join(ROOT_DIR, "public", assetPath.replace(/^\/+/, ""));
  }

  const relativeToRoot = path.resolve(ROOT_DIR, assetPath);
  if (fs.existsSync(relativeToRoot)) {
    return relativeToRoot;
  }

  return path.join(ROOT_DIR, "public", assetPath);
}

export function collectDeckAssetErrors(spec) {
  const errors = [];
  for (const slide of spec.slides ?? []) {
    const candidates = [
      ["background.path", slide.background?.path],
      ["visual.path", slide.visual?.path],
      ["diagram.imagePath", slide.diagram?.imagePath],
    ];

    for (const [field, candidate] of candidates) {
      if (!candidate) {
        continue;
      }
      const resolved = resolveAssetPath(candidate);
      if (!resolved || !fs.existsSync(resolved)) {
        errors.push(`slide ${slide.number}: ${field} references missing asset ${candidate}`);
      }
    }
  }
  return errors;
}

export function assertDeckSpecOrThrow(spec) {
  const { valid, errors } = validateDeckSpec(spec);
  const assetErrors = collectDeckAssetErrors(spec);
  if (!valid || assetErrors.length > 0) {
    const schemaErrors = errors.length > 0 ? formatValidationErrors(errors) : "";
    const details = [schemaErrors, ...assetErrors].filter(Boolean).join("\n");
    throw new Error(`Deck spec validation failed:\n${details}`);
  }
}

export function relativeOutputPath(filename) {
  return path.join(OUTPUT_DIR, filename);
}
