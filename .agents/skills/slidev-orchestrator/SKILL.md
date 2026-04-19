---
name: slidev-orchestrator
description: Shared orchestration workflow for generating Slidev presentations through the native root agent and the project's 8 specialized worker subagents
---

# Slidev Orchestrator

Use this skill when the user wants the full presentation-generation pipeline, not just a partial edit.

This skill is for the native/root agent. Do not use it from inside a subagent context. If the current runtime cannot launch subagents from the current context, stop and report that the orchestration phase is blocked instead of doing the work manually.

## Workflow Contract

The pipeline below is mandatory whenever this skill is invoked.

- Load the skill `slidev-presentation` before planning or delegating.
- Delegate work to the project's existing `slidev-*` worker agents using the host runtime's native subagent/task mechanism.
- Do not replace required worker phases with manual work by the root agent.
- Do not write `slides.md` yourself. Only `slidev-assembler` may create the deck file.
- Do not write `output/<slug>.deck-spec.json` yourself. Only `slidev-assembler` may create the deck spec.
- Do not mark the task complete after planning, research, or assembly alone. Completion requires review plus export.
- Do not treat `slides.md` as the final deliverable. Final deliverables are the exported artifacts in `output/`.
- Use only `bun run export:*` scripts for export. Do not call raw `slidev export` or `npx slidev export`.

## Before Starting

1. Load `slidev-presentation`.
2. Clean stale assets so old images and exports do not leak into the new deck:
   - Empty `public/` except `.gitkeep`:
     ```bash
     find public -mindepth 1 ! -name '.gitkeep' -delete
     ```
   - Empty `output/` except `.gitkeep`:
     ```bash
     find output -mindepth 1 ! -name '.gitkeep' -delete
     ```
   - Verify cleanup before continuing:
     ```bash
     ls -la public/
     ls -la output/
     ```
3. Analyze the user prompt and extract:
   - Topic or subject
   - Number of slides, defaulting to 10
   - Visual style preferences
   - Required elements such as diagrams, SVGs, stats, or code

## Phase 1: Planning

Create a structured plan yourself before delegating:

```text
Plan:
- theme: [selected theme]
- totalSlides: [number]
- slides:
  - slide 1: { title, layoutHint, contentType, needsDiagram, needsSVG, needsCode, needsStats }
  - slide 2: ...
```

Planning rules:

- First slide is a cover or hero slide.
- Use section dividers between major topics when helpful.
- Second-to-last slide summarizes key takeaways.
- Last slide is a strong closing, not a generic "Questions?" slide.
- Distribute content evenly across slides.

## Phase 2: Parallel Generation

Launch these 4 worker agents in parallel and wait for all of them:

1. `slidev-content-researcher` with the topic, slide plan, and slide count
2. `slidev-layout-designer` with the slide plan and style preferences
3. `slidev-illustrator` with the list of slides needing SVG illustrations
4. `slidev-diagrammer` with the list of slides needing Mermaid diagrams

This phase is mandatory. If any required worker cannot be launched, stop and report the blocked phase.

## Phase 3: Assembly

Launch these workers sequentially:

1. `slidev-assembler` with all Phase 2 outputs plus the slide plan
2. `slidev-stylist` with the assembled `slides.md` and design recommendations

Do not assemble or restyle the deck yourself.

## Phase 4: Review

Launch `slidev-reviewer` with the final `slides.md` and `output/<slug>.deck-spec.json`.

- If review passes, continue to export.
- If review fails, send the issues to `slidev-stylist` for fixes.
- Limit review-rework loops to 2 iterations.
- After 2 failed iterations, continue to export but clearly report unresolved issues.

Do not skip review.

## Phase 5: Export

Launch `slidev-exporter` to produce PDF, editable PPTX, and PNG artifacts. Legacy raster PPTX is optional fallback only.

Do not skip export. The job is complete only when export finishes successfully or you explicitly report which phase failed.

## Final Response

Report:

- Theme used
- Number of slides generated
- Paths to exported files
- Any unresolved issues or blocked phases

Do not report success without exported file paths unless you are explicitly reporting a failure.
