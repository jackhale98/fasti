// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	appendLines,
	applyEdit,
	deleteLines,
	detectEol,
	getLines,
	insertLines,
	lineCount,
	markDone,
	replaceLines
} from '../../src/lib/lens/patch';
import type { PatchResult } from '../../src/lib/lens/types';

const LF = 'REM Mon MSG a\n# keep   me \nREM Tue MSG b\n';
const CRLF = LF.replace(/\n/g, '\r\n');
const NOEOL = 'REM Mon MSG a\n# keep   me \nREM Tue MSG b';

function roundTrip(text: string, r: PatchResult) {
	expect(applyEdit(text, r.edit)).toBe(r.text);
	expect(applyEdit(r.text, r.inverse)).toBe(text);
}

describe('replaceLines', () => {
	it('changes only the touched line', () => {
		const r = replaceLines(LF, 2, 2, 'REM Wed MSG B');
		expect(r.text).toBe('REM Mon MSG a\n# keep   me \nREM Wed MSG B\n');
		expect(r.edit).toEqual({ from: 31, to: 40, insert: 'Wed MSG B' });
		roundTrip(LF, r);
	});

	it('keeps CRLF and the last line ending', () => {
		const r = replaceLines(CRLF, 0, 0, 'REM Fri MSG a');
		expect(r.text).toBe('REM Fri MSG a\r\n# keep   me \r\nREM Tue MSG b\r\n');
		roundTrip(CRLF, r);
	});

	it('converts new line breaks to the file ending', () => {
		const r = replaceLines(CRLF, 1, 1, '# one\n# two');
		expect(r.text).toBe('REM Mon MSG a\r\n# one\r\n# two\r\nREM Tue MSG b\r\n');
		roundTrip(CRLF, r);
	});

	it('does not add a final newline to a file without one', () => {
		const r = replaceLines(NOEOL, 2, 2, 'REM Tue MSG changed');
		expect(r.text.endsWith('changed')).toBe(true);
		expect(r.text.endsWith('\n')).toBe(false);
		roundTrip(NOEOL, r);
	});

	it('a no-op patch changes nothing', () => {
		for (const t of [LF, CRLF, NOEOL, '', '\n', 'a\r\nb\nc']) {
			const n = lineCount(t);
			const r = replaceLines(t, 0, n - 1, getLines(t, 0, n - 1));
			expect(r.text).toBe(t);
			expect(r.edit.from).toBe(r.edit.to);
			expect(r.edit.insert).toBe('');
		}
	});

	it('replaces a multi-line range, keeping continuations elsewhere', () => {
		const text = 'REM Mon \\\n  MSG a\nREM Tue MSG b\n';
		const r = replaceLines(text, 0, 1, 'REM Mon MSG a');
		expect(r.text).toBe('REM Mon MSG a\nREM Tue MSG b\n');
		roundTrip(text, r);
	});

	it('leaves unknown syntax and odd bytes alone', () => {
		const text = 'weird ☃ \t\rstuff\nREM Mon MSG a\n[x\n';
		const r = replaceLines(text, 1, 1, 'REM Tue MSG a');
		expect(r.text).toBe('weird ☃ \t\rstuff\nREM Tue MSG a\n[x\n');
	});

	it('rejects lines outside the file', () => {
		expect(() => replaceLines(LF, 5, 5, 'x')).toThrow(RangeError);
		expect(() => replaceLines(LF, 2, 1, 'x')).toThrow(RangeError);
	});
});

describe('deleteLines', () => {
	it('removes a line with its line ending', () => {
		const r = deleteLines(LF, 1);
		expect(r.text).toBe('REM Mon MSG a\nREM Tue MSG b\n');
		roundTrip(LF, r);
	});

	it('deleting the last line of a file without final newline drops the break before it', () => {
		const r = deleteLines(NOEOL, 2);
		expect(r.text).toBe('REM Mon MSG a\n# keep   me ');
		roundTrip(NOEOL, r);
	});

	it('deletes under CRLF', () => {
		const r = deleteLines(CRLF, 0, 1);
		expect(r.text).toBe('REM Tue MSG b\r\n');
		roundTrip(CRLF, r);
	});

	it('deleting everything leaves an empty file', () => {
		expect(deleteLines('a', 0).text).toBe('');
		expect(deleteLines('a\n', 0, 1).text).toBe('');
	});
});

describe('insertLines and appendLines', () => {
	it('inserts before a line using the file ending', () => {
		const r = insertLines(CRLF, 1, 'REM Sat MSG new');
		expect(r.text).toBe('REM Mon MSG a\r\nREM Sat MSG new\r\n# keep   me \r\nREM Tue MSG b\r\n');
		roundTrip(CRLF, r);
	});

	it('inserting at the end of a file without final newline keeps it without one', () => {
		const r = insertLines(NOEOL, 3, 'REM Sun MSG z');
		expect(r.text).toBe(NOEOL + '\nREM Sun MSG z');
		roundTrip(NOEOL, r);
	});

	it('appends to LF and CRLF files, preserving the final newline state', () => {
		expect(appendLines(LF, 'REM X MSG x').text).toBe(LF + 'REM X MSG x\n');
		expect(appendLines(CRLF, 'REM X MSG x').text).toBe(CRLF + 'REM X MSG x\r\n');
		expect(appendLines(NOEOL, 'REM X MSG x').text).toBe(NOEOL + '\nREM X MSG x');
		expect(appendLines('', 'REM X MSG x').text).toBe('REM X MSG x\n');
		for (const t of [LF, CRLF, NOEOL, '']) roundTrip(t, appendLines(t, 'REM X MSG x'));
	});

	it('detects the line ending from the first break', () => {
		expect(detectEol('a\r\nb\n')).toBe('\r\n');
		expect(detectEol('a\nb\r\n')).toBe('\n');
		expect(detectEol('abc')).toBe('\n');
	});
});

describe('markDone', () => {
	const todo = 'REM TODO Sun +2 MSG Water the plants %b\n';

	it('inserts COMPLETE-THROUGH just before the body keyword', () => {
		const r = markDone(todo, 0, '2026-10-25')!;
		expect(r.text).toBe('REM TODO Sun +2 COMPLETE-THROUGH 2026-10-25 MSG Water the plants %b\n');
		expect(r.edit).toEqual({ from: 16, to: 16, insert: 'COMPLETE-THROUGH 2026-10-25 ' });
		roundTrip(todo, r);
	});

	it('updates an ISO date in place', () => {
		const t = 'REM TODO 15 ++5 COMPLETE-THROUGH 2026-09-15 MSG Pay %b\n';
		const r = markDone(t, 0, '2026-10-15')!;
		expect(r.text).toBe('REM TODO 15 ++5 COMPLETE-THROUGH 2026-10-15 MSG Pay %b\n');
		expect(r.edit.insert).toBe('10');
		roundTrip(t, r);
	});

	it('updates a multi-token date in place', () => {
		const t = 'REM TODO 30 Apr COMPLETE-THROUGH 15 Aug 2025 MSG File taxes\n';
		const r = markDone(t, 0, '2026-04-30')!;
		expect(r.text).toBe('REM TODO 30 Apr COMPLETE-THROUGH 2026-04-30 MSG File taxes\n');
		roundTrip(t, r);
	});

	it('accepts COMPLETED-THROUGH and a {y, m, d} date', () => {
		const t = 'REM TODO Mon completed-through 2026-01-01 MSG x';
		expect(markDone(t, 0, { y: 2026, m: 2, d: 3 })!.text).toBe(
			'REM TODO Mon completed-through 2026-02-03 MSG x'
		);
	});

	it('works across a continuation and CRLF', () => {
		const t =
			'# top\r\nREM TODO 2026-10-20 +3 INFO "Location: Elm" \\\r\n    MSG Dentist %b\r\nREM Mon MSG z\r\n';
		const r = markDone(t, 2, '2026-10-27')!;
		expect(r.text).toBe(
			'# top\r\nREM TODO 2026-10-20 +3 INFO "Location: Elm" \\\r\n    COMPLETE-THROUGH 2026-10-27 MSG Dentist %b\r\nREM Mon MSG z\r\n'
		);
		roundTrip(t, r);
		// the same date again changes nothing
		const again = markDone(r.text, 1, '2026-10-27')!;
		expect(again.text).toBe(r.text);
		expect(again.edit.insert).toBe('');
	});

	it('updates a date that follows a continuation break', () => {
		const t = 'REM TODO Mon COMPLETE-THROUGH \\\n  2026-01-01 \\\n  MSG x';
		const r = markDone(t, 0, '2026-02-02')!;
		expect(r.text).toBe('REM TODO Mon COMPLETE-THROUGH \\\n  2026-02-02 \\\n  MSG x');
	});

	it('ignores COMPLETE-THROUGH written inside the message', () => {
		const t = 'REM TODO Mon MSG see COMPLETE-THROUGH 2020-01-01';
		const r = markDone(t, 0, '2026-02-02')!;
		expect(r.text).toBe(
			'REM TODO Mon COMPLETE-THROUGH 2026-02-02 MSG see COMPLETE-THROUGH 2020-01-01'
		);
	});

	it('leaves other lines byte for byte', () => {
		const t = '#  a  \n\nREM TODO Mon MSG x\t\nREM Tue  MSG   y';
		const r = markDone(t, 2, '2026-02-02')!;
		expect(r.text.startsWith('#  a  \n\nREM TODO Mon COMPLETE-THROUGH 2026-02-02 MSG x\t\n')).toBe(
			true
		);
		expect(r.text.endsWith('REM Tue  MSG   y')).toBe(true);
	});

	it('returns null when it cannot patch', () => {
		expect(markDone('# comment\n', 0, '2026-01-01')).toBeNull();
		expect(markDone('REM Mon bogus\n', 0, '2026-01-01')).toBeNull();
		expect(markDone('REM Mon MSG not a todo\n', 0, '2026-01-01')).toBeNull();
		expect(markDone('REM TODO Mon COMPLETE-THROUGH [x] MSG y', 0, '2026-01-01')).toBeNull();
		expect(markDone('REM Mon MSG y', 7, '2026-01-01')).toBeNull();
	});

	it('rejects a malformed date', () => {
		expect(() => markDone(todo, 0, 'tomorrow')).toThrow(RangeError);
	});
});
