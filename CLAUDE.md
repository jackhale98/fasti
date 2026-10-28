# Fasti

A web front end for the Remind reminder language. Plan: docs/PLAN.md (read it
first; keep its Progress section current).

## Rules
- Dates come only from Remind compiled to WebAssembly. The TS lens never
  computes dates.
- Every Remind run passes -r. Never execute anything from a script.
- Edits are byte-exact patches; never regenerate a file.
- Never contact Remind's author or project sites, and never send anything
  upstream. Remind docs: engine/vendor/ man pages or the remind-docs agent.
- Mobile first (360 px), light and dark, accessible (axe clean).
- GPL-2.0-or-later; SPDX header on every source file.

## Commands
- npm run dev | build | check | lint | test | test:e2e
- npm run licenses (fails on a dependency licence that isn't GPLv2-compatible)
- engine/build.sh (needs Docker with emscripten/emsdk)

## Delegation
See docs/PLAN.md section 9. Parallel writers use worktrees and disjoint
directories. Subagents return summaries of at most 200 words. Reviewer signs
off on high-risk changes before merge.
