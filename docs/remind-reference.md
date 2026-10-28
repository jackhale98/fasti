# Remind 06.03.06 reference digest

This is a digest of the Remind 06.03.06 man pages (`remind.1` and `rem2ps.1`), © Dianne Skoll (author per the AUTHOR section of remind.1). The man pages are authoritative; this file is a condensed reading aid. Where this digest is silent or appears to disagree with the man pages, the man pages win.

## Sources and conventions

- Source tarball: `engine/vendor/remind-06.03.06.tar.gz`, extracted to a scratch directory for reading. Troff sources read: `man/remind.1.in` and `man/rem2ps.1.in`.
- "remind(1)" means `remind.1`; "rem2ps(1)" means `rem2ps.1`.
- Section names in double quotes are the `.SH` headings (or bold `.B` sub-headings) in those files, so readers can check them.
- This digest does not record which options Fasti's own code passes. The option list below is the one requested for this file.

---

## 1. Invocation and command-line options

### 1.1 Synopsis (remind(1), "SYNOPSIS")

```
remind [options] filename [date] [*rep] [time]
rem [options] [date] [*rep] [time]
```

`rem` is a symbolic link to `remind`. When invoked as `rem`, do not supply a filename. The file is chosen in this order (remind(1), "DESCRIPTION"):

1. `--file=filename`
2. environment variable `REMIND_FILE`
3. environment variable `DOTREMINDERS`
4. default `$HOME/.reminders`

A filename of `-` reads standard input. A directory is read as all files matching `*.rem` in sorted order (not subdirectories).

Remind stops reading a file at a line whose sole content is `__EOF__`.

### 1.2 Modes of operation (remind(1), "MODES OF OPERATION")

- **Agenda Mode**: default. Prints today's reminders and exits. May fork a background process for queued timed reminders.
- **Calendar Mode**: `-c`, `-s`, or `-p`.
- **Daemon Mode**: `-z` (used by TkRemind).
- **Purge Mode**: `-j`. Writes `*.purged` copies; never edits the original.

### 1.3 Options (remind(1), "OPTIONS" unless noted)

| Option | Meaning per man page |
|---|---|
| `-r` | Disables RUN directives and the `shell()` function. Overridden by `-k` (see 1.4). `-u` implies `-r` (see 1.4). |
| `-q` | Do not queue timed reminders for later execution. A time on the command line implicitly enables `-q` (see 1.5). A repeat `*rep` on the command line also enables `-q`. `--json` also disables queueing. |
| `-h` | "hush": suppresses certain warning and information messages. If no reminders are triggered, produces no output. The man page does not list which warnings are suppressed. |
| `-n` | Prints the next occurrence of each reminder in a simple calendar format. Ignores `-g`. Implicitly enables `-o`. Output layout beyond "simple calendar format" is not documented. |
| `-b[n]` | Time format for calendar and simple-calendar outputs. `0` (default): 12-hour am/pm. `1`: 24-hour. `2`: no automatic time insertion. |
| `-m` | With `-c` or `-p`, the calendar's first column is Monday rather than Sunday. In `-p` output this sets `monday_first` to 1 (see section 2.3). |
| `-l` | With `-p`, adds per-reminder file and line information. `-pp` and `-ppp` also enable `-l`. Sets read-only `$PrefixLineNo`. |
| `-p[a][p][p][q][+]n` | Calendar data for back-ends such as rem2ps. See 1.6 and section 2.3. |
| `-pp` | Partial JSON format (rem2ps(1), "REM2PS PARTIAL JSON INPUT FORMAT (-PP OPTION)"). Enables `-l`. |
| `-ppp` | Pure JSON format (rem2ps(1), "REM2PS PURE JSON INPUT FORMAT (-PPP OR -P+ OPTION)"). Enables `-l`. |
| `--json` | Agenda Mode only. Outputs a single JSON array instead of text (section 2.2). Also disables sorting (`-g`) and queueing (`-q`). Ignored in Calendar Mode. RUN output that would normally go to stdout goes to stderr instead. |
| `--hide-completed-todos` | Calendar Mode only. Does not show TODOs marked completed. Without this option Calendar Mode shows all TODOs. |
| `-g[a\|d[a\|d[a\|d[a\|d]]]]` | Sort reminders before issuing them, by trigger date, time, and priority (see 1.7). Ignored with `-n`. `--json` disables it. |
| `-x[n]` | Iteration limit for the SATISFY clause. Default 10000. |
| `-o` | Ignores all ONCE directives. Implicitly enabled by `-c`, `-n`, `-p`, `-s`. |
| `-a` | One `-a`: do not immediately trigger timed reminders due today, and do not place timed reminders in a calendar. Two or more `-a`: also trigger future timed reminders, but not past ones. Any `-a` keeps timed reminders out of calendars. |
| `-e` | Sends error messages (normally stderr) to stdout. |
| `-f` | Stay in the foreground when processing queued reminders. `-z` also enables `-f`. |
| `-k cmd` | Pass MSG-type reminder bodies to `cmd`; `%s` marks where the body goes. Overrides `-r`. Disabled by `-c`, `-s`, `-p`, `-n`. `-k:cmd` applies only to queued timed reminders. |
| `-z[n]` | Daemon mode; wake every n minutes (1 to 60, default 1). `-zj` is server mode for tkremind(1). |
| `-u name` | Run with the uid/gid of `name` and set HOME, SHELL, USER, LOGNAME. Implies `-r`. `-u+name` keeps RUN enabled. |
| `-+username` | Trust files owned by `username` (up to 20 trusted users). See section 7. |
| `-y` | Synthesize a TAG for reminders that lack one. |
| `-ivar=expr` | Initialize a variable on the command line. |
| `-t`, `-tn`, `-tz`, `-tt[n]` | `-t`: trigger all non-expired reminders regardless of delta. `-tn`: pretend every REM has delta `++n`. `-tz`: set all deltas to zero. `-tt[n]`: default delta of n minutes for timed reminders (5 if n omitted). |
| `-d chars` | Debug flags (e, x, t, v, l, f, p, s, h, u, n, q, m). |
| `-v` | Slightly more verbose: echoes a bad line in case of error; security message on `$RunOff` tests. |
| `-j[n]` | Purge mode (remind(1), "PURGE MODE"). |
| `-c[flags]n` | Calendar for n months (default: current month only). Flags: `+` (n weeks), `a`, `l`, `u`, `z`, `c`. |
| `-s[a]n` | Simple calendar, unformatted. `+n` means n weeks. Implicitly enables `-o`. |
| `-w col[,pad[,spc[,spc2]]]` | Calendar width and padding. |

Long options (remind(1), "LONG OPTIONS"): `--version`, `--file=filename`, `--hide-completed-todos`, `--only-todos`, `--only-events`, `--json`, `--no-fmt` (converts FMT reminders to MSG by stripping tags), `--print-errs`, `--print-config-cmd`, `--print-tokens`, `--max-execution-time=n`, `--max-expr-complexity=n`, `--test` (acceptance tests only), `--flush`.

### 1.4 Notes on specific options

- `-r` (remind(1), "OPTIONS" and "THE RUN COMMAND"): with `-r`, RUN-type reminders and `shell()` are disabled regardless of any `RUN ON` in the script. Commands given with `-k` still run.
- `-u` (remind(1), "OPTIONS"): as of 3.00.17, `-uname` implies `-r`. Running as root changes uid and gid. Non-root users only get the environment variables changed.
- `-k` (remind(1), "OPTIONS"): "this option overrides the -r option and the RUN OFF command". Shell characters in the body are escaped and the whole body is one argument.

### 1.5 Date and time arguments (remind(1), "OPTIONS", paragraphs after `-d`)

- A date on the command line has the form `[day] month [year]`. Month: at least the first three letters of the English name (required). Day: defaults to 1. Year: 4 digits, 1990 to about 2075; defaults to the current year. The supplied date replaces the system date as "today".
- `YYYY-MM-DD` or `YYYY/MM/DD`. `YYYY-MM-DD@HH:MM` gives date and time in one argument.
- Time: 24-hour (`13:20`) or AM/PM (`1:20pm`). Supplying a time sets Remind's "now", and implicitly enables `-q` and disables `-z`.
- A leading `@` makes the argument a trigger expression. Example from the man page: `remind .reminders '@13 SATISFY [$Tw == 5]'`. Combined with a date: `remind .reminders 2026-07-01 '@13 SATISFY [$Tw == 5]'` sets today to 2026-11-13 (the man page's stated result).
- Repeat: `*rep` runs the script rep times, incrementing the date each time. Enables `-q`, disables `-z`. Quote it to avoid shell expansion. Example: `remind .reminders '*7'`.
- Calendar with months: `remind -c .reminders jan 1993` (remind(1), "CALENDAR MODE").

### 1.6 The `-c`, `-s`, `-p` count argument

- `-c`: n is a number of months; default is the current month only ("OPTIONS").
- `-s` and `-p`: a leading `+` in n means a number of weeks rather than months. `-p+` / `-ppp+` weekly output is documented in rem2ps(1). Only rem2pdf and rem2html support weekly calendars (remind(1), "OPTIONS", `-p`).
- The man pages do not state a default n for `-p`, `-pp` or `-ppp` (the synopsis shows n as required).

### 1.7 Sorting with `-g` (remind(1), "SORTING REMINDERS")

- `-g` takes up to four characters, each `a` (ascending, default) or `d` (descending). Position 1: trigger date. Position 2: trigger time. Position 3: priority. Position 4: `d` sorts untimed reminders before timed ones (default is timed first).
- Ties by date and time break on priority; reminders equal on all keys keep script order.
- A user function `SORTBANNER(date)` may print a banner per date when sorting.

### 1.8 Other Remind-wide notes

- Commands and parameters are case-insensitive in Remind (remind(1), "REMINDER FILES"). rem2ps options are case-sensitive (rem2ps(1), "BUGS").
- Line continuation with a trailing `\`. Errors are reported at the last line of a continued line (remind(1), "REMINDER FILES").
- Comments: lines starting with `#` or `;`.

---

## 2. Output formats

### 2.1 Agenda text

The default banner is `Reminders for %w, %d%s %m, %y%o:` (remind(1), "THE BANNER COMMAND"). `BANNER %` disables it. The banner is not printed with calendar options or with `-k`. The man page does not define a fixed layout for the normal reminder lines beyond the MSG body and the blank line after each reminder (remind(1), "THE SUBSTITUTION FILTER", notes).

### 2.2 `--json` agenda output (remind(1), "AGENDA MODE JSON OUTPUT")

Output is a single JSON array of zero or more objects. Three object types:

- **banner**: at most one, first in the array. Single key `banner` whose value is the banner Remind would normally print.
- **noreminders**: at most one, last in the array. Single key `noreminders` with the value `"No reminders."` (possibly localized).
- **event**: all other objects. Each contains all keys from rem2ps(1) "CALENDAR ENTRIES" (section 2.3.2), except `calendar_body`, `plain_body` and `raw_body`, which are not present.

Caveat: rem2ps(1) spells the raw-body key `rawbody` (in "CALENDAR ENTRIES"), but remind(1) refers to `raw_body`. Check the actual output before relying on either spelling.

The man page does not say how `-h` interacts with `--json`.

### 2.3 Calendar-mode data formats (rem2ps(1))

Remind produces these with `-p`, `-pp`, `-ppp` (and `-p+`/`-ppp+` for weekly). rem2ps(1) "USAGE": `remind -p ~/.reminders | rem2ps -l -sd 18 > cal.ps`. rem2ps is deprecated in favour of rem2pdf (remind(1), "THE SUBSTITUTION FILTER", notes).

#### 2.3.1 `-p` simple format (rem2ps(1), "REM2PS INPUT FORMAT (-P OPTION)")

Header lines, in order:

1. `# translations`, then one line holding a JSON object with the translation table. Only the first month includes it.
2. `# rem2ps begin`
3. `month_name year num_days first_day monday_first`
   - Spaces in `month_name` are replaced by `_`.
   - `first_day`: 0 = Sunday ... 6 = Saturday.
   - `monday_first`: 1 if `-m` was given, else 0.
4. `sun mon tue wed thu fri sat` (localized, spaces replaced by `_`).
5. `next_mon next_days`
6. `prev_mon prev_days`

Entry lines, one per reminder:

```
yyyy/mm/dd special tag dur time body
```

- `yyyy/mm/dd`: always `/` separators.
- `special`: `*` for a normal reminder; otherwise a special string (rem2ps understands `PostScript` and `PSFile`). Back-ends ignore specials they do not know.
- `tag`: TAG value, comma-separated if several; `*` if none.
- `dur`: DURATION in minutes, or `*`.
- `time`: minutes past midnight, or `*` if not timed.
- `body`: the reminder body.

With `-l`, a line `# fileinfo lineno filename` may precede reminders.

After a month: `# rem2ps end`. Read until EOF; more months may follow.

The simple format cannot carry INFO strings (remind(1), "OPTIONS", `-p`).

#### 2.3.2 `-pp` partial JSON (rem2ps(1), "REM2PS PARTIAL JSON INPUT FORMAT (-PP OPTION)")

Same header lines as 2.3.1, except the begin/end markers are `# rem2ps2 begin` and `# rem2ps2 end`. The month/day-name/next/prev lines are "Same as the -p format".

Entries are one JSON object per line, each starting with `{`. Under "CALENDAR ENTRIES" the man page lists these keys:

| Key | Value / meaning | When present (per man page) |
|---|---|---|
| `date` | `YYYY-MM-DD` trigger date | Always |
| `filename` | file the reminder came from | Not stated (see section 8) |
| `lineno` | line number (last line of a continued reminder) | Not stated (see section 8) |
| `lineno_start` | first line of a continued reminder | Only if the reminder spans several lines |
| `nonconst_expr` | `1` | If a non-constant expression was evaluated for the trigger; recurrence semantics then unsafe |
| `if_depth` | number of enclosing IF/ELSE | Only if inside IF or ELSE |
| `passthru` | SPECIAL type (SHADE, COLOR, MOON, ...) | Only for SPECIAL reminders |
| `tags` | comma-separated tags | Only if TAG clauses present |
| `info` | object; keys are INFO headers lower-cased, values are INFO values | Only if INFO present |
| `tz` | time zone name | Only if a non-empty TZ clause |
| `time` | AT time, minutes after midnight, system default time zone | Only if AT present |
| `time_in_tz` | AT time, minutes after midnight, in TZ zone | Only if TZ present |
| `tdelta` | minutes from `+n` after AT | Only if a time delta present |
| `trep` | minutes from `*n` after AT | Only if a time repeat present |
| `eventduration` | DURATION in minutes | Only if DURATION present |
| `duration` | today's duration in minutes (see remind(1) "MULTI-DAY EVENTS") | Only if DURATION present |
| `eventstart` | `YYYY-MM-DDTHH:MM`, system default time zone | Only if AT present |
| `eventstart_in_tz` | `YYYY-MM-DDTHH:MM` in TZ zone | Only if TZ present |
| `back` | back value; positive for `-n`, negative for `--n` | Only if a back clause present |
| `delta` | delta value; positive for `+n`, negative for `++n` | Only if a delta clause present |
| `trigbase` | `YYYY-MM-DD` built from day, month and year | Only if all three components given |
| `rep` | repeat value (`*n`) | Only if repeat present |
| `skip` | `SKIP`, `BEFORE` or `AFTER` | Only if one of those present |
| `localomit` | array of English day names | Only if a local OMIT present |
| `wd` | array of English day names | Only if weekdays present |
| `d` | day-of-month number | Only if day present in spec |
| `m` | month number | Only if month present in spec |
| `y` | year | Only if year present in spec |
| `until` | `YYYY-MM-DD` | Only if UNTIL or THROUGH present |
| `once` | `1` | Only if ONCE present |
| `scanfrom` | `YYYY-MM-DD` (absolute) or negative integer `-n` (relative) | Only if SCANFROM present |
| `from` | `YYYY-MM-DD` | Only if FROM present |
| `is_todo` | `1` if TODO, else `0` | Man page does not say it is always present (see section 8) |
| `complete_through` | `YYYY-MM-DD` | Only if COMPLETE-THROUGH present |
| `max_overdue` | integer | Only if MAX-OVERDUE present |
| `priority` | integer; default 5000 | Always |
| `r`, `g`, `b` | colour components | For SHADE or COLOR specials; for FORMATTED specials set from `$DefaultColor`; may appear with `--no-fmt` |
| `body` | reminder body | Always |
| `calendar_body` | calendar text | Only if body has `%"..%"` and the `q` modifier was used with `-pp...` |
| `plain_body` | body with `%"..%"` removed | Man page does not state the presence condition |
| `rawbody` | body before expression pasting and substitution | Only if it differs from the processed body |

Back-ends should use `calendar_body` if present, else `plain_body` if present, else `body`. Future versions may add keys; back-ends must ignore unknown keys. After a month: `# rem2ps2 end`.

#### 2.3.3 `-ppp` and `-p+` pure JSON (rem2ps(1), "REM2PS PURE JSON INPUT FORMAT (-PPP OR -P+ OPTION)")

Output is a JSON array. Each element is a month descriptor, or a week descriptor for `-p+`.

Keys in every descriptor:

- `caltype`: `monthly` or `weekly`. Missing means monthly (older Remind).
- `translations`: translation table object. Only with the first month or week.
- `entries`: array of entry objects in the 2.3.2 format, with one difference: in `-PP` a body with `%"` markers contains only the text between markers; in `-PPP` the whole text including markers is in `body`, and the back-end must extract.

Monthly descriptors only:

- `monthname`, `year`, `daysinmonnth` (spelled this way in the man page), `firstwkday` (0 = Sunday ... 6 = Saturday), `mondayfirst` (0 = Sunday first, 1 = Monday first), `daynames` (7 strings, Sunday through Saturday).
- `prevmonthname`, `daysinprevmonth`, `prevmonthyear` (same as `year` unless January).
- `nextmonthname`, `daysinnextmonth`, `nextmonthyear` (same as `year` unless December).

Weekly descriptors only:

- `dates`: array of seven objects, one per column, each with `date` (`YYYY-MM-DD`), `day` (day number), `dayname` (possibly localized), `month` (possibly localized), `year`.

The man page's `-p` section says weekly output is only supported by rem2pdf and rem2html, and that `-p+`-style weekly output "implicitly enables the pure JSON interchange format, similar to -ppp".

### 2.4 Calendar text (`-c`, `-s`)

Calendar layout for `-c` is described in remind(1), "CALENDAR MODE" and "OPTIONS" (`-c`, `-w`). `%"...%"` text is what enters calendar boxes (section 6 covers the substitution filter). MSG and CAL bodies go in whole by default; RUN bodies do not unless `%"..%"` is used.

---

## 3. REM syntax summary (remind(1), "THE REM COMMAND")

Skeleton from the man page:

```
REM [ONCE] [date_spec]
    [back]
    [delta]
    [repeat]
    [TODO]
    [MAX-OVERDUE n]
    [COMPLETE-THROUGH complete_date]
    [PRIORITY prio]
    [SKIP | BEFORE | AFTER]
    [OMIT omit_list]
    [ADDOMIT]
    [NOQUEUE]
    [OMITFUNC omit_function]
    [AT time [tdelta] [trepeat]]
    [SCHED sched_function]
    [WARN warn_function]
    [UNTIL expiry_date | THROUGH last_date]
    [SCANFROM scan_date | FROM start_date]
    [DURATION duration]
    [TAG tag]
    [TZ timezone]
    [INFO "info_string"]
    MSG | MSF | FMT | RUN | CAL | SATISFY | SPECIAL special | PS | PSFILE
    body
```

"The parts of the REM command can be specified in any order, except that the body must come immediately after the MSG, RUN, CAL, PS, PSFILE or SATISFY keyword." The man page examples put an expression between SATISFY and the body keyword (for example `SATISFY [$Td == 13] MSG ...`); see section 8.

The part before MSG/MSF/RUN/CAL/SATISFY is the **trigger**. The bare `REM` token is optional in old versions but deprecated, and now warns (remind(1), "THE REM COMMAND").

### 3.1 Body types (remind(1), "MSG, MSF, RUN, CAL, SPECIAL, PS and PSFILE")

- **MSG**: prints the substituted body to stdout (or to `-k cmd`). Omitting the type is deprecated and warns ("Missing REM type; assuming MSG").
- **MSF**: like MSG but reformatted as a paragraph. Uses `$FirstIndent`, `$SubsIndent`, `$FormWidth`, `$EndSent`, `$EndSentIg`. `%_` starts a new paragraph.
- **FMT**: Remind's own markup (subset of Pango markup); "FORMATTED REMINDERS". `SPECIAL FORMATTED` is equivalent.
- **RUN**: substituted body is executed as a system command with stdin from /dev/null. Disabled by `-r`, `-u`, `RUN OFF`.
- **CAL**: only goes into calendar output (`-c`, `-s`, `-p`).
- **SPECIAL special**: out-of-band data for a back-end, e.g. `SPECIAL PostScript` (like PS), `SPECIAL PSFile` (like PSFILE). Back-ends must ignore unknown specials.
- **PS**: PostScript code passed to rem2ps; ignored unless `-p`. Ordered by priority within a day; the man page advises against giving PS reminders priorities.
- **PSFILE**: body is a filename; rem2ps includes that file's contents.
- **SATISFY expr**: see section 3.8.

### 3.2 Date specifications (remind(1), "DATE SPECIFICATIONS", "INTERPRETATION OF DATE SPECIFICATIONS")

Parts: day (1 to 31), month (English name, at least first 3 letters), year (1990 to 2075), weekday (English name, at least first 3 letters). Several weekdays may be listed.

Cases (man page examples):

- Nothing: every day.
- Day only: that day of each month, closest to the current date.
- Month only: every day of that month.
- Day + month: e.g. `6 Jan`, `Feb 29`.
- Year only: every day in that year.
- Year + day, year + month, day + month + year: as written.
- Weekday only: e.g. `Sat`, `Mon Tue Wed Thu Fri`.
- Weekday + day: "first weekday on or after the day", e.g. `Sat 1` = first Saturday of the month.
- Weekday + month, weekday + year, weekday + day + month, weekday + day + year, weekday + month + year, weekday + day + month + year: as the man page's examples 9 to 16.
- With weekday and day, the trigger is the first date on or after the day that satisfies a listed weekday. Example: `REM Mon Tue 28 Oct 1990` fires only on Monday 29 October 1990.

Short forms: `YYYY-MM-DD` or `YYYY/MM/DD`. `YYYY-MM-DD@HH:MM` for date and time. `REM 19 Dec 2010 AT 16:45 +60` differs from `REM 2010-12-19@16:45 +60` (the second `+60` applies to the date). The man page recommends `AT` explicitly for timed reminders.

Ordinal and last forms (remind(1), "SYNTACTIC SUGAR FOR REM"):

- `First`, `Second`, `Third`, `Fourth`, `Last` plus a weekday: `REM Second Monday May` = `REM Mon 8 May`; `REM Last Monday` = `REM Mon 1 --7`. `Last` adjusts month and year as needed.
- `IN` is ignored: `REM Second Monday in May MSG foo`.
- `~N` and `~~N` (back forms): `REM ~~1` = `Lastday` = `REM 1 --1` (last day of month). `REM ~1 OMIT SAT SUN` = `Lastworkday`. `~~7` = seventh-last day. `~2 OMIT SAT SUN` = second-last workday.
- Illegal: `First Monday 3 June`, `April 3 ~~1`, `Second June` (no weekday). `First/Second/Third/Fourth/Last` need a weekday and cannot combine with a day; `~`/`~~` cannot combine with a day.

### 3.3 Back and delta (remind(1), "BACKWARD SCANNING", "ADVANCE WARNING", "LOCALLY OMITTING WEEKDAYS")

- **Back**: `-N` or `--N` moves the trigger back N days. `REM Mon 1 -7` = last Monday of the month. `-` and `+` forms skip globally-omitted days; `--` and `++` do not.
- **Delta**: `+N` or `++N` triggers on the trigger date and the N days before it. `+` does not count omitted days (global or local); `++` does count them. Example: `REM 6 Jan +5` fires 1 to 6 January.
- Local `OMIT` affects counting for `+`/`-` (see 4.2).
- Back is used only to compute the start date when combined with repeat.

### 3.4 Repeat (remind(1), "PERIODIC REMINDERS")

`*N` repeats every N days from a fully specified start date (year, month, day; weekday optional). Back is used only for the start date, and a weekday affects only the start. Example: `REM 28 Oct 1992 *14 MSG Payday`.

Combined with UNTIL for a bounded run: `REM 1992-11-30 *1 +2 UNTIL 1992-12-04 MSG Jury duty`. Equivalent: `REM 1992-11-30 +2 THROUGH 1992-12-04 MSG Jury duty`.

### 3.5 Expiry and window keywords

- **UNTIL date**: never triggers after date.
- **THROUGH date**: shorthand for `*1` plus `UNTIL` (the man page: "you can use the THROUGH keyword instead of *1 and UNTIL"). Example above.
- **FROM date**: prevents triggering before date. `REM Mon Thu FROM 23 Jul 2007 UNTIL 2 Aug 2007`. Internally the same as `SCANFROM [max(today(), date)]`; FROM and SCANFROM cannot both be used (remind(1), "MISCELLANEOUS").
- **SCANFROM scan_date** or **SCANFROM -N**: starts the scan at scan_date (absolute) or N days before today (relative). Used for movable holidays. Example: `REM Mon 1 Sept SCANFROM -7 ADDOMIT MSG Labour Day`.
- An expiry date overrides AFTER: `OMIT 2021-01-08` plus `REM 2021-01-01 THROUGH 2021-01-08 AFTER MSG Test` does not fire on 8 or 9 January (remind(1), "EXPIRY DATES").

### 3.6 Other clauses

- **ONCE**: fires only the first time Remind runs on a given day. Uses the reminder file's access date, or `$OnceFile` if set (must be writable by the current user). Ignored with `-o`, with a date other than today, or with `*rep`. With stdin as input, `$OnceFile` is required. Also ignored with `-c`, `-n`, `-p`, `-s` (remind(1), "THE ONCE KEYWORD" and "OPTIONS", `-o`).
- **PRIORITY n**: 0 to 9999; default 5000 (`$DefaultPrio`). Used in Calendar Mode and for sorting ties.
- **TODO**: marks an item as a task. Only Agenda Mode treats TODOs specially (section 3.7).
- **COMPLETE-THROUGH date**: marks TODO recurrences completed through date. Requires TODO. Synonym: `COMPLETED-THROUGH`.
- **MAX-OVERDUE n**: stop reminding about a TODO once overdue by more than n days.
- **SKIP / BEFORE / AFTER**: move or skip a trigger that falls on an omitted day (section 4.3).
- **ADDOMIT**: adds the computed trigger date to the global OMIT list. Equivalent to `SATISFY 1` plus `IF trigvalid() OMIT [trigdate()] MSG ... ENDIF` (remind(1), "ADDING TRIGGER DATES TO THE OMIT CONTEXT").
- **NOQUEUE**: a timed reminder is not queued for popup; the time is still known (calendar).
- **OMITFUNC f**: local omit via a user-defined function taking a DATE and returning non-zero for omitted days. With OMITFUNC, a local OMIT and all global OMITs are ignored (remind(1), "COMPUTED LOCAL OMITS").
- **SCHED f**: user-defined scheduling function for timed reminders. Any tdelta is ignored, and the reminder cannot be queued earlier than its trigger date (remind(1), "THE SCHED AND WARN KEYWORDS").
- **WARN f**: user-defined function giving advance-warning days (`WARN _wfun` with `FSET _wfun(x) choose(x, 5, 3, 1, 0)` for 5, 3 and 1 days before). Replaces delta (remind(1), "PRECISE SCHEDULING").
- **TZ zone**: case-sensitive time-zone name for the AT time; requires an AT clause. Prefix with `!` to suppress the zoneinfo validation warning. In a TZ reminder, OMIT dates and SATISFY are evaluated in that zone (remind(1), "TIMEZONE SUPPORT").
- **TAG t**: up to 48 characters, no whitespace or comma. Several TAGs allowed. `-y` synthesizes `__syn__` plus the MD5 of the REM line.
- **INFO "Header: Value"**: header has no whitespace; no duplicate headers (case-insensitive). Standard headers: `Location:`, `Description:`, `Url:`. Strings concatenate with `+`. `\n` in a string is a newline (remind(1), "TAG, INFO AND DURATION").
- **DURATION d**: for timed reminders. `hh:mm` or integer minutes; `0` or `00:00` means no duration. Can exceed 24 hours. Multi-day events: remind(1), "MULTI-DAY EVENTS".
- **AT time [tdelta] [trepeat]**: time as 24-hour (`17:00`, `0:00` is midnight) or AM/PM (`1:00PM`, `12:00am` is midnight). Colon or period separator. `tdelta` (`+n`) is minutes before the time; `trepeat` (`*n`) is minutes between repeats. The time itself always fires. There is no `+`/`++` distinction for tdelta.
- **Queueing**: a timed reminder whose trigger is today is queued for its time, unless `NOQUEUE` or `-q`. `-a` stops them being issued during script processing, but they are still queued. Queued reminders run in a forked background process unless `-f`.

### 3.7 TODOs (remind(1), "EVENTS AND TODOS" through "MORE DETAILS ABOUT TODOS")

- `REM TODO ...` marks a task. Agenda Mode keeps warning after the due date until marked done.
- Mark done: remove `TODO`, or for recurring tasks advance `COMPLETE-THROUGH`.
- `%:` in the body is " (done)" for a completed TODO (Calendar Mode).
- In Purge Mode, TODOs are not purged unless complete.

### 3.8 SATISFY (remind(1), "THE SATISFY CLAUSE")

Form: `REM trigger SATISFY expr`. Remind computes a trigger date as usual, sets `trigdate()` to it, and evaluates expr. If expr is zero or the null string, Remind computes the next trigger date and retests, up to the `-x` iteration limit (default 10000). If expr is never satisfied, `trigvalid()` is 0 and "Can't compute trigger" is issued; otherwise `trigvalid()` is 1. If expr is not constant and does not call `trigdate()` or related functions or system variables, Remind issues a warning. Example (remind(1), "TIMEZONE SUPPORT"): `REM Wednesday AT 23:59 TZ America/Los_Angeles SATISFY [$Td == 13] MSG Foo %b %2.`

### 3.9 Trigger examples worth knowing

- `REM 1 +1 OMIT Sat Sun MSG ...`: local omit; the `+1` does not count weekend days.
- `REM 1 -1 OMIT Sat Sun MSG Last working day of month`.
- `REM Fri ++1 AT 1:00PM MSG ...`: triggers Thursday and Friday, queued only Friday.

---

## 4. OMIT, DO, INCLUDE and related commands

### 4.1 The OMIT command (remind(1), "THE OMIT COMMAND")

Forms:

```
OMIT weekday [weekday...]
OMIT [day] month [year]
OMIT [day1] month1 [year1] THROUGH [day2] month2 [year2]
OMIT DUMP
```

- Global OMITs are skipped by `-` and `+` forms of back and delta, but not by `--` and `++`.
- `OMIT May` = `OMIT May 1 THROUGH May 31`.
- `THROUGH` ranges: either both sides have a year or neither does.
- `OMIT` may carry a delta and MSG or RUN: `OMIT 1 Jan +4 MSG New year's day is %b!` is equivalent to `OMIT 1 Jan` plus `REM 1 Jan +4 MSG ...`.
- A THROUGH OMIT with full dates may double as a REM: `OMIT 6 Sep 2010 THROUGH 10 Sep 2010 MSG Vacation`.
- Fully specified (year included) omitted days count against a compiled-in limit; overrun gives "Too many full OMITs".
- `OMIT DUMP` prints current global OMITs to stdout.

### 4.2 Local omits and the omit-related keywords (remind(1), "LOCALLY OMITTING WEEKDAYS", "THE BEFORE, AFTER AND SKIP KEYWORDS")

- Local `OMIT weekday...` in a REM affects only that REM's back/delta counting, and combines (union) with global weekday omits.
- `BEFORE`: move trigger before the omitted block.
- `AFTER`: move trigger after the omitted block (skips past holidays too).
- `SKIP`: no trigger on an omitted day; the next normal trigger still fires.

### 4.3 Context stack (remind(1), "CONTROLLING THE OMIT CONTEXT")

- `PUSH-OMIT-CONTEXT`: saves current global OMITs on a stack.
- `CLEAR-OMIT-CONTEXT`: clears global OMITs.
- `POP-OMIT-CONTEXT`: restores the most recent saved set.

The man page gives no stack depth limit. Debug flag `p` warns when POP-OMIT-CONTEXT, POP-VARS or POP-FUNCS does not match a PUSH in the same file (remind(1), "OPTIONS", `-d`).

### 4.4 DO, INCLUDE and SYSINCLUDE (remind(1), "THE DO, INCLUDE AND SYSINCLUDE COMMANDS")

- `INCLUDE file`: relative paths resolve against the **current working directory of the Remind process**, not the including file. Absolute paths work.
- `DO file`: relative paths resolve against the **directory containing the file currently being processed**. Absolute paths work. Documented example: from `/home/user/.reminders/foo.rem` with cwd `/home/user`, `DO bar.rem` reads `/home/user/.reminders/bar.rem`; `INCLUDE bar.rem` reads `/home/user/bar.rem`.
- `DO` fails if the processed file is a symlink to a file in another directory; Remind does not resolve real paths of symlinks.
- `SYSINCLUDE file`: like DO but relative paths resolve under the system directory, which the man page gives as `@prefix@/share/remind` (in this source tarball that is an unexpanded template). Use `$SysInclude` in scripts (remind(1), "FILES", "SYSTEM VARIABLES").
- `INCLUDE "name with spaces"` uses double quotes.
- `INCLUDE -` reads stdin.
- `INCLUDE dir` processes every `*.rem` in dir (not subdirectories), sorted.
- Nesting depth limit: 8. INCLUDECMD counts toward the same depth.
- Files and `INCLUDE`/`DO` targets are subject to the checks in section 7.

Whether `DO` accepts a directory is not stated (section 8).

### 4.5 Other commands

- `RETURN`: stop processing the current file (works at top level too).
- `RUN OFF` / `RUN ON`: disable/enable RUN and `shell()`. `RUN OFF` works at top level or in included files; `RUN ON` only at top level (remind(1), "THE RUN COMMAND").
- `EXPR OFF` / `EXPR ON`: disable/enable expression evaluation (top level only for ON). With EXPR OFF, expressions return an error (remind(1), "THE EXPR COMMAND").
- `INCLUDECMD command`: runs command via popen(3) (through the shell); its output is parsed as an included file. Stdin is /dev/null. Prefix command with `!` to disable RUN for its output. With RUN disabled, INCLUDECMD fails with "RUN disabled". Each identical command runs once per Remind run; output is cached (remind(1), "THE INCLUDECMD COMMAND").
- `BANNER format`: must come before REM commands (remind(1), "THE BANNER COMMAND").
- `PRESERVE var...`: keeps variables across calendar iterations (remind(1), "PRESERVING VARIABLES").
- `DEBUG [+flags] [-flags]`: flags `efhlmnpqstuvxz` (remind(1), "DEBUGGING REMINDER SCRIPTS").
- `DUMPVARS [-c] [var...]`, `ERRMSG body`, `EXIT [expr]`, `FLUSH`: see remind(1), "DEBUGGING REMINDER SCRIPTS". `ERRMSG` prints the substituted body to the error stream. `EXIT` discards queued timed reminders; the exit status is the INT expr, or 99 if none.

---

## 5. Substitution filter (remind(1), "THE SUBSTITUTION FILTER")

The body of a REM is scanned for `%` sequences. "All dates refer to the trigger date of the reminder." Lowercase letters a, b, c, e, f, g, h, i, j, k, l, u, v give "today" or "tomorrow" when the trigger is today or tomorrow.

| Seq | Replacement (per man page) |
|---|---|
| `%a` | "on weekday, day month, year" |
| `%b` | "in diff day's time", diff = actual days between today and trigger (OMITs have no effect) |
| `%c` | "on weekday" |
| `%d` | day of month |
| `%e` | "on dd-mm-yyyy" |
| `%f` | "on mm-dd-yyyy" |
| `%g` | "on weekday, day month" |
| `%h` | "on dd-mm" |
| `%i` | "on mm-dd" |
| `%j` | "on weekday, month day-th, year" (st/nd/rd/th) |
| `%k` | "on weekday, month day-th" |
| `%l` | "on yyyy-mm-dd" |
| `%m` | month name |
| `%n` | month number, 1 to 12 |
| `%o` | " (today)" only if the system date equals Remind's date (mainly for BANNER) |
| `%p` | "s" if diff is not 1 (`%x day%p to go`) |
| `%q` | "'s" if diff is 1, else "s'" |
| `%r` | day, two digits with leading zero |
| `%s` | "st", "nd", "rd" or "th" |
| `%t` | month number, two digits |
| `%u` | "on weekday, day-th month, year" |
| `%v` | "on weekday, day-th month" |
| `%w` | weekday name |
| `%x` | diff as a number; OMITs not counted (strict date subtraction) |
| `%y` | year |
| `%z` | last two digits of year |
| `%(text)` | translation-table lookup of text (same as `[_("text")]`) |
| `%<header>` | INFO value for header, or empty (same as `[triginfo("header")]`) |
| `%_` | newline |
| `%1` | "now", "m minutes from now", "m minutes ago", "h hours from now", "h hours ago", "h hours and m minutes from now/ago", with "d days," prefix if more than a day away |
| `%2` | "at hh:mmam" or "...pm" from the AT time |
| `%3` | "at hh:mm" 24-hour |
| `%4` | minutes between now and AT time (negative if AT earlier) |
| `%5` | absolute value of `%4` |
| `%6` | "ago" or "from now" |
| `%7` | hours between AT and now, 0 to 23 (days not counted) |
| `%8` | minutes after hours, 0 to 59 |
| `%9` | "s" if `%8` is not 1 |
| `%0` | "s" if `%7` is not 1 |
| `%!` | "is" if now is before trigger date and AT time, else "was" (dates only if not timed) |
| `%?` | "are" or "were" (same comparison as `%!`) |
| `%@` | like `%2` but for the current time |
| `%#` | like `%3` but for the current time |
| `%:` | " (done)" for a completed TODO (trigger on or after COMPLETE-THROUGH); empty otherwise |
| `%"` | removed; marks calendar text (`-c`, `-s`, `-p`) (see remind(1), "CALENDAR MODE") |
| `%%` | a literal `%` |
| `% ` | (percent then space) keeps a leading space in the body |

Notes from the man page:

- Blank line after each reminder, unless the body ends with `%`. Set `$AddBlankLines` to 0 to suppress globally.
- `a, c, e, f, g, h, i, j, k, l, u, v, 2, 3` may be preceded by `*` (e.g. `%*c`) to drop the "at"/"on" word.
- `!` and `?` may be preceded by `*` (`%*!`, `%*?`) to compare against `realtoday()` instead of `today()`.
- Time sequences (0 to 9) are undefined without an AT keyword. With a delta, time sequences ignore the date.
- Capital letters capitalize the first character of the result when it is lowercase.
- Other characters after `%` are copied as-is.
- Newlines (`%_`) become spaces in `-s`, `-n`, `-p` output and in rem2ps; preserved by the terminal calendar (`-c`) and rem2pdf (`-pp` or `-ppp`), rem2html (`-pp`).
- With `-p`, the `q` modifier disables the usual calendar-mode substitution filter and keeps `%"..%"` sequences in the output (remind(1), "OPTIONS", `-p`).

---

## 6. Errors, warnings and `-r`

### 6.1 What the man pages say about messages

- Messages go to standard error by default. `-e` diverts error messages to standard output (remind(1), "OPTIONS").
- `-v` echoes a bad line when an error occurs (remind(1), "OPTIONS").
- `-d l` echoes lines when displaying error messages (remind(1), "OPTIONS", `-d`).
- `-h` suppresses "certain warning and information messages"; the man page does not list which (remind(1), "OPTIONS").
- `--print-errs` prints all possible error messages in a form usable as a TRANSLATE argument. Translated messages must keep printf-style sequences in the same order (remind(1), "LONG OPTIONS").
- An error is reported at the **last line** of a backslash-continued reminder (remind(1), "REMINDER FILES").
- With `-l`, the `lineno` and `filename` keys (`-pp`) or `# fileinfo` lines (`-p`) identify the source of each reminder (rem2ps(1)).
- `$SuppressImplicitWarnings` (default 0) controls warnings for unknown leading tokens treated as REM and for missing REM type (remind(1), "SYSTEM VARIABLES").
- `$WarningLevel` (string AB.CD.EF) suppresses warnings added after that version (remind(1), "SYSTEM VARIABLES").
- `$MaxLineLength` (default 10485760 bytes): exceeding it "prints an error message and exits immediately" (remind(1), "SYSTEM VARIABLES").
- Documented message texts (quoted in the man page): "Missing REM type; assuming MSG"; "Can't compute trigger" (SATISFY failure); "Too many full OMITs"; "RUN disabled" (INCLUDECMD with RUN off).
- `catcherr()` returns error messages, in English (remind(1), "BUILT-IN FUNCTIONS").

### 6.2 Format

The man pages do **not** document the `file(line): message` format named in the task. There is no example of the stderr layout in remind(1) or rem2ps(1). Do not rely on that format without checking real output.

### 6.3 What `-r` disables

- RUN-type reminders are disabled, and `shell()` is disabled (remind(1), "OPTIONS", `-r`; "THE RUN COMMAND").
- `-k` commands still run (remind(1), "THE RUN COMMAND").
- `-r` does **not** disable `-k` (because `-k` overrides `-r`, remind(1), "OPTIONS", `-k`).
- `-u` implies `-r`, unless `-u+name`.
- Nothing in the man page says `-r` disables error reporting, INCLUDE, or other file reads.

---

## 7. File permission and ownership checks

From remind(1), "THE RUN COMMAND" (security paragraph) unless noted:

- Remind **will not read** a file that is group-writable or world-writable.
- Remind **will not run set-uid**.
- If Remind reads a file **you do not own**, it disables RUN and `shell()`.
- If Remind is **run as root**, it only reads files **owned by root**.
- Files read through standard input are not checked for ownership, so RUN and `shell()` are not disabled for stdin input.
- `-+username` trusts files owned by `username` (remind(1), "OPTIONS"). Up to 20 trusted users. Normally a file you do not own disables RUN and `shell()`.
- `-r`, `-u`, `RUN OFF` disable RUN regardless of ownership (see section 6.3).
- `$OnceFile` must be writable by the current user (remind(1), "SYSTEM VARIABLES").
- `-uname` changes uid/gid when run as root; non-root users only change environment variables (remind(1), "OPTIONS").

The man pages do not say whether the group/world-writable and set-uid checks apply to each included file or only the top-level file. The ownership rule is stated as "If it reads a file you don't own", without distinguishing included files. The DO symlink caveat is in section 4.4.

---

## 8. Things the man pages do not say, or say inconsistently

1. **Error format**: the `file(line): message` stderr format is not documented (section 6.2).
2. **Count for -p/-pp/-ppp**: no default n is given for these (section 1.6). `-c` defaults to one month.
3. **`-n` layout**: the output format is only "simple calendar format"; no field-level description.
4. **`-h` with `--json` or `-p`**: not stated.
5. **`--json` with no reminders**: `noreminders` object documented; the interaction with `-h` is not.
6. **Raw-body key name**: rem2ps(1) uses `rawbody`; remind(1) "AGENDA MODE JSON OUTPUT" says `raw_body`.
7. **`daysinmonnth`**: spelling as written in rem2ps(1), "REM2PS PURE JSON INPUT FORMAT". Treat that spelling as the documented key.
8. **`filename` and `lineno` presence**: rem2ps(1) lists them without a presence condition. The `-l` option is documented as the switch that adds file/line info for `-p`. Whether `-pp` always includes them is not stated.
9. **`is_todo`**: the man page says "flag will be the integer 1. Otherwise, zero". It does not explicitly say the key is always present.
10. **`plain_body`**: the presence condition is not stated.
11. **SATISFY body placement**: the syntax text says the body follows MSG/RUN/CAL/PS/PSFILE/SATISFY, while the examples place an expression and then the body keyword (`SATISFY [expr] MSG body`). Follow the examples.
12. **`DO` with directories**: not stated. Only INCLUDE is documented as accepting a directory.
13. **Remind's own exit status on errors**: only the `EXIT` command's status is documented (default 99).
14. **SYSINCLUDE path**: remind(1) gives `@prefix@/share/remind`, which is a build-time template in this source. The real path is the installed `$SysInclude`.
15. **Weekly calendars**: `-p+` and `-ppp+N`: remind(1) says only rem2pdf and rem2html support weekly layout. The synopsis allows `+n` with `-p`/`-ppp`; the docs do not describe rem2ps's behaviour for weekly data.
