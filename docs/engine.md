# Engine

How Fasti runs Remind. Every date in the app comes from here.

**Status:** waiting for the Remind release tarball (docs/PLAN.md section 12,
step 1). The flags and output shapes below are the plan's starting point; the
Phase 0 spike confirms each one against `remind.1` and `rem2ps.1` from the
tarball and replaces this note with what it found.

## Build

`engine/build.sh` builds `static/engine/remind.mjs` and `remind.wasm` from
`engine/vendor/remind-<version>.tar.gz` inside
`emscripten/emsdk:6.0.13` (pinned by digest), and records what it built in
`engine/BUILD-INFO.json`.

- It checks the tarball against the SHA-256 in `engine/vendor/SOURCE.md`.
- It applies `engine/patches/*.patch` in order (none so far).
- Link flags: `-sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createRemind
  -sENVIRONMENT=worker,node -sINVOKE_RUN=0 -sEXIT_RUNTIME=1
  -sALLOW_MEMORY_GROWTH -sFORCE_FILESYSTEM
  -sEXPORTED_RUNTIME_METHODS=callMain,FS`. `node` is there only so the golden
  tests can run the same module under Vitest. No pthreads.

## Invocations (to confirm in the spike)

Every run passes `-r` (no `RUN`, no `shell()`), and runs in a fresh instance
with the vault in MEMFS at `/vault/`, mode `0600`.

| Purpose | Command |
| --- | --- |
| Agenda for a day | `remind --json -r -q -h /vault/<main> YYYY-MM-DD@HH:MM` |
| Calendar for a range | `remind -ppp<months> -r -b1 [-m] [--hide-completed-todos] /vault/<main> YYYY-MM-01` |
| Weekly calendar | `remind -ppp+<weeks> …` |
| Next date of every reminder | `remind -n -r /vault/<main>` |
| Diagnostics | `file(line): message` lines on stderr |

## Spike checklist

- [ ] Builds reproducibly in CI from the vendored tarball.
- [ ] All 57 vectors in `reference/manpage-vectors.test.js` pass through WASM.
- [ ] `DO`, `INCLUDE` and directory includes resolve inside MEMFS.
- [ ] File permission and uid checks don't block reading.
- [ ] `TZ`: works with Emscripten's time functions and a bundled zoneinfo subset, or is a recorded limitation with a diagnostic.
- [ ] 2,000-line vault, 3-month calendar, under 150 ms with CPU throttling ×4.
- [ ] Gzipped `remind.wasm` plus glue under 400 KB.

## Known limitations

None recorded yet.
