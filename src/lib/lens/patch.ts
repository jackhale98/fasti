// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Byte-exact text patches. Every function returns the new text plus the
 * minimal edit and its inverse; only the touched range changes. Line endings
 * (LF, CRLF, mixed), a missing final newline, continuations and unknown syntax
 * survive. Lines are physical lines numbered from zero, split on "\n" exactly
 * like the prototype (so "a\n" has two lines, the second empty).
 *
 * The date for markDone comes from the caller (the engine); this module only
 * writes it.
 */
import { BODY_KW, analyze, lineAt, physicalLines } from './tokenize';
import type { Edit, PatchResult } from './types';

/** Apply an edit to a text. */
export function applyEdit(text: string, edit: Edit): string {
	return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** The file's own line ending: that of its first line break, or "\n". */
export function detectEol(text: string): '\n' | '\r\n' {
	const nl = text.indexOf('\n');
	return nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
}

/** Number of physical lines (a text always has at least one). */
export function lineCount(text: string): number {
	return physicalLines(text).length;
}

/** Physical lines `start`..`end` (inclusive) joined with "\n", without their line endings. */
export function getLines(text: string, start: number, end = start): string {
	const P = physicalLines(text);
	check(P.length, start, end);
	return P.slice(start, end + 1)
		.map((p) => text.slice(p.start, p.end))
		.join('\n');
}

function check(n: number, start: number, end: number): void {
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= n)
		throw new RangeError(`Lines ${start}..${end} are outside a ${n}-line text`);
}

/** Build a result from a replacement of [from, to), trimmed to the smallest change. */
function make(text: string, from: number, to: number, insert: string): PatchResult {
	const old = text.slice(from, to);
	const max = Math.min(old.length, insert.length);
	let p = 0;
	while (p < max && old[p] === insert[p]) p++;
	let s = 0;
	while (s < max - p && old[old.length - 1 - s] === insert[insert.length - 1 - s]) s++;
	const f = from + p;
	const t = to - s;
	const ins = insert.slice(p, insert.length - s);
	return {
		text: text.slice(0, f) + ins + text.slice(t),
		edit: { from: f, to: t, insert: ins },
		inverse: { from: f, to: f + ins.length, insert: text.slice(f, t) }
	};
}

/** Join new lines with line endings: reuse `eols` in order, then `fallback`. */
function joinWith(newText: string, eols: string[], fallback: string): string {
	return newText
		.split(/\r?\n/)
		.map((part, i, a) => (i < a.length - 1 ? part + (eols[i] ?? fallback) : part))
		.join('');
}

/**
 * Replace physical lines `start`..`end` with `newText` (which may hold several
 * lines separated by "\n"), or delete them when `newText` is null. The last
 * replaced line keeps its own line ending.
 */
export function replaceLines(
	text: string,
	start: number,
	end: number,
	newText: string | null
): PatchResult {
	const P = physicalLines(text);
	check(P.length, start, end);
	if (newText == null) {
		if (end + 1 < P.length) return make(text, P[start]!.start, P[end + 1]!.start, '');
		if (start > 0) return make(text, P[start - 1]!.end, text.length, '');
		return make(text, 0, text.length, '');
	}
	const eols = P.slice(start, end).map((p) => p.eol);
	return make(text, P[start]!.start, P[end]!.end, joinWith(newText, eols, detectEol(text)));
}

/** Delete physical lines `start`..`end`. */
export const deleteLines = (text: string, start: number, end = start): PatchResult =>
	replaceLines(text, start, end, null);

/** Insert `newText` as new lines before physical line `at` (0..lineCount; lineCount appends). */
export function insertLines(text: string, at: number, newText: string): PatchResult {
	const P = physicalLines(text);
	if (!Number.isInteger(at) || at < 0 || at > P.length)
		throw new RangeError(`Cannot insert at line ${at} of a ${P.length}-line text`);
	const eol = detectEol(text);
	const body = joinWith(newText, [], eol);
	if (at < P.length) return make(text, P[at]!.start, P[at]!.start, body + eol);
	return make(text, text.length, text.length, eol + body);
}

/**
 * Append `newText` as new lines at the end. A file that ended with a newline
 * still does; one that did not still does not.
 */
export function appendLines(text: string, newText: string): PatchResult {
	const eol = detectEol(text);
	const body = joinWith(newText, [], eol);
	if (text === '' || text.endsWith('\n')) return make(text, text.length, text.length, body + eol);
	return make(text, text.length, text.length, eol + body);
}

/** `y-m-d` for a date the engine gave. */
export type IsoDate = string | { y: number; m: number; d: number };

function isoText(date: IsoDate): string {
	if (typeof date === 'string') {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Not a yyyy-mm-dd date: ${date}`);
		return date;
	}
	const p2 = (v: number) => String(v).padStart(2, '0');
	return `${date.y}-${p2(date.m)}-${p2(date.d)}`;
}

/**
 * Mark the REM on the logical line containing physical line `line` as done
 * through `date`. Inserts `COMPLETE-THROUGH <date> ` just before the body
 * keyword, or rewrites the date after an existing COMPLETE-THROUGH in place
 * (including `15 Aug 2025` spread over several words). Returns null when the
 * line is not a TODO REM (COMPLETE-THROUGH is an error on anything else), has
 * no body keyword, or its date is an expression.
 */
export function markDone(text: string, line: number, date: IsoDate): PatchResult | null {
	const iso = isoText(date);
	const L = lineAt(analyze(text), line);
	if (!L || !L.rem || !L.rem.todo) return null;
	const body = L.rem.bodyStart;
	const toks = L.tokens;
	const at = toks.findIndex(
		(t) => t.s < body && t.role === 'kw' && /^COMPLETED?-THROUGH$/i.test(t.text)
	);
	if (at >= 0) {
		const first = toks[at + 1];
		if (!first || first.role !== 'date') {
			if (first?.role === 'expr') return null;
			const pos = L.offset + toks[at]!.rawEnd;
			return make(text, pos, pos, ' ' + iso);
		}
		let last = first;
		// An ISO date is one word; `15 Aug 2025` is up to three.
		const single = /^\d{4}[-/]/.test(first.text);
		for (let k = at + 2; !single && toks[k] && toks[k]!.role === 'date' && toks[k]!.s < body; k++)
			last = toks[k]!;
		return make(text, L.offset + first.rawStart, L.offset + last.rawEnd, iso);
	}
	const kw = toks.find((t) => t.role === 'kw' && t.s < body && BODY_KW.has(t.text.toUpperCase()));
	if (!kw) return null;
	const pos = L.offset + kw.rawStart;
	return make(text, pos, pos, `COMPLETE-THROUGH ${iso} `);
}
