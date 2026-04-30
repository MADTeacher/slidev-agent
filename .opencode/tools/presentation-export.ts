import fs from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"

type ExportArgs = {
  deckDir?: string
  mode?: "multi" | "stage"
  slides?: string
  html?: string
  out?: string
  slideCount?: number
}

function resolveDeckDir(worktree: string, deckDir?: string) {
  if (!deckDir) {
    throw new Error("deckDir is required, for example: presentations/my-deck")
  }

  const resolved = path.resolve(worktree, deckDir)
  const root = path.resolve(worktree)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`deckDir must stay inside the worktree: ${deckDir}`)
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`deckDir does not exist: ${deckDir}`)
  }
  return resolved
}

function ensureExportsDir(deckDir: string) {
  const exportsDir = path.join(deckDir, "exports")
  fs.mkdirSync(exportsDir, { recursive: true })
  return exportsDir
}

async function runNode(deckDir: string, args: string[]) {
  const proc = Bun.spawn(["node", ...args], {
    cwd: deckDir,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (proc.exitCode !== 0) {
    const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
    throw new Error(`node ${args.join(" ")} failed (exit ${proc.exitCode})${details ? `:\n${details}` : ""}`)
  }

  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
}

function newestFile(dir: string, extension: string) {
  if (!fs.existsSync(dir)) return null
  const matches = fs.readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => ({
      name,
      mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return matches[0]?.name ?? null
}

function pngCount(dir: string) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 0
  return fs.readdirSync(dir).filter((name) => /\.png$/i.test(name)).length
}

export const png = tool({
  description: "Export an HTML-first presentation to numbered PNG files. Requires deckDir.",
  args: {},
  async execute(rawArgs, context) {
    const args = rawArgs as ExportArgs
    try {
      const deckDir = resolveDeckDir(context.worktree, args.deckDir)
      const exportsDir = ensureExportsDir(deckDir)
      const out = args.out ?? "exports/png"
      const mode = args.mode ?? (args.html ? "stage" : "multi")

      if (mode === "stage") {
        const html = args.html ?? "deck.html"
        const slideCount = args.slideCount
        if (!slideCount) throw new Error("slideCount is required for stage PNG export")
        await runNode(deckDir, ["scripts/export_deck_stage_png.mjs", "--html", html, "--out", out, "--slides", String(slideCount)])
      } else {
        await runNode(deckDir, ["scripts/export_deck_png.mjs", "--slides", args.slides ?? "slides", "--out", out])
      }

      const fullOut = path.resolve(deckDir, out)
      return `PNG exported to ${path.relative(context.worktree, fullOut)} (${pngCount(fullOut)} files, exports dir ${path.relative(context.worktree, exportsDir)})`
    } catch (error) {
      return String(error)
    }
  },
})

export const pdf = tool({
  description: "Export an HTML-first presentation to PDF. Requires deckDir.",
  args: {},
  async execute(rawArgs, context) {
    const args = rawArgs as ExportArgs
    try {
      const deckDir = resolveDeckDir(context.worktree, args.deckDir)
      const exportsDir = ensureExportsDir(deckDir)
      const out = args.out ?? "exports/deck.pdf"
      const mode = args.mode ?? (args.html ? "stage" : "multi")

      if (mode === "stage") {
        await runNode(deckDir, ["scripts/export_deck_stage_pdf.mjs", "--html", args.html ?? "deck.html", "--out", out])
      } else {
        await runNode(deckDir, ["scripts/export_deck_pdf.mjs", "--slides", args.slides ?? "slides", "--out", out])
      }

      const latest = newestFile(exportsDir, ".pdf")
      return latest ? `PDF exported to ${path.relative(context.worktree, path.join(exportsDir, latest))}` : `PDF export finished; check ${path.relative(context.worktree, path.resolve(deckDir, out))}`
    } catch (error) {
      return String(error)
    }
  },
})

export const pptx = tool({
  description: "Export constrained HTML slides to editable PPTX. Requires deckDir.",
  args: {},
  async execute(rawArgs, context) {
    const args = rawArgs as ExportArgs
    try {
      const deckDir = resolveDeckDir(context.worktree, args.deckDir)
      const exportsDir = ensureExportsDir(deckDir)
      const out = args.out ?? "exports/deck.pptx"
      await runNode(deckDir, ["scripts/export_deck_pptx.mjs", "--slides", args.slides ?? "slides", "--out", out])

      const latest = newestFile(exportsDir, ".pptx")
      return latest ? `Editable PPTX exported to ${path.relative(context.worktree, path.join(exportsDir, latest))}` : `PPTX export finished; check ${path.relative(context.worktree, path.resolve(deckDir, out))}`
    } catch (error) {
      return String(error)
    }
  },
})
