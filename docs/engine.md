# Engine

How Fasti runs Remind. Every date in the app comes from here.

**Status (Phase 0 spike, 2026-10-28):** unmodified Remind 06.03.06 builds
to WebAssembly reproducibly, passes all 57 man page vectors, resolves
`DO`/`INCLUDE`/directories in MEMFS, supports `TZ` and fits the size budget
with room to spare, all without a single C patch. **The performance budget
is missed:** a 3-month calendar of the 2,000-line fixture takes about
1.2–1.5 s with CPU throttling ×4, against a budget of 150 ms (see
[Performance](#performance)). Everything below was confirmed against
`man/remind.1.in` and `man/rem2ps.1.in` from the tarball and by running the
build. The tests in `tests/engine/` pin it.

## Build

`engine/build.sh` builds `static/engine/remind.mjs` and `remind.wasm` from
`engine/vendor/remind-06.03.06.tar.gz` inside `emscripten/emsdk:6.0.13`
(pinned by digest), and records what it built in `engine/BUILD-INFO.json`.

- It checks the tarball against the SHA-256 in `engine/vendor/SOURCE.md` (the
  first 64-hex string on a line starting `SHA-256` or `- SHA-256`).
- It applies `engine/patches/*.patch` in order. **There are none.**
- `emconfigure ./configure CFLAGS=-O2`. Replacing autoconf's default
  `-g -O2` matters: DWARF made `remind.wasm` 661 KB gzipped. Configure adds
  Remind's own `-Wall -Wextra -Wstrict-prototypes -flto=auto`.
- `emmake make -C src remind LDEXTRA="<link flags>"`. `src/Makefile` bakes
  `@LDFLAGS@` in at configure time, so `LDFLAGS=` on the make command line is
  silently ignored. `LDEXTRA` is the Makefile's hook on the link line.
- Configure runs its extensionless test programs with node. Inside this repo,
  node would read `package.json` (`"type": "module"`) and fail with "cannot
  run C compiled programs". The script writes `{ "type": "commonjs" }` into
  `engine/.build/` first.
- Link flags: `-O2 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createRemind
  -sENVIRONMENT=worker,node -sINVOKE_RUN=0 -sEXIT_RUNTIME=1
  -sALLOW_MEMORY_GROWTH -sFORCE_FILESYSTEM
  -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV --js-library=engine/time-zone.js.in`.
  `node` is there only so the tests can run the same module under Vitest.
  `ENV` is exported so a run can set `TZ`. No pthreads. `-O3` was tried: no
  faster.
- `engine/time-zone.js.in` is an Emscripten JS library that overrides
  `_mktime_js` and `_localtime_js`, which makes `TZ` work (see
  [Time zones](#time-zones)). It is named `.js.in` (Emscripten preprocesses
  it) because its `{{{ }}}` macros aren't plain JavaScript; ESLint and
  Prettier skip that extension.
- Configure finds no inotify or readline, and 64-bit `time_t`. `fork`,
  `popen`, `system` and `alarm` link against Emscripten's stubs as they are;
  `-r` keeps Remind from calling the first three.

`BUILD-INFO.json` records the Remind version, tarball SHA-256, emsdk version
and image, compile and link flags, JS libraries (with SHA-256), patches, and
the SHA-256 of `remind.wasm` and `remind.mjs`. CI's existing
`git diff --exit-code engine/BUILD-INFO.json` check therefore also catches a
non-reproducible build.

## Running Remind (contract for `src/lib/engine/worker.ts`)

`tests/engine/remind.ts` does exactly this under Node. Copy it.

1. Compile `remind.wasm` once. For each run, call `createRemind({ instantiateWasm })`
   with a fresh `WebAssembly.instantiate(module, imports)`. Remind keeps
   global state, so an instance is never reused. Instantiating takes about 2 ms.
2. In `preRun`, set `module.ENV.TZ` to the user's IANA zone (and anything else
   needed). Remind's local zone is `TZ`. Without it, the host zone is used.
3. Point fds 1 and 2 at MEMFS character devices that keep whole buffers
   (`FS.registerDevice`, `FS.mkdev`, `FS.close(FS.getStream(fd))`,
   `FS.open(path, 1)`). Emscripten's default TTYs cross into JS once per byte
   and force line buffering. That cost about 20% of a big calendar. Decode
   the bytes with `TextDecoder` after the run.
4. Write the vault under `/vault/`: directories `0700`, files `0600`. MEMFS's
   default `0666` is refused: `SECURITY: Won't read world-writable file or
   directory!`. Then `FS.chdir('/vault')`, which is what `INCLUDE` paths are
   relative to.
5. `callMain(['-r', …])`. `-r` always comes first. Catch `ExitStatus`
   (`e.status`) and use `onExit` for the code.

## Invocations (confirmed)

| Purpose | Command |
| --- | --- |
| Agenda for a day | `remind -r --json -q -h /vault/<main> YYYY-MM-DD@HH:MM` |
| Calendar for a range | `remind -r -ppp<months> -b2 [-m] [--hide-completed-todos] /vault/<main> YYYY-MM-01` |
| Weekly calendar | `remind -r -ppp+<weeks> -b2 [-m] … /vault/<main> YYYY-MM-DD` |
| Next date of every reminder | `remind -r -n /vault/<main> YYYY-MM-DD` |
| Diagnostics | `file(line): message` lines on stderr |

Notes:

- `-b2` instead of the plan's `-b1`: with `-b1`, Remind prefixes timed bodies
  (`"body":"09:30-10:30 Standup"`, with `rawbody` holding the original). Entries
  already carry `time`, `duration` and `eventstart`, so `-b2` keeps `body` clean.
- `--json` "disables queueing" (remind(1)). `-q` is harmless. Giving a time
  (`@HH:MM`) also implies `-q`. `-h` drops the banner and
  `{"noreminders": …}` objects only when nothing triggers.
- `-ppp` implies `-l` (file and line on every entry).
- `-n` prints `YYYY/MM/DD [h:mmam] body` lines: not JSON, no file or line,
  completed TODOs left out.
- `filename` is the path Remind opened. The main file and `DO` targets are
  absolute (`DO` joins the including file's directory), but a relative
  `INCLUDE` stays relative to `/vault` (`"sub/c.rem"`). The worker resolves
  both forms.
- A main entry that is a directory reads its `*.rem` files in sorted order.
- In calendar mode a diagnostic repeats once per day plus once more (29
  copies for February), so dedupe by `file(line): message`.
- With `-r`, `RUN` reminders are left out of calendars and report
  `file(line): RUN disabled` in agenda mode. `shell()` reports
  `shell(): RUN disabled` and `INCLUDECMD` reports `RUN disabled`.

### Agenda JSON

A single JSON array. remind(1), AGENDA MODE JSON OUTPUT: optional
`{"banner": …}` first, optional `{"noreminders": …}` last, and event objects
with the rem2ps(1) CALENDAR ENTRIES keys except `calendar_body`,
`plain_body` and `rawbody`. `date` is the trigger date, so a TODO or a `+N`
warning shows the future or overdue date, and `body` is fully substituted.

```json
[
{"banner":"Reminders for Wednesday, 28th October, 2026 (today):"},
{"date":"2026-10-29","filename":"/vault/m.rem","lineno":2,"d":29,"m":10,"y":2026,"is_todo":1,"delta":2,"trigbase":"2026-10-29","priority":5000,"body":"Open thing tomorrow"},
{"date":"2026-10-28","filename":"/vault/m.rem","lineno":3,"d":28,"m":10,"y":2026,"is_todo":0,"trigbase":"2026-10-28","priority":5000,"info":{"location":"Boardroom"},"body":"Review"}
]
```

### Calendar JSON (`-ppp`)

An array of month descriptors (rem2ps(1), PURE JSON INPUT FORMAT):
`caltype` (`"monthly"`), `monthname`, `year`, `daysinmonth`, `firstwkday`
(0 = Sunday), `mondayfirst`, `daynames`, `prevmonthname`, `daysinprevmonth`,
`prevmonthyear`, `nextmonthname`, `daysinnextmonth`, `nextmonthyear`,
`translations` (first month only) and `entries`. Entry keys are rem2ps(1)
CALENDAR ENTRIES: always `date`, `filename`, `lineno`, `priority`, `body`
and `is_todo`. When they apply: `lineno_start` (continued lines; `lineno` is
the last line), `time`, `duration`, `eventstart`, `eventduration`, `tdelta`,
`trep`, `tz`, `time_in_tz`, `eventstart_in_tz`, `d`, `m`, `y`, `wd`, `back`,
`delta` (negative for `++N`), `rep`, `skip`, `localomit`, `until`, `from`,
`scanfrom`, `once`, `trigbase`, `complete_through`, `max_overdue`, `tags`,
`info` (keys lower-cased), `passthru`, `r`/`g`/`b`, `nonconst_expr`,
`if_depth`, `rawbody`.

```json
[
{
"translations":{"LANGID":"en"},"caltype":"monthly","monthname":"October","year":2026,"daysinmonth":31,"firstwkday":4,"mondayfirst":0,"daynames":["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],"prevmonthname":"September","daysinprevmonth":30,"prevmonthyear":2026,"nextmonthname":"November","daysinnextmonth":30,"nextmonthyear":2026,"entries":[
{"date":"2026-10-05","filename":"/vault/m.rem","lineno":1,"tags":"work","duration":60,"time":570,"wd":["Monday"],"is_todo":0,"priority":5000,"eventstart":"2026-10-05T09:30","eventduration":60,"body":"Standup"},
{"date":"2026-10-28","filename":"/vault/m.rem","lineno":3,"info":{"location":"Boardroom"},"d":28,"m":10,"y":2026,"is_todo":0,"trigbase":"2026-10-28","priority":5000,"body":"Review"}
]
}
]
```

Weekly (`-ppp+N`) descriptors have `caltype: "weekly"`, `translations`,
`entries` and `dates`: seven objects like
`{"dayname":"Monday","date":"2026-10-26","year":2026,"month":"October","day":26}`.

Two places where the build disagrees with rem2ps(1) (the man page is wrong
or ambiguous; tests pin the real behaviour):

- rem2ps(1) spells the key `daysinmonnth`. Remind emits `daysinmonth`.
- rem2ps(1) says that in `-ppp` mode `body` keeps the `%"…%"` markers.
  Without the `q` flag, `body` is the text between the markers and
  `rawbody` is the full source. This matches remind(1): "If you include a
  q letter … the %"…%" sequences are preserved".

## Time zones

Remind converts zones with `setenv("TZ")`, `tzset()`, `mktime()` and
`localtime_r()`. Emscripten implements the last two with JS `Date`, which
knows only the host zone, so out of the box every `TZ` clause silently used
local time. `engine/time-zone.js.in` overrides `_mktime_js` and
`_localtime_js`. Each call reads `TZ` from the C environment and converts
with `Intl.DateTimeFormat`, so the browser's own zone data is used and no
zoneinfo files ship. It honours `tm_isdst` the way glibc does. With `TZ`
unset or empty it keeps the fast host-zone `Date` path.

Confirmed: the man page's TIMEZONE SUPPORT example gives `a = 2025-09-10,
b = 18:00` and `c = 2026-05-14, d = 06:59` exactly; the Amsterdam `SKIP`
example behaves as described; DST changes in both zones are followed;
`-ppp` entries carry `tz`, `time_in_tz` and `eventstart_in_tz`.

Remind only validates zone names if `/usr/share/zoneinfo` exists (it stats
`/usr/share/zoneinfo/<name>`). Writing an empty file there for each
`Intl.supportedValuesOf('timeZone')` name turns on its own warning:
``m.rem(1): No time zone file found for TZ `Mars/Olympus'... is it valid?``.

## Performance

Measured with `node tests/engine/perf-chromium.mjs`. It uses Chromium 153 via
Playwright and CDP `Emulation.setCPUThrottlingRate`. Each run uses a fresh
instance, writes the vault, runs `-ppp<n> -b2`, captures stdout and stderr
as buffers, and parses the JSON. The fixture is the 2,000-line vault in
`tests/fixtures/vaults/large/` (`make-large-vault.mjs`): about 1,800 active
reminders and 6,120 entries over 3 months. Medians of 9 runs (ranges span two
sessions):

| | worker ×1 | main ×1 | main ×4 |
| --- | --- | --- | --- |
| 3 months | 258–265 ms | 257–269 ms | **1,184–1,472 ms** |
| 1 month | 105 ms | 85 ms | 492 ms |

CDP throttling does not reach dedicated workers (worker ×4 ≈ ×1), so the ×4
figure comes from the main thread, which runs the same code. Native Remind
built from the same tarball takes 186 ms for the 3-month calendar, and
WASM takes 1.4–1.6× that (Chromium, Node). A profile shows Remind's parser
(`FindToken`, `ParseChar`, `ParseToken`) dominating. Remind re-runs the
whole script once per calendar day, so cost is roughly lines × days, about
6–8 ms per 1,000 lines per day at ×4. A one-day agenda costs about 7 ms
natively.

Options (not decided here): render the visible month first and fill the rest
in, with each month in its own parallel worker; cache results per (vault
hash, range), as the plan's risk list suggests; make the agenda the first
paint; or re-scope the budget (for example "first month under 500 ms at ×4").

## Spike checklist

- [x] Builds reproducibly from the vendored tarball: two clean builds gave an
      identical `BUILD-INFO.json`, `remind.wasm` SHA-256 `041a2c95…a386` and
      `remind.mjs` SHA-256 `384adbfa…7f2107`. No patches.
- [x] All 57 vectors in `reference/manpage-vectors.test.js` pass through WASM
      (`tests/engine/manpage-vectors.test.ts`). Translations of prototype-only
      checks are commented in the file; none needed a changed expected value.
- [x] `DO`, `INCLUDE` and directory includes resolve inside MEMFS
      (`tests/engine/memfs.test.ts`).
- [x] File permission and uid checks don't block reading: files `0600`, and
      `geteuid()` is 0 with MEMFS files owned by uid 0.
- [x] `TZ` works via `engine/time-zone.js.in` and `Intl`, with no zoneinfo bundle
      (`tests/engine/timezone.test.ts`).
- [ ] 2,000-line vault, 3-month calendar, under 150 ms with CPU throttling ×4:
      **missed: 1,184–1,472 ms** (1 month: 492 ms).
- [x] Gzipped `remind.wasm` plus glue under 400 KB: 164,354 + 19,762 =
      184,116 bytes.

## Known limitations

- Performance on big vaults (above).
- `TZ` names Intl doesn't know are read as a POSIX `STDoffset` string with
  any DST rule ignored (`!EST+5EDT,M3.2.0/2,M11.1.0/2` acts as fixed UTC−5).
  Anything else is UTC.
- remind(1) says Remind "will not read a file that is group- or
  world-writable". The code (`CheckSafetyAux`) refuses only world-writable
  ones, and the test pins that.
- `RUN` reminders never appear in calendars, and with `-r` they show no
  body in the agenda.
