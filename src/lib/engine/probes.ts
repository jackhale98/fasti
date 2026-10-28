// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Remind scripts Fasti generates to ask Remind things its normal output
 * doesn't say (docs/engine.md, "Probes"). They live in MEMFS under /fasti/,
 * outside the vault, or in a scratch copy of one vault file; the user's
 * files are never changed.
 */
import { DAY_PROBE, VAULT_DIR } from './parse-json.ts';

/** Directory for generated scripts, outside the vault. */
export const PROBE_DIR = '/fasti';

/** The path Remind is pointed at for a vault's main entry (a file or a directory). */
export function mainPath(main: string): string {
	return main ? `${VAULT_DIR}/${main}` : VAULT_DIR;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * `__fasti_weekly(x)` is true when x's weekday is a global weekday OMIT.
 *
 * remind(1) has no function for that, but `slide()` refuses with an error
 * when the global weekday OMITs and its local weekday arguments together
 * cover the whole week (funcs.c: "(WeekdayOmits | localomit) == 0x7F").
 * Passing the six other weekdays as local OMITs therefore fails exactly when
 * x's own weekday is globally omitted; `catch()` turns the error into 0. The
 * `choose()` picks the call for x's weekday.
 */
const WEEKLY_FN = `FSET __fasti_weekly(x) choose(wkdaynum(x) + 1, ${WEEKDAYS.map(
	(day) =>
		`catch(slide(x, 1, ${WEEKDAYS.filter((o) => o !== day)
			.map((o) => `"${o}"`)
			.join(', ')}), 0)`
).join(', ')}) == 0`;

/** Path of the calendar wrapper. */
export const CALENDAR_WRAPPER = `${PROBE_DIR}/calendar.rem`;

/**
 * The calendar wrapper: DOes the main entry, then adds one SPECIAL entry per
 * calendar day whose body is `<weekday 0-6> <weekly|dated|->`, evaluated in
 * the OMIT context in force at the end of the main entry. In calendar mode
 * Remind reruns the whole script for each day with `today()` set to that day
 * (remind(1), today()), so `isomitted(today())` asks about each day in turn.
 */
export function calendarWrapper(main: string): string {
	return [
		`DO ${mainPath(main)}`,
		WEEKLY_FN,
		`REM PRIORITY 0 SPECIAL ${DAY_PROBE} [wkdaynum(today())] [iif(isomitted(today()), iif(__fasti_weekly(today()), "weekly", "dated"), "-")]`,
		''
	].join('\n');
}

/** Path of the clock probe. */
export const NOW_PROBE = `${PROBE_DIR}/now.rem`;

/** Prefix of the probes' stderr lines. */
export const PROBE_MARK = 'FASTI-PROBE';

/** Matches the probes' own stderr lines, so diagnostics can skip them. */
export const PROBE_LINE = new RegExp(`^${PROBE_MARK} `);

/** Prints Remind's today() and now() on stderr. */
export const NOW_SCRIPT = [
	'SET $DateSep "-"',
	'SET $TimeSep ":"',
	`ERRMSG ${PROBE_MARK} [today()] [now()]`,
	''
].join('\n');

/**
 * A REM that sets trigvalid() to 0 without output or warnings (expired by
 * its UNTIL; the `*1` keeps Remind from warning that UNTIL is useless). It
 * goes just before the probed line, so a probed line that isn't a REM, or
 * fails, can't report the previous REM's trigger.
 */
const RESET = `REM 1990-01-01 *1 UNTIL 1990-01-01 SPECIAL ${PROBE_MARK}-RESET`;

/**
 * Right after the probed line: its trigger date and time (fixed separators,
 * so the user's $DateSep/$TimeSep don't matter this late) and the day after
 * it, computed by Remind, for the next run's "today". EXIT stops there, so
 * later lines cost nothing.
 */
const PROBE = [
	'SET $DateSep "-"',
	'SET $TimeSep ":"',
	`ERRMSG ${PROBE_MARK} [trigvalid()] [trigdate()] [trigtime()] [trigdate() + 1]`,
	'EXIT 0'
];

/** The physical lines of the logical line around `line` (1-based), as Remind's files.c joins them. */
export function logicalRange(
	lines: readonly string[],
	line: number
): { start: number; end: number } {
	const continues = (i: number) => (lines[i - 1] ?? '').endsWith('\\');
	let start = Math.max(1, Math.min(line, lines.length));
	while (start > 1 && continues(start - 1)) start--;
	let end = Math.max(start, Math.min(line, lines.length));
	while (end < lines.length && continues(end)) end++;
	return { start, end };
}

export interface ProbedFile {
	/** The scratch copy of the file. */
	text: string;
	/** Physical line numbers, in the copy, of the probed text. */
	first: number;
	last: number;
	/** Add to a line number in the copy to get the line in the original. */
	shift: number;
}

/**
 * A copy of `text` with the probe around the logical line containing `line`,
 * optionally replaced by `newText` (the live preview). Lines are split on
 * "\n" only, so CRs and continuations stay as they were.
 */
export function probeFile(text: string, line: number, newText?: string): ProbedFile {
	const lines = text.split('\n');
	const { start, end } = logicalRange(lines, line);
	const target = newText === undefined ? lines.slice(start - 1, end) : newText.split('\n');
	const copy = [...lines.slice(0, start - 1), RESET, ...target, ...PROBE, ''];
	return {
		text: copy.join('\n'),
		first: start + 1,
		last: start + target.length,
		shift: -1
	};
}

/** What one probe run reported, or null when Remind never reached the probe. */
export interface ProbeReport {
	valid: boolean;
	date: string;
	time: number | null;
	/** The day after `date`, from Remind. */
	next: string;
}

const REPORT = new RegExp(`^${PROBE_MARK} (\\d+) (\\S+) (\\S+) (\\S+)$`, 'm');

/** Finds the probe's line in stderr. */
export function parseProbeReport(stderr: string): ProbeReport | null {
	const m = REPORT.exec(stderr);
	if (!m) return null;
	const t = /^(\d{1,2}):(\d{2})$/.exec(m[3]!);
	return {
		valid: m[1] !== '0',
		date: m[2]!,
		time: t ? Number(t[1]) * 60 + Number(t[2]) : null,
		next: m[4]!
	};
}

const NOW = new RegExp(`^${PROBE_MARK} (\\d{4}-\\d{2}-\\d{2}) (\\d{1,2}):(\\d{2})$`, 'm');

/** Parses the clock probe's line. */
export function parseNow(stderr: string): { date: string; time: number } | null {
	const m = NOW.exec(stderr);
	return m ? { date: m[1]!, time: Number(m[2]) * 60 + Number(m[3]) } : null;
}
