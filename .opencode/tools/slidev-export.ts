import fs from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"

function newestEntry(outputDir: string, names: string[]) {
  return names
    .map((name) => ({
      name,
      mtimeMs: fs.statSync(path.join(outputDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name ?? null
}

function latestFile(outputDir: string, extension: string) {
  const matches = fs.readdirSync(outputDir).filter((name) => name.endsWith(extension))
  return newestEntry(outputDir, matches)
}

function latestPngDir(outputDir: string) {
  const matches = fs.readdirSync(outputDir).filter((name) => {
    const fullPath = path.join(outputDir, name)
    if (!fs.statSync(fullPath).isDirectory()) {
      return false
    }
    return fs.readdirSync(fullPath).some((file) => /^\d+\.png$/.test(file))
  })
  return newestEntry(outputDir, matches)
}

async function runExportScript(worktree: string, script: string) {
  const proc = Bun.spawn(["bun", "run", script], {
    cwd: worktree,
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
    throw new Error(`bun run ${script} failed (exit ${proc.exitCode})${details ? `:\n${details}` : ""}`)
  }
}

function ensureOutputDir(worktree: string) {
  const outputDir = path.join(worktree, "output")
  fs.mkdirSync(outputDir, { recursive: true })
  return outputDir
}

export const pdf = tool({
  description: "Export Slidev presentation to PDF using the project's bun run export:pdf script",
  args: {},
  async execute(_args, context) {
    const outputDir = ensureOutputDir(context.worktree)
    try {
      await runExportScript(context.worktree, "export:pdf")
    } catch (error) {
      return String(error)
    }

    const filename = latestFile(outputDir, ".pdf")
    if (!filename) {
      return "Export PDF completed, but no PDF file was found in ./output/"
    }

    return `PDF exported to ./output/${filename}`
  },
})

export const pptx = tool({
  description: "Export Slidev presentation to editable PPTX using the project's bun run export:pptx script",
  args: {},
  async execute(_args, context) {
    const outputDir = ensureOutputDir(context.worktree)
    try {
      await runExportScript(context.worktree, "export:pptx")
    } catch (error) {
      return String(error)
    }

    const filename = newestEntry(
      outputDir,
      fs.readdirSync(outputDir).filter((name) => name.endsWith(".pptx") && !name.endsWith("-legacy.pptx")),
    )
    if (!filename) {
      return "Export PPTX completed, but no PPTX file was found in ./output/"
    }

    return `Editable PPTX exported to ./output/${filename}`
  },
})

export const png = tool({
  description: "Export Slidev presentation to numbered PNG slides using the project's bun run export:png script",
  args: {},
  async execute(_args, context) {
    const outputDir = ensureOutputDir(context.worktree)
    try {
      await runExportScript(context.worktree, "export:png")
    } catch (error) {
      return String(error)
    }

    const dirName = latestPngDir(outputDir)
    if (!dirName) {
      return "Export PNG completed, but no non-empty PNG directory was found in ./output/"
    }

    const fullDir = path.join(outputDir, dirName)
    const files = fs.readdirSync(fullDir).filter((file) => /^\d+\.png$/.test(file))
    return `PNG exported to ./output/${dirName}/ (${files.length} slides)`
  },
})
