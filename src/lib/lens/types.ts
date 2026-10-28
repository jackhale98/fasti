// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Shared types for the lens. The lens tokenizes, highlights, explains, patches
 * and parses quick-add words. It never works out when a reminder fires: dates
 * here are literals exactly as written in the file (no weekdays, no day
 * numbers), and every date Fasti shows comes from the engine.
 */

/** Role of a token in a line. `plain` is left unstyled. */
export type TokenRole =
	| 'cmd'
	| 'kw'
	| 'date'
	| 'wday'
	| 'num'
	| 'time'
	| 'str'
	| 'expr'
	| 'name'
	| 'body'
	| 'err'
	| 'plain';

/** A whitespace-separated word, "string" or [expression] of a logical line. */
export interface Token {
	text: string;
	/** Start and end (exclusive) offsets in the line's joined text. */
	s: number;
	e: number;
	/** Start and end (exclusive) offsets in the line's raw text. */
	rawStart: number;
	rawEnd: number;
	role: TokenRole;
}

/** A range in a line's raw text, for `%` substitution sequences. */
export interface Span {
	from: number;
	to: number;
}

/** A date written in a line. `d` is null only for "through the end of <month>" in an OMIT range. */
export interface DateLit {
	y: number;
	m: number;
	d: number | null;
}

/** A date clause: a literal, a `[expression]` for Remind to evaluate, or absent. */
export type DateClause = DateLit | 'expr' | null;

/** A possibly incomplete date as written after OMIT (`25 Dec`, `Dec 2026`). */
export interface PartialDate {
	y: number | null;
	m: number | null;
	d: number | null;
}

/** First/Second/Third/Fourth/Last, `~N`, Lastday and Lastworkday forms. */
export type Sugar =
	| { ord: number | 'last' }
	| { tilde: { n: number; double: boolean } }
	| { lastday: 'day' | 'work' };

/** A parsed REM (or OMIT-with-message). Holds what was written, nothing computed. */
export interface RemSpec {
	spec: { d: number | null; m: number | null; y: number | null; wd: number[] | null };
	back: number;
	backDouble: boolean;
	delta: number;
	deltaDouble: boolean;
	rep: number;
	todo: boolean;
	maxOverdue: number | null;
	complete: DateClause;
	prio: number;
	omitMode: 'SKIP' | 'BEFORE' | 'AFTER' | null;
	/** Weekdays from `OMIT Sat Sun` inside the REM, 0 = Sunday. */
	localWd: number[] | null;
	addomit: boolean;
	noqueue: boolean;
	once: boolean;
	/** AT time as minutes after midnight. */
	at: number | null;
	tdelta: number;
	trep: number;
	until: DateClause;
	through: DateClause;
	from: DateClause;
	/** DURATION in minutes. */
	duration: number | null;
	tags: string[];
	info: Record<string, string>;
	tz: string | null;
	/** The body keyword: MSG, MSF, FMT, RUN, CAL, PS, PSFILE, SPECIAL or SATISFY. */
	type: string | null;
	special: string | null;
	body: string;
	/** Offset of the body in the line's joined text. */
	bodyStart: number;
	sugar: Sugar | null;
	/** Constructs only Remind evaluates (`an expression`, SATISFY, OMITFUNC, WARN, SCHED). */
	engine: string[];
	/** True when the day itself is chosen by an expression, SATISFY or OMITFUNC. */
	engineWhen: boolean;
	/** True for the reminder carried by an `OMIT ... MSG` line. */
	fromOmit?: boolean;
}

/** A parsed OMIT command. */
export interface OmitSpec {
	dump: boolean;
	/** Weekdays for `OMIT Sat Sun`, 0 = Sunday. */
	weekdays: number[] | null;
	from: PartialDate | null;
	through: PartialDate | null;
	delta: number;
	deltaDouble: boolean;
	rem: RemSpec | null;
}

export type LineKind =
	'blank' | 'comment' | 'eof' | 'rem' | 'omit' | 'include' | 'ctx' | 'engine' | 'error';

/** One logical line: physical lines joined by backslash continuations. */
export interface LogicalLine {
	/** First and last physical line, zero-based. */
	start: number;
	end: number;
	/** Offset of the line's first character in the file text. */
	offset: number;
	/** The raw text, without the final line ending but with interior ones. */
	raw: string;
	/** The line's final line ending: "\n", "\r\n" or "" at the end of a file. */
	eol: string;
	/** Raw text with each backslash-newline removed, as Remind reads it. */
	joined: string;
	/** `map[i]` is the raw offset of `joined[i]`; the last entry is `raw.length`. */
	map: number[];
	kind: LineKind;
	tokens: Token[];
	/** Upper-cased first word. */
	cmd?: string;
	rem?: RemSpec | null;
	omit?: OmitSpec;
	/** DO / INCLUDE target. */
	target?: string;
	error?: string;
	/** Index of the token the error points at. */
	errorToken?: number;
	/** `%` sequences in the body, in raw offsets. */
	pct: Span[];
}

/** A highlighted run of a logical line's raw text. */
export interface Segment {
	from: number;
	to: number;
	role: TokenRole | 'comment' | 'pct';
}

/** A problem to show in the editor, in file offsets. */
export interface Diagnostic {
	line: number;
	from: number;
	to: number;
	message: string;
}

/** A single text change: replace [from, to) with `insert`. */
export interface Edit {
	from: number;
	to: number;
	insert: string;
}

/** The result of a patch: the new text, the change, and the change that undoes it. */
export interface PatchResult {
	text: string;
	/** In the coordinates of the old text. */
	edit: Edit;
	/** In the coordinates of the new text; applying it restores the old bytes. */
	inverse: Edit;
}

/** A regular-expression match whose numbered groups are typed as strings. */
export interface Match {
	0: string;
	1: string;
	2: string;
	3: string;
	4: string;
	5: string;
	6: string;
	index: number;
}
