import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureOutputDir, resolveDeckIdentity } from "./deck-spec.mjs";

function parseArgs(argv) {
  const args = {};
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === "--format") {
      args.format = argv[idx + 1];
      idx += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.format) {
    throw new Error("Usage: node scripts/export-slidev.mjs --format <pdf|png>");
  }

  return args;
}

function slidevBinaryPath() {
  const filename = process.platform === "win32" ? "slidev.cmd" : "slidev";
  return path.join(process.cwd(), "node_modules", ".bin", filename);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = ensureOutputDir();
  const slidevBin = slidevBinaryPath();

  if (!fs.existsSync(slidevBin)) {
    throw new Error("Slidev CLI was not found in ./node_modules/.bin/. Run `bun install` first.");
  }

  const { slug } = resolveDeckIdentity({ preferDeckSpec: false });
  let outputPath = null;
  const slidevArgs = ["export", "slides.md"];

  if (args.format === "pdf") {
    outputPath = path.join(outputDir, `${slug}.pdf`);
    fs.rmSync(outputPath, { recursive: true, force: true });
    slidevArgs.push("--output", outputPath, "--timeout", "60000", "--wait", "1500");
  } else if (args.format === "png") {
    outputPath = path.join(outputDir, slug);
    fs.rmSync(outputPath, { recursive: true, force: true });
    fs.mkdirSync(outputPath, { recursive: true });
    slidevArgs.push(
      "--format",
      "png",
      "--output",
      outputPath,
      "--timeout",
      "120000",
      "--wait",
      "1500",
      "--wait-until",
      "networkidle",
    );
  } else {
    throw new Error(`Unsupported export format: ${args.format}`);
  }

  await run(slidevBin, slidevArgs);

  if (args.format === "pdf") {
    await run(process.execPath, ["scripts/fix-export.mjs", "--pdf"]);
  } else if (args.format === "png") {
    await run(process.execPath, ["scripts/fix-export.mjs", "--png"]);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
