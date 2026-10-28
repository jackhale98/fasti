// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Shared types between the vault store (src/lib/store) and the engine
 * (src/lib/engine). The store produces a VaultSnapshot; the engine writes it
 * into MEMFS under /vault/ and runs Remind on it. Engine output types are
 * added below by the engine client (docs/engine.md has the JSON shapes).
 */

/** A vault-relative path with forward slashes and no leading slash, e.g. `holidays/us.rem`. */
export type VaultPath = string;

/** The text Remind reads: every file in the vault, exactly as stored (bytes decoded as UTF-8). */
export interface VaultSnapshot {
	/**
	 * The main entry Remind is pointed at: a file (`reminders.rem`) or a
	 * directory (`''` for the vault root, or `dir`) whose `*.rem` files Remind
	 * reads in sorted order.
	 */
	main: VaultPath;
	/** Every file, keyed by path. Directories are implied by the paths. */
	files: Readonly<Record<VaultPath, string>>;
	/**
	 * A content hash of `main` and `files` (the store keeps it current), used
	 * to key cached engine results. Any stable hex digest.
	 */
	hash: string;
}

/* ------------------------------------------------------------------------ */
/* Engine output (src/lib/engine/parse-json.ts). Every date and time below   */
/* comes from Remind; the TypeScript side never computes one.                */
/* ------------------------------------------------------------------------ */

/** A date as Remind prints it: `YYYY-MM-DD`. */
export type IsoDate = string;

/** Minutes after midnight (0–1439), as Remind's `time` keys give them. */
export type Minutes = number;

/** A message Remind wrote to stderr, deduplicated. */
export interface Diagnostic {
	/** Vault-relative file, or null when the message names no file in the vault. */
	file: VaultPath | null;
	/** 1-based line, or null when `file` is null. */
	line: number | null;
	/** The text after `file(line): `, with indented follow-up lines joined by `\n`. */
	message: string;
	/** True for `Warning: …` messages. */
	warning: boolean;
}

/** A reminder as both agenda and calendar output describe it. */
export interface ReminderEntry {
	/** The trigger date (agenda: before or after the requested day for TODOs and `+N` warnings). */
	date: IsoDate;
	/** Vault-relative file the reminder is in. */
	file: VaultPath;
	/** First physical line of the reminder (before `lineEnd` for `\` continuations). */
	line: number;
	/** Last physical line (Remind's `lineno`). */
	lineEnd: number;
	/** Fully substituted body (calendar: the `%"…%"` text when present). */
	body: string;
	/** The body before substitution, when Remind reports it (`rawbody`). */
	rawBody: string | null;
	/** `AT` time, or null for an untimed reminder. */
	time: Minutes | null;
	/** `DURATION` in minutes, or null. */
	duration: number | null;
	/** Start of the event (`eventstart`), or null when untimed. */
	eventStart: { date: IsoDate; time: Minutes } | null;
	priority: number;
	isTodo: boolean;
	/** `COMPLETE-THROUGH` date, or null. */
	completeThrough: IsoDate | null;
	/**
	 * A TODO occurrence on or before its `COMPLETE-THROUGH` date: a string
	 * comparison of two dates Remind printed, not date arithmetic.
	 */
	completed: boolean;
	/** `TAG`s, in order. */
	tags: string[];
	/** `INFO` headers; Remind lower-cases the keys. */
	info: Record<string, string>;
	/** `SPECIAL` type (`COLOR`, `SHADE`, …), or null for MSG, MSF and CAL. */
	special: string | null;
	/** Red, green and blue of a `COLOR` reminder, or null. */
	color: { r: number; g: number; b: number } | null;
	/** `+N` (positive) or `++N` (negative) advance warning, or null. */
	delta: number | null;
	/** The reminder's `TZ`, or null. */
	tz: string | null;
	/** Every key Remind printed, untouched, for anything the fields above leave out. */
	raw: Readonly<Record<string, unknown>>;
}

/** The agenda for one day (`remind -r --json`). */
export interface AgendaResult {
	/** Remind's banner ("Reminders for Thursday, 5th November, 2026:"), or null. */
	banner: string | null;
	entries: ReminderEntry[];
	diagnostics: Diagnostic[];
}

/**
 * Why a day is omitted, in the OMIT context in force at the end of the main
 * file: `weekly` when its weekday is a global weekday OMIT (`OMIT Sat Sun`),
 * `dated` when only a dated OMIT covers it (`OMIT 25 Dec`, `ADDOMIT`, …). A
 * dated holiday on a weekly day off reports `weekly`.
 */
export type OmitKind = 'weekly' | 'dated';

/** One day of a calendar month. */
export interface CalendarDay {
	date: IsoDate;
	/** Day of the month, 1-based. */
	day: number;
	/** Weekday, 0 = Sunday (carried on from Remind's `firstwkday`). */
	weekday: number;
	omit: OmitKind | null;
	/** The day's entries, in Remind's order. */
	entries: ReminderEntry[];
}

/** A neighbouring month, as the monthly descriptor names it. */
export interface MonthRef {
	name: string;
	year: number;
	days: number;
}

/** One month of `remind -r -ppp1`, with omitted days. */
export interface CalendarMonth {
	/** `YYYY-MM`. */
	month: string;
	year: number;
	/** 1–12. */
	monthNumber: number;
	monthName: string;
	daysInMonth: number;
	/** Weekday of the 1st, 0 = Sunday. */
	firstWeekday: number;
	mondayFirst: boolean;
	/** Weekday names, Sunday first even with `mondayFirst` (as Remind gives them; index by `weekday`). */
	dayNames: string[];
	prev: MonthRef;
	next: MonthRef;
	days: CalendarDay[];
}

/** Several months, each from its own run. */
export interface CalendarResult {
	months: CalendarMonth[];
	/** Diagnostics of all the runs, deduplicated. */
	diagnostics: Diagnostic[];
}

/** One trigger of a single line. */
export interface Occurrence {
	date: IsoDate;
	/** `AT` time in the requested zone, or null. */
	time: Minutes | null;
}

/** The next dates of one line, from Remind with the line in its real context. */
export interface NextDatesResult {
	dates: Occurrence[];
	/** False when Remind never reached the line (nothing includes the file, a false IF, after `__EOF__`). */
	reached: boolean;
	/** Diagnostics for the line itself. */
	diagnostics: Diagnostic[];
}

/** A live preview of an edited line: its next dates with the new text in place. */
export type PreviewResult = NextDatesResult;

/** Remind's `today()` and `now()` in the requested zone. */
export interface EngineNow {
	date: IsoDate;
	time: Minutes;
}
