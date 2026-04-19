import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

function isXmlTarget(filePath) {
  return (
    filePath.endsWith(".xml") &&
    (filePath.includes(`${path.sep}ppt${path.sep}slides${path.sep}`) ||
      filePath.includes(`${path.sep}ppt${path.sep}slideLayouts${path.sep}`) ||
      filePath.includes(`${path.sep}ppt${path.sep}slideMasters${path.sep}`))
  );
}

async function listFiles(rootDir) {
  const queue = [rootDir];
  const files = [];
  while (queue.length) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function stripPlaceholderShapes(xml) {
  let next = xml;

  next = next.replace(/<p:sp>[\s\S]*?<p:ph\b[\s\S]*?<\/p:sp>/g, "");
  next = next.replace(/<p:ph\b[^/>]*\/>/g, "");
  next = next.replace(/<p:ph\b[^>]*>[\s\S]*?<\/p:ph>/g, "");
  next = next.replace(/<p:sldLayout\b([^>]*)type="[^"]*"/, '<p:sldLayout$1type="blank"');
  next = next.replace(/<p:cSld name="[^"]*">/, '<p:cSld name="Blank Slide">');

  return next;
}

async function rewriteXmlTargets(unpackedDir) {
  const files = await listFiles(unpackedDir);
  let touched = 0;

  for (const filePath of files) {
    if (!isXmlTarget(filePath)) continue;
    const before = await fs.readFile(filePath, "utf8");
    const after = stripPlaceholderShapes(before);
    if (after !== before) {
      await fs.writeFile(filePath, after, "utf8");
      touched += 1;
    }
  }

  return touched;
}

async function rezipPackage(sourceDir, outputPptxPath) {
  const repackedPath = path.join(path.dirname(outputPptxPath), `${path.basename(outputPptxPath, ".pptx")}.cleaned.pptx`);
  await fs.rm(repackedPath, { force: true });
  await execFileAsync("zip", ["-Xqr", repackedPath, "."], { cwd: sourceDir });
  await fs.rename(repackedPath, outputPptxPath);
}

export async function cleanupGeneratedPptx(pptxPath) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "slidev-native-pptx-"));
  const unpackedDir = path.join(tempRoot, "package");

  try {
    await fs.mkdir(unpackedDir, { recursive: true });
    await execFileAsync("unzip", ["-qq", pptxPath, "-d", unpackedDir]);
    const touchedFiles = await rewriteXmlTargets(unpackedDir);
    await rezipPackage(unpackedDir, pptxPath);
    return { pptxPath, touchedFiles };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function countPackagePlaceholders(pptxPath) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "slidev-native-pptx-check-"));
  const unpackedDir = path.join(tempRoot, "package");

  try {
    await fs.mkdir(unpackedDir, { recursive: true });
    await execFileAsync("unzip", ["-qq", pptxPath, "-d", unpackedDir]);
    const files = await listFiles(unpackedDir);
    let count = 0;

    for (const filePath of files) {
      if (!isXmlTarget(filePath)) continue;
      const xml = await fs.readFile(filePath, "utf8");
      count += (xml.match(/<p:ph\b/g) || []).length;
    }

    return count;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export { PRESENTATION_NS };
