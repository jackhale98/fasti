# Fasti: build plan

Fasti is a web front end for [Remind](https://dianne.skoll.ca/projects/remind/), Dianne Skoll's plain-text reminder language. It runs as a static site on GitHub Pages, works offline on phones and desktops, and reads and writes the user's own `.rem` files in GitHub, any git host, Dropbox, OneDrive or WebDAV.

This document is the brief for a Claude Code session that builds the app. The session acts as the **lead**: it owns this plan, integrates all work and delegates scoped tasks to subagents (section 9). Copy this file to `docs/PLAN.md` in the new repo and keep its **Progress** section current as phases complete.

Reference material that comes with this plan:

| File | What it is |
| --- | --- |
| `reference/prototype.html` | A working single-file prototype of Fasti. Shows the intended views, quick add, inspector, editor and design tokens. Its JS date engine is **not** to be ported (see 3.2). Its tokenizer, explainer, quick-add parser and patcher **are** the starting point for the TypeScript lens. |
| `reference/manpage-vectors.test.js` | 57 expected results taken from worked examples in the Remind 06.03.06 man page, written against the prototype engine's API. Port them as golden tests for the WebAssembly engine. |

Sibling projects by the same author, used as the source for the stack, sync code and conventions:

- **Mycelium** (`github.com/jackhale98/mycelium-web`, GPL-3.0-or-later): git, cloud and WebDAV sync, IndexedDB storage, three-way merge, Cloudflare Worker with git proxy, OAuth exchange, WebDAV relay and encrypted Web Push reminders.
- **Tessera** (`github.com/jackhale98/sysml-web`, Apache-2.0 OR MIT): SvelteKit static app, service worker, CI-gated GitHub Pages deploy, Lighthouse and axe checks.

---

## 1. Decisions (locked)

| Area | Decision |
| --- | --- |
| Name | **Fasti**. Roman calendars that marked which days were open for business (*dies fasti*) and which were not (*nefasti*), which mirrors Remind's `OMIT` / `SKIP` / `BEFORE` / `AFTER`. |
| Date engine | Unmodified upstream **Remind compiled to WebAssembly** is the only source of dates. No JavaScript reimplementation of trigger logic. |
| TypeScript "lens" | Tokenizing, highlighting, plain-language explanation, quick-add parsing and text patching only. It never computes dates. |
| Licence | **GPL-2.0-or-later** for all Fasti code. The distributed app (which includes Remind, GPL-2.0-only) is conveyed under GPLv2. |
| Framework | **SvelteKit + adapter-static** (as in Tessera), Svelte 5 runes, TypeScript strict, Vite. |
| Sync | **Copy** Mycelium's app-side git, sync and store modules into Fasti, relicensed GPL-2.0-or-later by their owner (see 11). |
| Worker | Fasti deploys **its own** copy of Mycelium's Cloudflare Worker (git proxy, OAuth exchange, WebDAV relay, push). |
| Notifications | **In v1**, via the worker's encrypted Web Push, for `AT` reminders. |
| Hosting | GitHub Pages, deployed only from commits that passed CI (Tessera's `deploy.yml` pattern). |

---

## 2. Ground rules

These apply to the lead and to every subagent. Put them in `CLAUDE.md` (Appendix A).

1. **Respect Remind's author.** Remind's README says no part of it was written with AI and that AI-generated contributions will not be accepted.
   - Never open issues, patches, pull requests or emails to the Remind project.
   - Any build patches Fasti needs live in this repo only (`engine/patches/`), each with a comment explaining why.
   - Never fetch from `dianne.skoll.ca` or `git.skoll.ca` with tools or scripts. The author locked her git server because of AI scrapers. The human downloads the release tarball once and commits it (section 12, step 1). Documentation comes from the man pages inside that tarball.
   - Product copy says "a web front end for Remind" and "not affiliated with or endorsed by Remind or its author". "Remind" never appears in the product name, icon or domain.
   - The README discloses that Fasti was built with AI assistance.
2. **Byte-exact files.** Fasti never regenerates a file. Every change is a minimal text patch to the lines it touches. Comments, spacing, line endings, continuations (`\`), unknown syntax and the final newline survive unchanged. This is the most important invariant, as in Mycelium (see its `docs/PLAN.md`, "File-accuracy model").
3. **Never execute anything from a script.** Always pass `-r` to Remind. `RUN` reminders are listed, never run. `shell()` and `INCLUDECMD` are disabled.
4. **Dates come from Remind.** If a view needs a date, it gets it from the engine worker. The lens may show "computing…" for one frame, never a guess.
5. **Mobile first, both themes, accessible.** Every view works at 360 px wide, in light and dark, by keyboard and screen reader. axe must report no serious or critical issues.
6. **Small, verified steps.** Each task ends with `npm run check`, `npm test` and, for UI tasks, the relevant Playwright spec passing.

---

## 3. Architecture

### 3.1 Overview

```
┌──────────────────────────── browser ────────────────────────────┐
│  Svelte UI  ──►  stores (runes)  ──►  vault (IndexedDB via idb) │
│     │                │                     ▲                    │
│     │                ▼                     │ byte-exact patches │
│     │        engine client ──postMessage──►│                    │
│     │                │                     │                    │
│     │      ┌─────────▼──────────┐   ┌──────┴───────┐            │
│     │      │ engine worker      │   │ sync engine  │──► worker ─┼─► git hosts / WebDAV
│     │      │ remind.wasm (MEMFS)│   │ (from        │            │
│     │      └────────────────────┘   │  Mycelium)   │──► Dropbox / OneDrive (direct, PKCE)
│     ▼                               └──────────────┘            │
│  lens (TS): tokenize · highlight · explain · quick add · patch  │
│  service worker: offline shell, precache wasm                   │
└─────────────────────────────────────────────────────────────────┘
Cloudflare Worker (Fasti's own): git smart-HTTP proxy · OAuth token exchange ·
WebDAV relay · encrypted push store (Durable Object alarms)
```

### 3.2 Engine: Remind as WebAssembly

**Source.** `engine/vendor/remind-<version>.tar.gz` (the official release tarball, committed by the human together with its `.asc` signature and the SHA-256 of the file in `engine/vendor/SOURCE.md`). Pin the latest release at kickoff (06.03.06 when this plan was written). Committing the tarball also satisfies GPLv2's source requirement for the shipped binary.

**Build** (`engine/build.sh`, run in CI inside the pinned `emscripten/emsdk` Docker image):

- `emconfigure ./configure` then `emmake make` for the `remind` binary only.
- Link flags to start from: `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH -sFORCE_FILESYSTEM -sEXPORTED_RUNTIME_METHODS=callMain,FS`.
- **No pthreads.** GitHub Pages can't send the COOP/COEP headers that shared memory needs.
- Output `static/engine/remind.mjs` and `remind.wasm`, plus `engine/BUILD-INFO.json` (Remind version, emsdk version, tarball SHA-256, patch list).
- If upstream C needs changes to compile (for example around `fork`, `popen` or signals), keep them as minimal patches in `engine/patches/`, applied by the build script. Prefer configure flags and Emscripten stubs over patches.

**Runtime** (`src/lib/engine/worker.ts`):

- Compile the module once (`WebAssembly.compileStreaming`) and create a **fresh instance for every run**. Remind keeps global state, so instances are never reused.
- Write the vault into MEMFS at `/vault/` with mode `0600`. Remind refuses to read group- or world-writable files, and MEMFS defaults may be too permissive; the spike confirms this.
- Capture stdout and stderr through `print` and `printErr`.
- Kill the worker and respawn it if a run exceeds 3 s (a script with a runaway `SATISFY`). Report a clear error naming the file.
- Debounce runs at 120 ms while the user types.

**Invocations.** Confirm exact flags and JSON shapes against `remind.1` and `rem2ps.1` from the tarball during the spike, then record them in `docs/engine.md`.

| Purpose | Command (inside the worker) |
| --- | --- |
| Agenda for a day | `remind --json -r -q -h /vault/<main> YYYY-MM-DD@HH:MM` |
| Calendar for a range | `remind -ppp<months> -r -b1 [-m] [--hide-completed-todos] /vault/<main> YYYY-MM-01` (`-ppp` is pure JSON and implies `-l`, which adds file and line to each entry) |
| Weekly calendar | `remind -ppp+<weeks> …` |
| Next date of every reminder | `remind -n -r /vault/<main>` |
| Live preview of an edited line | Run the calendar for 12 months with the edited text substituted into its file in MEMFS, then filter entries by file and line. The line keeps its real OMIT context. |
| Diagnostics | Parse `file(line): message` lines from stderr into editor diagnostics. |

The main entry is configurable: a file (default `reminders.rem` or `.reminders`) or a directory (Remind reads every `*.rem` in it, sorted).

**Spike first (Phase 0).** The engine is the riskiest part, so it gets a go/no-go before anything else is built:

Progress on these is tracked in `docs/engine.md`.

- [ ] Builds reproducibly in CI from the vendored tarball.
- [ ] All 57 vectors in `reference/manpage-vectors.test.js` pass when run through WASM (adapt the harness to call the engine).
- [ ] `DO`, `INCLUDE` and directory includes resolve inside MEMFS.
- [ ] File permission and uid checks don't block reading.
- [ ] `TZ` keyword: find out whether Emscripten's time functions plus a bundled zoneinfo subset make it work. If not, show a diagnostic on lines that use `TZ` and record it as a known limitation.
- [ ] A 2,000-line vault produces a 3-month calendar in under 150 ms on a mid-range phone (Playwright with CPU throttling ×4 as a proxy).
- [ ] Gzipped `remind.wasm` plus glue under 400 KB.

If the spike fails, stop and report to the human before continuing. The fallback would be porting the prototype's JS engine, which changes the licence decision.

### 3.3 Lens (TypeScript)

Port from `reference/prototype.html` (the `K` and `Q` modules) into `src/lib/lens/`, typed, with **all date arithmetic removed**:

- `tokenize.ts`: logical lines (backslash continuations with an offset map back to the raw text), tokens with roles (`cmd`, `kw`, `date`, `wday`, `num`, `time`, `str`, `expr`, `name`, `body`, `err`), `%` substitution spans in bodies.
- `codemirror.ts`: a CodeMirror 6 language (StreamLanguage or a small Lezer grammar) driven by the tokenizer, plus completions for keywords, weekday and month names, `%` sequences and `INFO` headers.
- `explain.ts`: plain-language sentences for REM, OMIT, DO and context commands (the prototype's `explain`, `explainOmit` and `lineInspector` text). Wording follows the man page; where the lens can't explain a construct (expressions, SATISFY, functions), say "evaluated by Remind" and show the engine's dates.
- `quickadd.ts`: the prototype's `Q.parse` / `Q.toRem`. Keep its two safety rules:
  - A new recurring TODO gets `COMPLETE-THROUGH <yesterday>`, so it doesn't count as overdue since 1990.
  - "Last working day" adds `OMIT Sat Sun` to its own line.
- `patch.ts`: line-range replace, insert, delete, mark-done (`COMPLETE-THROUGH` inserted just before the body keyword, or its date updated in place, including multi-token dates), all returning new text and a minimal diff. Property test: patch then inverse patch returns identical bytes.

### 3.4 Storage and vault model

- IndexedDB via `idb` (`src/lib/store/db.ts`, adapted from Mycelium's Dexie schema; see 11 for why not Dexie): one row per file with path, text, base text (last synced), remote revision and dirty flag; settings; push subscription state.
- `vault.ts`: discover files by following `DO`, `INCLUDE` and directory includes from the main entry. `INCLUDE` is relative to the vault root (Remind's working directory); `DO` is relative to the including file. Files outside the vault, `SYSINCLUDE` and `INCLUDECMD` show a diagnostic.
- Line endings and encoding are recorded per file and preserved.

### 3.5 Sync

Copy from Mycelium `src/lib/git/*`, `src/lib/sync/*` and their tests, then adapt to vault files instead of org files.

| Provider | Mechanism |
| --- | --- |
| GitHub | GitHub App sign-in with PKCE; code exchange through the worker; isomorphic-git over the worker's proxy. Branch, commit, pull, push. |
| Any git host | HTTPS URL plus access token; GitLab and Bitbucket sign-in come free from Mycelium. |
| Dropbox | OAuth PKCE directly from the browser (no secret); autosync a few seconds after each edit. |
| OneDrive / SharePoint | Microsoft identity platform PKCE directly; autosync. |
| WebDAV (Nextcloud and others) | Through the worker's WebDAV relay, which handles CORS; autosync. |

- Git flow: edits change the working copy. The Sync view lists changed files with diffs and has a commit message, Commit, Pull and Push. Never auto-commit.
- Conflicts: three-way merge with `node-diff3` (as in Mycelium). Unresolvable hunks are shown side by side for the user to pick; never silently overwritten.

### 3.6 Notifications

- While Fasti is open: local timers for today's queued `AT` reminders, honouring `+tdelta`, `*trepeat` and `NOQUEUE`. The times come from the engine.
- While closed: reuse Mycelium's push design. Settings → Notifications subscribes the device. On each sync or app open, Fasti sends the next 8 days of `AT` reminders (at most 64), each encrypted on the device (RFC 8291) for that device. The worker's Durable Object stores only times and sealed messages and fires them with VAPID.
- iOS only allows Web Push for installed home-screen apps. Explain this in Settings with install steps.

### 3.7 PWA and hosting

- Service worker (Tessera's approach): precache the app shell and `remind.wasm`; network-first for nothing else; works fully offline after the first visit.
- Web app manifest with icons, a maskable icon and `display: standalone`.
- SvelteKit static output with a `404.html` fallback for client routing. Base path from `actions/configure-pages` (project site `/fasti/` or a custom domain at `/`).
- Build-time variables (repo variables, as in Mycelium's `deploy.yml`): `PUBLIC_WORKER_URL`, `PUBLIC_GITHUB_CLIENT_ID`, `PUBLIC_GITHUB_APP_SLUG`, `PUBLIC_GITLAB_CLIENT_ID`, `PUBLIC_BITBUCKET_CLIENT_ID`, `PUBLIC_DROPBOX_APP_KEY`, `PUBLIC_ONEDRIVE_CLIENT_ID`. Sign-in buttons appear only for configured providers.

---

## 4. Product spec

Use the prototype as the visual and interaction reference, renamed to Fasti.

### Views

- **Today:** Remind's agenda. Sections for Overdue (TODOs), Today (timed items in order), Heads-up (`+N` warnings, with "in N days") and Next two weeks (calendar entries grouped by day, with holidays marked). A circle on each TODO marks it done. The eyebrow line reproduces Remind's default banner ("Reminders for Wednesday, 28th October, 2026 (today):").
- **Month:** 6-week grid with Sunday or Monday start (setting, maps to `-m`). Weekly days off are tinted; dated holidays are hatched. Selected-day list below the grid. Labels on wide screens, dots on phones. Completed TODO occurrences struck through. Optional Week view later.
- **Script:** CodeMirror editor per file with file tabs, syntax colours, diagnostics, a key strip for common tokens on phones and the line inspector (plain-language explanation plus the line's next dates from the engine).
- **Sync:** connected source, changed files with diffs, commit and push controls, other providers, how sync works, engine and licence information with a **Source** link (GPL requirement).
- **Settings:** main entry, week start, 12- or 24-hour times, hide completed TODOs, notifications, theme, reset local data.
- **Inspector** (right panel on desktop, bottom sheet on phones): title with substitutions applied, due or next date, chips (time, duration, `INFO` values, tags), Mark done, explanation, next 6 dates, the source line as an editable field with live preview and Save, Show in script, Delete with undo.
- **Quick add** (FAB on phones, button and `n` key on desktop): one plain-language field, the resulting REM line shown with syntax colours, explanation and next dates from the engine, an Adjust panel (message, repeat pattern, time, duration, heads-up days, count days off, behaviour on days off, end date, task, countdown `%b`) and a target-file picker. Typing a line that starts with `REM` or `OMIT` switches to raw mode.

### Design

- Keep the prototype's tokens: cool paper neutrals, ledger green accent, highlighter yellow for today, the syntax palette, Young Serif (display, sparingly), Hanken Grotesk (UI), IBM Plex Mono (code). Self-host fonts with `@fontsource` (as the sibling apps do) instead of Google Fonts.
- Optional brand detail from the Roman fasti, which lettered each day **F** (*fastus*) or **N** (*nefastus*): a small "N" marker on omitted days in the month grid. Use it only if it stays legible and accessible (it needs a text label for screen readers).
- Wordmark "Fasti" with a simple calendar glyph. No use of Remind's name or any logo in branding.

---

## 5. Repository layout

```
fasti/
├─ CLAUDE.md                 # Appendix A
├─ LICENSE                   # GPL-2.0 text
├─ THIRD_PARTY_NOTICES.md    # Remind (GPL-2.0-only), fonts, libraries
├─ README.md                 # what, demo link, AI-assistance note, not-affiliated note
├─ .claude/agents/*.md       # section 9
├─ docs/
│  ├─ PLAN.md                # this file, with Progress kept current
│  ├─ engine.md              # invocations, JSON shapes, limitations
│  ├─ setup-git-providers.md # adapted from Mycelium
│  ├─ setup-cloud-storage.md # adapted from Mycelium
│  └─ user-guide.md
├─ engine/
│  ├─ vendor/                # remind-<ver>.tar.gz, .asc, SOURCE.md (human-supplied)
│  ├─ patches/               # only if unavoidable
│  ├─ build.sh
│  └─ BUILD-INFO.json
├─ reference/                # prototype.html, manpage-vectors.test.js
├─ src/
│  ├─ lib/engine/            # worker.ts, client.ts, types.ts, parse-json.ts
│  ├─ lib/lens/              # tokenize, codemirror, explain, quickadd, patch
│  ├─ lib/store/             # db.ts, vault.ts, settings.ts
│  ├─ lib/git/  lib/sync/    # from Mycelium
│  ├─ lib/notify/            # local timers, push subscription
│  ├─ lib/ui/                # components
│  ├─ routes/                # today, month, script, sync, settings
│  └─ service-worker/
├─ static/engine/            # built remind.mjs + remind.wasm (CI artifact, not committed)
├─ tests/
│  ├─ fixtures/vaults/       # sample, edge cases, large
│  ├─ engine/                # golden + vectors
│  ├─ lens/                  # unit + property
│  └─ e2e/                   # Playwright: phone + desktop, axe
├─ worker/                   # from Mycelium, renamed
└─ .github/workflows/        # ci.yml, deploy.yml, worker.yml, engine.yml
```

---

## 6. Phases

Each phase lists its owner, what can run in parallel and its exit criteria. The lead updates **Progress** (section 13) at the end of each phase and does not start the next one until the exit criteria hold.

### Phase 0: Spike and scaffold

- Lead: scaffold SvelteKit static (copy Tessera's config, lint, Prettier, Vitest, Playwright and CI), `CLAUDE.md`, agent files, licence files.
- `engine-builder` (in parallel with scaffolding): build WASM from the vendored tarball; run the spike checklist in 3.2; write `docs/engine.md` with confirmed flags and JSON shapes.
- `remind-docs`: produce `docs/remind-reference.md`, a condensed digest of `remind.1` and `rem2ps.1` from the tarball (syntax, `-p`/`-ppp`/`--json` output formats, substitution table, error format). Other agents read this instead of the web.
- **Exit:** spike checklist all ticked, or a written no-go report for the human.

### Phase 1: Engine client and lens

Parallel, each in its own worktree:

- `engine-builder`: `src/lib/engine/*` (worker, client with request queue and cancellation, typed JSON parsing, diagnostics, timeout and respawn). Golden tests on fixture vaults.
- `lens-porter`: `src/lib/lens/*` with unit tests ported from the prototype behaviour; property tests for `patch.ts`; CodeMirror language.
- **Exit:** agenda, calendar and preview APIs return typed data for the fixture vaults; vectors pass; lens tests pass; reviewer sign-off on `patch.ts`.

### Phase 2: Vault and storage

- `sync-porter`: IndexedDB schema (`idb`), vault discovery (`DO`, `INCLUDE`, directories), a local-only "browser vault" provider seeded with the sample vault, import from a file or folder picker, export as a zip.
- **Exit:** sample vault loads, edits persist across reloads, byte-exact round trip proven on all fixtures.

### Phase 3: UI

- Lead first builds the app shell: nav (bottom tabs on phones, rail on desktop), theme, inspector and sheet primitives, toast with undo.
- Then `ui-builder` instances in parallel (separate worktrees, one per view): Today, Month, Script, Quick add, Inspector. Sync and Settings come in Phase 4.
- `test-writer` writes Playwright specs per view in parallel with the builders, from the spec in section 4.
- **Exit:** every view works on the sample vault at 360 px and 1366 px, in both themes, with axe clean and specs passing.

### Phase 4: Sync and worker

- `sync-porter`: port Mycelium git and sync modules, providers, three-way merge and conflict UI; Sync and Settings views (with `ui-builder` for the views).
- `worker-porter`: copy the worker, rename it, set `ALLOWED_ORIGINS`, keep the push Durable Object, update the setup docs.
- **Exit:** GitHub round trip (pull, edit, commit, push) proven in an e2e test against a test repo; Dropbox, OneDrive and WebDAV covered by mocked-API tests plus a manual checklist for the human.

### Phase 5: Notifications

- `sync-porter` or lead: local timers, push subscription, encryption and upload of the next 8 days (reuse Mycelium's code), Settings UI, iOS guidance.
- **Exit:** push delivered in a manual test on Android Chrome and an installed iOS PWA; unit tests for the schedule.

### Phase 6: PWA, performance, docs, deploy

- Lead: service worker and manifest; Lighthouse CI (mobile and desktop) with budgets from Tessera.
- `docs-writer`: README, user guide, setup docs, THIRD_PARTY_NOTICES, About screen text.
- Lead: `deploy.yml` gated on CI; `engine.yml` builds the WASM and uploads it as an artifact consumed by deploy.
- **Exit:** deployed to GitHub Pages, installs on iOS and Android, works offline, Lighthouse PWA and accessibility at 100 and performance at 90 or more on mobile.

### Phase 7: Final review

- `reviewer` (fresh context, read-only): checks the invariants in section 2, licence compliance (section 11), security of token handling and the worker, and the definition of done. The lead fixes findings and repeats until clean.

---

## 7. Testing strategy

- **Engine goldens:** fixture vaults in `tests/fixtures/vaults/` with expected agenda and calendar JSON per date. Regenerate only deliberately, and review diffs.
- **Man page vectors:** the 57 cases in `reference/manpage-vectors.test.js`, run through WASM. They cover date-spec interpretation, `First`/`Last`/`~N`/`Lastday`/`Lastworkday`, `-N` vs `--N`, `+N` vs `++N`, `SKIP`/`BEFORE`/`AFTER`, `THROUGH`/`UNTIL` with expiry, `*N`, `ADDOMIT`, TODO with `COMPLETE-THROUGH` and `MAX-OVERDUE`, and `%` substitutions.
- **Lens:** unit tests for tokenizer roles, continuation offset mapping, explanations, quick-add phrases (port the prototype's 15 sample phrases with expected REM lines), patches. Property test: random edits then inverse patches restore identical bytes; a no-op patch never changes bytes.
- **Agreement check:** for every quick-add output, the engine must accept the line with no diagnostics.
- **E2E (Playwright):** phone (390×844) and desktop (1366×860), light and dark, axe on every view; flows for mark done, undo, quick add, edit line, editor diagnostics, offline reload, sync with a mocked provider.
- **Performance:** engine timing on the large fixture vault in CI.

---

## 8. Definition of done (v1)

- Today, Month, Script, Sync and Settings views, inspector and quick add as specified, on phones and desktops.
- Dates match Remind exactly (vectors and goldens pass).
- Edits are byte-exact; undo works for every edit.
- GitHub, any git host, Dropbox, OneDrive and WebDAV sync, with diffs, conflict handling and no silent overwrites.
- Push reminders for `AT` times while the app is closed.
- Installs as a PWA and works offline.
- Deployed to GitHub Pages from CI; worker deployable from its own workflow.
- Licence, source link, notices, AI disclosure and not-affiliated statement in place.

---

## 9. Subagents and delegation

### 9.1 How the lead delegates

- The lead keeps context for integration: this plan, the app shell, shared types (`src/lib/engine/types.ts`, `src/lib/lens/types.ts`) and merges. It writes shared types **before** fanning out work that depends on them.
- Delegate when a task is well scoped, mostly self-contained and would flood the lead's context (builds, ports, test suites, docs digests). Keep iterative design decisions and cross-cutting changes with the lead.
- Parallel writers use `isolation: worktree` and touch disjoint directories. The lead merges their branches one at a time and runs the full checks after each merge.
- Brief each subagent with: the goal, the files it owns, the files it may read, the exit check and "return a summary of at most 200 words with the files you changed and anything you couldn't finish". Don't paste large files into the brief; name their paths.
- High-risk changes (`patch.ts`, sync engine, merge, token handling, worker, licence files) need a `reviewer` pass before merge.
- Nesting: only `engine-builder` and `sync-porter` may spawn helpers (for example a test-runner for long suites). Everyone else has `Agent` removed from their tools.
- Use `haiku` for digest and docs work, `sonnet` for most building, and `inherit` (the lead's model) for the engine, sync and review.

### 9.2 Agent files

The agent definitions live in `.claude/agents/` (one file per agent): `engine-builder`, `remind-docs`, `lens-porter`, `sync-porter`, `worker-porter`, `ui-builder`, `test-writer`, `docs-writer` and `reviewer`. Adjust tools there if a task needs more.

---

## 10. Security and privacy

- OAuth tokens live only in IndexedDB on the device. They reach only the provider and Fasti's worker, which holds them in memory for one request.
- The worker allow-lists origins and hosts, drops cookies and refuses IP and local hostnames for WebDAV (keep Mycelium's hardening section).
- Content Security Policy via a meta tag: `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, `connect-src` limited to the worker and the configured providers. One exception, recorded in Phase 0: SvelteKit's start-up script is inline in the page and SvelteKit has no option to move it to a file, so `script-src` allows that one script by its SHA-256 hash (SvelteKit's `csp.mode: 'hash'`). No `'unsafe-inline'`; any other inline script is blocked.
- Push payloads are encrypted on the device; the worker can't read reminder text.
- Remind always runs with `-r` and a time limit.

---

## 11. Licensing and compliance

- Fasti code: GPL-2.0-or-later, with SPDX headers on every source file.
- Remind: GPL-2.0-only. Ship its copyright notices in `THIRD_PARTY_NOTICES.md` and the About screen. The vendored tarball, build script and any patches in the public repo are the corresponding source; the About screen and Sync view link to them.
- Code copied from Mycelium (GPL-3.0-or-later): the human, as copyright holder, relicenses the copies as GPL-2.0-or-later (section 12, step 2). Before copying any file, `sync-porter` checks Mycelium's `THIRD_PARTY_NOTICES.md`. Any third-party code under GPL-3.0-only or another licence incompatible with GPLv2 must be replaced, not copied.
- Keep Remind a **separate program**: its own `remind.wasm` file, run in its own worker, talking to the app only through arguments, files in MEMFS and stdout/stderr, never linked into the app bundle. This keeps the GPL boundary clear.
- Licence audit of the Mycelium code to copy (done 2026-10-28; the grant is recorded in `THIRD_PARTY_NOTICES.md`). The git, sync, store, auth, Dropbox, OneDrive, WebDAV and push modules use only `isomorphic-git`, `@isomorphic-git/lightning-fs`, `buffer`, `node-diff3` and `dexie`, plus Mycelium's own org code. Their runtime trees are MIT, ISC, BSD-3-Clause, (MIT AND Zlib) and (MIT AND BSD-3-Clause), except four Apache-2.0-only packages, which must not ship:
  - `crc-32` and `clean-git-ref`, required by `isomorphic-git` itself: replace each with a small GPL-2.0-or-later module of Fasti's own through a Vite `resolve.alias` (isomorphic-git uses only `crc32.buf` for packfile indexes and `cleanGitRef.clean` for one error message), so their code never reaches the bundle.
  - `@isomorphic-git/idb-keyval` and `fast-text-encoding`, pulled in by `lightning-fs`: don't use `lightning-fs`; give isomorphic-git a small fs of Fasti's own on top of `idb` instead.
  - `dexie`: replaced by `idb`, as below.
  - Don't copy Mycelium's org code (`src/lib/org`): its `scan.ts` and `parse.ts` use `uniorg` (GPL-3.0-or-later). Where the copied workspace code calls `scanFile`, Fasti uses its own vault discovery.
  - The licence gate (`npm run licenses`) checks the result.
- Bundled JavaScript dependencies must still be GPLv2-compatible: MIT, BSD, ISC, MPL-2.0 and OFL (fonts) are fine; dual-licensed MIT/Apache is fine under its MIT option. **Apache-2.0-only is not compatible with GPLv2.** That rules out Dexie (used by Mycelium): use `idb` (ISC) behind the same small storage interface instead. Add a CI licence check (for example `license-checker` with an allow-list) that fails on anything else.
- README states: built with AI assistance; not affiliated with or endorsed by Remind or Dianne Skoll; Remind is © Dianne Skoll and others under GPL-2.0.

---

## 12. Human checklist

The agent can't do these; it should stop and ask when it reaches one.

1. **Remind source.** Download the latest release tarball and its signature from the Remind project page by hand, verify the signature, and commit both to `engine/vendor/` with `SOURCE.md` recording the URL, date and SHA-256.
2. **Relicence copied code.** Confirm you are the sole copyright holder of the Mycelium modules being copied, and add a line to `THIRD_PARTY_NOTICES.md` granting their use in Fasti under GPL-2.0-or-later.
3. **Accounts and apps.** Create the GitHub App (and optionally GitLab and Bitbucket OAuth apps), a Dropbox app and a Microsoft Entra app registration, with Fasti's redirect URLs. Set the repo variables in 3.7.
4. **Worker.** Deploy Fasti's worker to Cloudflare, set the OAuth secrets and the VAPID key pair, and set `PUBLIC_WORKER_URL`.
5. **Domain.** Choose a domain (or use `<user>.github.io/fasti`) and configure Pages.
6. **Manual checks.** Run the provider and push checklists the agent writes in Phases 4 and 5.

---

## 13. Progress

Keep this section current. One line per completed item, newest last.

- [ ] Phase 0: spike and scaffold
  - [x] Plan moved to `docs/PLAN.md`; `CLAUDE.md` and the nine agent files in `.claude/agents/` (section 9.2's bodies live there, not duplicated here); `reference/` holds the prototype and vectors (the vectors pass 57/57 against the prototype's own engine, which confirms the copy).
  - [x] Scaffold from Tessera: SvelteKit 3 + adapter-static (SPA, `404.html` fallback, prerendered `index.html`), Svelte 5, TypeScript strict, ESLint, Prettier, Vitest, Playwright (phone 390×844 and desktop 1366×860, light and dark, axe), design tokens and self-hosted fonts.
  - [x] CSP meta tag written by SvelteKit with a hash for its start-up script: `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts; fonts are never inlined as `data:` URIs.
  - [x] Licence files: `LICENSE` (GPL-2.0), `THIRD_PARTY_NOTICES.md`, README with AI-assistance and not-affiliated notes. `npm run licenses` checks the packages that actually have code in the client bundle (recorded by the build); `npm run spdx` checks SPDX headers. Both run in CI.
  - [x] Workflows: `ci.yml`, `engine.yml` (reusable, cached on `engine/**`), `deploy.yml` (only commits that passed CI).
  - [x] `engine/build.sh` in `emscripten/emsdk:6.0.13` pinned by digest (verified to run here); checks the tarball's SHA-256 against `SOURCE.md`. `engine/vendor/README.md` tells the human what to commit.
  - [ ] **Blocked on section 12, step 1** (the Remind tarball): WASM build, the spike checklist in 3.2, `docs/engine.md` with confirmed flags, `docs/remind-reference.md`.
- [ ] Phase 1: engine client and lens
- [ ] Phase 2: vault and storage
- [ ] Phase 3: UI
- [ ] Phase 4: sync and worker
- [ ] Phase 5: notifications
- [ ] Phase 6: PWA, performance, docs, deploy
- [ ] Phase 7: final review

### Risks and open questions

- Remind may need small build patches for Emscripten. These stay in this repo.
- `TZ` support depends on Emscripten's time zone handling (spike item).
- iOS push requires the app to be installed to the home screen.
- Very large vaults: if engine runs exceed budget, cache results per file hash and range.

---

## Appendix A: `CLAUDE.md`

See `CLAUDE.md` at the repository root.

## Appendix B: kickoff prompt

> Read PLAN.md and the files in reference/. You are the lead for building Fasti. Move PLAN.md to docs/PLAN.md, create CLAUDE.md from Appendix A and the agent files from section 9.2, then start Phase 0. Delegate as section 9 describes. Stop and ask me when you reach an item in section 12, or if the engine spike fails. After each phase, update Progress and give me a short summary.
