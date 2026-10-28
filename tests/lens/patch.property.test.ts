// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	appendLines,
	applyEdit,
	deleteLines,
	getLines,
	insertLines,
	lineCount,
	markDone,
	replaceLines
} from '../../src/lib/lens/patch';
import { analyze, physicalLines } from '../../src/lib/lens/tokenize';
import type { PatchResult } from '../../src/lib/lens/types';

const snippet = fc.constantFrom(
	'REM Mon MSG stand-up',
	'REM TODO Sun +2 MSG Water the plants %b',
	'REM TODO 15 ++5 COMPLETE-THROUGH 2026-09-15 MSG Pay card %b',
	'REM TODO 30 Apr COMPLETE-THROUGH 15 Aug 2025 MSG File taxes',
	'REM TODO COMPLETE-THROUGH 15 Aug 2025 1 Sep 2025 *7 MSG x',
	'REM TODO COMPLETE-THROUGH 15 Aug 2025 Last Fri MSG x',
	'REM TODO COMPLETE-THROUGH 2025-08-15 2026-01-01 *7 MSG x',
	'REM TODO COMPLETE-THROUGH 15 \\',
	'  Aug 2025 \\',
	'  Lastday MSG x',
	'REM 2026-10-28 AT 15:30 INFO "Location: Elm" \\',
	'    MSG Dentist %b',
	'REM Mon \\',
	'  \\',
	'OMIT Sat Sun',
	'DO holidays.rem',
	'# comment   with  spaces ',
	'; other',
	'',
	'   ',
	'weird ☃ \t unknown syntax [',
	'REM bogus',
	'MSG\r stray cr',
	'trailing backslash \\\\',
	'REM 13 SATISFY [$Tw == 5] MSG Friday the 13th'
);

const eolStyle = fc.constantFrom('lf', 'crlf', 'mixed');

const fileArb = fc
	.record({
		lines: fc.array(snippet, { maxLength: 8 }),
		style: eolStyle,
		finalNewline: fc.boolean(),
		picks: fc.array(fc.boolean(), { maxLength: 9, minLength: 9 })
	})
	.map(({ lines, style, finalNewline, picks }) => {
		let out = '';
		lines.forEach((l, i) => {
			const crlf = style === 'crlf' || (style === 'mixed' && picks[i]);
			out += l;
			if (i < lines.length - 1 || finalNewline) out += crlf ? '\r\n' : '\n';
		});
		return out;
	});

const newTextArb = fc
	.array(fc.oneof(snippet, fc.string({ maxLength: 12 })), { minLength: 1, maxLength: 3 })
	.map((a) => a.join('\n'));

const isoArb = fc
	.record({
		y: fc.integer({ min: 1990, max: 2075 }),
		m: fc.integer({ min: 1, max: 12 }),
		d: fc.integer({ min: 1, max: 28 })
	})
	.map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

type Op =
	| { op: 'replace'; a: number; b: number; text: string }
	| { op: 'delete'; a: number; b: number }
	| { op: 'insert'; a: number; text: string }
	| { op: 'append'; text: string }
	| { op: 'done'; a: number; date: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
	fc.record({ op: fc.constant('replace' as const), a: fc.nat(10), b: fc.nat(3), text: newTextArb }),
	fc.record({ op: fc.constant('delete' as const), a: fc.nat(10), b: fc.nat(3) }),
	fc.record({ op: fc.constant('insert' as const), a: fc.nat(10), text: newTextArb }),
	fc.record({ op: fc.constant('append' as const), text: newTextArb }),
	fc.record({ op: fc.constant('done' as const), a: fc.nat(10), date: isoArb })
);

function run(text: string, o: Op): PatchResult | null {
	const n = lineCount(text);
	switch (o.op) {
		case 'replace': {
			const a = o.a % n;
			return replaceLines(text, a, Math.min(n - 1, a + o.b), o.text);
		}
		case 'delete': {
			const a = o.a % n;
			return deleteLines(text, a, Math.min(n - 1, a + o.b));
		}
		case 'insert':
			return insertLines(text, o.a % (n + 1), o.text);
		case 'append':
			return appendLines(text, o.text);
		case 'done':
			return markDone(text, o.a % n, o.date);
	}
}

describe('patch properties', () => {
	it('a random edit then its inverse restores identical bytes', () => {
		fc.assert(
			fc.property(fileArb, opArb, (text, o) => {
				const r = run(text, o);
				if (!r) return;
				expect(applyEdit(text, r.edit)).toBe(r.text);
				expect(applyEdit(r.text, r.inverse)).toBe(text);
			}),
			{ numRuns: 1000 }
		);
	});

	it('a chain of edits undone in reverse restores the original', () => {
		fc.assert(
			fc.property(fileArb, fc.array(opArb, { minLength: 1, maxLength: 6 }), (text, ops) => {
				let cur = text;
				const inverses = [];
				for (const o of ops) {
					const r = run(cur, o);
					if (!r) continue;
					inverses.push(r.inverse);
					cur = r.text;
				}
				for (const inv of inverses.reverse()) cur = applyEdit(cur, inv);
				expect(cur).toBe(text);
			}),
			{ numRuns: 500 }
		);
	});

	it('only the touched range changes', () => {
		fc.assert(
			fc.property(fileArb, opArb, (text, o) => {
				const r = run(text, o);
				if (!r) return;
				const { from, to, insert } = r.edit;
				expect(r.text.slice(0, from)).toBe(text.slice(0, from));
				expect(r.text.slice(from + insert.length)).toBe(text.slice(to));
				// minimal: the edit does not begin or end with bytes it leaves unchanged
				const old = text.slice(from, to);
				if (old && insert) {
					expect(old[0] === insert[0] && old.length > 0 && insert.length > 0).toBe(false);
					expect(old[old.length - 1] === insert[insert.length - 1]).toBe(false);
				}
			}),
			{ numRuns: 1000 }
		);
	});

	it('line patches stay inside their lines', () => {
		fc.assert(
			fc.property(fileArb, fc.nat(10), fc.nat(3), newTextArb, (text, a0, b0, newText) => {
				const P = physicalLines(text);
				const a = a0 % P.length;
				const b = Math.min(P.length - 1, a + b0);
				const r = replaceLines(text, a, b, newText);
				expect(r.edit.from).toBeGreaterThanOrEqual(P[a]!.start);
				expect(r.edit.to).toBeLessThanOrEqual(P[b]!.end);
			}),
			{ numRuns: 500 }
		);
	});

	it('a no-op patch never changes bytes', () => {
		fc.assert(
			fc.property(fileArb, fc.nat(10), fc.nat(3), (text, a0, b0) => {
				const n = lineCount(text);
				const a = a0 % n;
				const b = Math.min(n - 1, a + b0);
				const r = replaceLines(text, a, b, getLines(text, a, b));
				expect(r.text).toBe(text);
				expect(r.edit.from).toBe(r.edit.to);
				expect(r.edit.insert).toBe('');
				expect(r.inverse.insert).toBe('');
			}),
			{ numRuns: 1000 }
		);
	});

	it('marking done twice with the same date is a no-op the second time', () => {
		fc.assert(
			fc.property(fileArb, fc.nat(10), isoArb, (text, a0, date) => {
				const a = a0 % lineCount(text);
				const first = markDone(text, a, date);
				if (!first) return;
				const second = markDone(first.text, a, date);
				expect(second).not.toBeNull();
				expect(second!.text).toBe(first.text);
			}),
			{ numRuns: 500 }
		);
	});

	it('markDone keeps the line structure and a parsable line', () => {
		fc.assert(
			fc.property(fileArb, fc.nat(10), isoArb, (text, a0, date) => {
				const a = a0 % lineCount(text);
				const r = markDone(text, a, date);
				if (!r) return;
				expect(lineCount(r.text)).toBe(lineCount(text));
				const L = analyze(r.text).find((l) => a >= l.start && a <= l.end)!;
				expect(L.kind).toBe('rem');
				expect(L.rem!.complete).toEqual({
					y: +date.slice(0, 4),
					m: +date.slice(5, 7),
					d: +date.slice(8, 10)
				});
				// everything outside the logical line is untouched
				const before = analyze(text).find((l) => a >= l.start && a <= l.end)!;
				expect(r.text.slice(0, before.offset)).toBe(text.slice(0, before.offset));
				expect(r.text.endsWith(text.slice(before.offset + before.raw.length))).toBe(true);
			}),
			{ numRuns: 1000 }
		);
	});

	it('matches the prototype split/splice/join model on LF files', () => {
		const lfFile = fileArb.map((t) => t.replace(/\r\n/g, '\n'));
		fc.assert(
			fc.property(lfFile, fc.nat(10), fc.nat(3), newTextArb, (text, a0, b0, newText) => {
				const n = lineCount(text);
				const a = a0 % n;
				const b = Math.min(n - 1, a + b0);
				const P = text.split('\n');
				const proto = (...ins: string[]) => {
					const q = P.slice();
					q.splice(a, b - a + 1, ...ins);
					return q.join('\n');
				};
				expect(replaceLines(text, a, b, newText).text).toBe(proto(...newText.split('\n')));
				expect(deleteLines(text, a, b).text).toBe(proto());
				const q = P.slice();
				q.splice(a, 0, ...newText.split('\n'));
				expect(insertLines(text, a, newText).text).toBe(q.join('\n'));
			}),
			{ numRuns: 500 }
		);
	});
});
