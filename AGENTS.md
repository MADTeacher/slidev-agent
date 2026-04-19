# Slidev Presentation Generator

This project generates designer-quality presentations using Slidev.

## Architecture

Skill-first orchestration with worker subagents:
- `slidev-orchestrator` (shared skill) — loaded by the native/root agent to plan, delegate, review, and export
- `slidev-editable-pptx` (shared skill) — project-local editable PowerPoint export for approved decks
- 8 specialized worker subagents handle content, design, SVG, diagrams, assembly, styling, review, and export

## Mandatory Execution Rules

When the user explicitly invokes the `slidev-orchestrator` skill, or asks for the full presentation pipeline, the orchestration workflow is **mandatory**. It is not optional guidance.

- The native/root agent MUST load and execute the `slidev-orchestrator` skill, not replace it with manual single-agent execution.
- The orchestration skill MUST delegate work to the specialized subagents defined by the project. It MUST NOT skip delegation just because the root agent can do the work itself.
- The orchestration skill MUST NOT write `slides.md` itself. `slides.md` must be produced by `slidev-assembler`.
- The orchestration skill MUST NOT write `output/<slug>.deck-spec.json` itself. `deck-spec.json` must be produced by `slidev-assembler`.
- The orchestration skill MUST run the review phase through `slidev-reviewer` before presenting the job as complete.
- The orchestration skill MUST run the export phase through `slidev-exporter` and must not claim completion based on `slides.md` alone.
- A job is considered complete only when exported artifacts exist in `output/`, or when the response explicitly says which required phase failed and why.
- Manual “shortcut” execution by the root agent is a workflow violation, not an acceptable fallback.
- If any required subagent cannot run, the agent must stop and report the blocked phase instead of silently doing that phase itself.
- If the user request explicitly names an orchestrator or subagent, treat that as a binding routing instruction, not as a preference.

## Usage

Invoke the orchestration skill explicitly from the native/root agent:
```
Use $slidev-orchestrator to create a 10-slide presentation about microservices architecture in a dark minimal style
```

## File Structure

- `slides.md` — generated presentation entry point
- `schemas/deck-spec.schema.json` — machine-readable schema for editable PPTX export
- `components/` — custom Vue components (StatCard, Timeline, ComparisonTable, ImageGrid, SectionNumber)
- `layouts/` — custom layouts (hero-center, stat-grid, side-by-side, full-image)
- `styles/` — global styles
- `public/` — static assets and generated SVG files
- `output/` — exported PDF, editable PPTX, PNG files, and deck specs
- `scripts/` — all repo-local executable scripts, including the native PPTX pipeline under `scripts/native-pptx/`

## Available Themes

- `seriph` — clean minimal (default)
- `apple-basic` — Apple-style simplicity
- `default` — standard Slidev theme
- `bricks` — structured brick layout
- `dracula` — dark purple theme

## Export Commands

- `bun run export:pdf` — export to PDF
- `bun run export:pptx` — export to editable PPTX
- `bun run export:png` — export individual slides as PNG to `./output/<presentation-name>/`
- `bun run export:all` — export all formats

**CRITICAL:** Slidev v52.x has a confirmed bug where exports always generate a blank first page/frame. The project includes `scripts/fix-export.mjs` which is automatically invoked after `export:pdf` and `export:png` to remove the blank page and shift PNG numbering. Do NOT run raw `slidev export` directly — always use the `bun run export:*` scripts.

## Dual-Agent Configuration Sync

This project uses TWO agent systems in parallel:

- `.opencode/` — configuration for opencode CLI (agents as `.md`, tools as `.ts`)
- `.codex/` — configuration for OpenAI Codex (agents as `.toml`, config as `config.toml`)
- `.agents/skills/` — shared skills directory, discovered by both opencode and Codex

**CRITICAL RULE: Any change to shared worker agents, shared skills, or tooling references MUST stay synchronized across both runtimes.** This includes:

- **Worker agent definitions**: `.opencode/agents/*.md` ↔ `.codex/agents/*.toml` — keep instructions, descriptions, and permissions in sync for the 8 shared worker agents
- **Skills**: `.agents/skills/*/SKILL.md` — shared between both systems (do NOT duplicate)
- **Tools**: `.opencode/tools/*.ts` — opencode-specific
- **Export scripts and tooling**: ensure both systems reference the same `bun run export:*` commands and the same orchestration skill contract

When modifying any agent, skill, or configuration, always update the counterpart to keep configurations identical.
