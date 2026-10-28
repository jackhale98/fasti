// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { analyze, diagnostics, lineAt, logicalLines, segments } from '../../src/lib/lens/tokenize';

const one = (text: string) => analyze(text)[0]!;
const roles = (text: string) => one(text).tokens.map((t) => `${t.text}:${t.role}`);

describe('logical lines', () => {
	it('joins backslash continuations and maps back to raw offsets', () => {
		const text = 'REM 2026-10-28 \\\n    MSG Dentist\nREM Mon MSG x';
		const [a, b] = logicalLines(text);
		expect(a!.start).toBe(0);
		expect(a!.end).toBe(1);
		expect(a!.raw).toBe('REM 2026-10-28 \\\n    MSG Dentist');
		expect(a!.joined).toBe('REM 2026-10-28     MSG Dentist');
		expect(a!.eol).toBe('\n');
		for (let i = 0; i < a!.joined.length; i++) expect(a!.raw[a!.map[i]!]).toBe(a!.joined[i]);
		expect(a!.map[a!.map.length - 1]).toBe(a!.raw.length);
		expect(b!.start).toBe(2);
		expect(b!.offset).toBe(text.indexOf('REM Mon'));
	});

	it('handles CRLF continuations', () => {
		const text = 'REM 2026-10-28 \\\r\n  MSG hi\r\nREM Mon MSG x\r\n';
		const lines = logicalLines(text);
		expect(lines).toHaveLength(3);
		expect(lines[0]!.joined).toBe('REM 2026-10-28   MSG hi');
		expect(lines[0]!.eol).toBe('\r\n');
		expect(lines[1]!.raw).toBe('REM Mon MSG x');
		expect(lines[2]!.raw).toBe('');
		expect(lines[2]!.eol).toBe('');
	});

	it('an even run of backslashes is not a continuation', () => {
		expect(logicalLines('MSG a\\\\\nREM x')).toHaveLength(2);
		expect(logicalLines('MSG a\\\\\\\nREM x')).toHaveLength(1);
	});

	it('a continuation on the last line has nothing to join', () => {
		const lines = logicalLines('REM x \\');
		expect(lines).toHaveLength(1);
		expect(lines[0]!.raw).toBe('REM x \\');
	});

	it('token raw ranges survive a continuation in the middle of a word run', () => {
		const text = 'REM Mon \\\n  AT 9:30 \\\n  MSG hi';
		const L = one(text);
		expect(L.kind).toBe('rem');
		for (const t of L.tokens)
			expect(text.slice(L.offset + t.rawStart, L.offset + t.rawEnd)).toContain(t.text[0]);
		const at = L.tokens.find((t) => t.text === 'AT')!;
		expect(text.slice(at.rawStart, at.rawEnd)).toBe('AT');
		const time = L.tokens.find((t) => t.text === '9:30')!;
		expect(text.slice(time.rawStart, time.rawEnd)).toBe('9:30');
	});

	it('lineAt finds the logical line holding a physical line', () => {
		const lines = analyze('# c\nREM x \\\n MSG a\nREM y MSG b');
		expect(lineAt(lines, 2)!.start).toBe(1);
		expect(lineAt(lines, 3)!.start).toBe(3);
	});
});

describe('token roles', () => {
	it('assigns roles across a full REM', () => {
		expect(
			roles('REM TODO 2026-10-28 ++3 AT 9:30 DURATION 1:00 INFO "Location: X" MSG hi %b')
		).toEqual([
			'REM:cmd',
			'TODO:kw',
			'2026-10-28:date',
			'++3:num',
			'AT:kw',
			'9:30:time',
			'DURATION:kw',
			'1:00:time',
			'INFO:kw',
			'"Location: X":str',
			'MSG:kw',
			'hi:plain',
			'%b:plain'
		]);
	});

	it('weekday, month, ordinal and multi-token dates', () => {
		expect(roles('REM Mon Fri 15 Aug 2025 MSG x').slice(0, 6)).toEqual([
			'REM:cmd',
			'Mon:wday',
			'Fri:wday',
			'15:date',
			'Aug:date',
			'2025:date'
		]);
		expect(roles('REM Second Saturday MSG x').slice(0, 3)).toEqual([
			'REM:cmd',
			'Second:date',
			'Saturday:wday'
		]);
	});

	it('expressions and engine words', () => {
		const L = one('REM 13 SATISFY [$Tw == 5] MSG Friday');
		expect(L.kind).toBe('rem');
		expect(L.rem!.engine).toEqual(['SATISFY']);
		expect(L.rem!.engineWhen).toBe(true);
		const E = one('SET a [1+2]');
		expect(E.kind).toBe('engine');
		expect(E.tokens.map((t) => t.role)).toEqual(['cmd', 'plain', 'expr']);
		expect(one('REM AT [x] MSG y').rem!.engine).toEqual(['an expression']);
	});

	it('body starts after the keyword and finds % sequences', () => {
		const text = 'REM Mon MSG Hi %a and %*b, 100%% %<x> done';
		const L = one(text);
		expect(L.rem!.body).toBe('Hi %a and %*b, 100%% %<x> done');
		expect(L.pct.map((s) => text.slice(s.from, s.to))).toEqual(['%a', '%*b', '%%', '%<x>']);
		const segs = segments(L);
		expect(segs.map((s) => text.slice(s.from, s.to)).join('')).toBe(text);
		expect(segs.filter((s) => s.role === 'pct')).toHaveLength(4);
	});

	it('segments cover the raw text without gaps, including continuations', () => {
		const text = 'REM 2026-10-28 +3 \\\n  INFO "Location: Elm" \\\n    MSG Dentist %b';
		const L = one(text);
		const segs = segments(L);
		let pos = 0;
		for (const s of segs) {
			expect(s.from).toBe(pos);
			pos = s.to;
		}
		expect(pos).toBe(text.length);
		expect(segs.find((s) => s.role === 'kw' && text.slice(s.from, s.to) === 'MSG')).toBeTruthy();
	});

	it('comments and blanks', () => {
		expect(one('# note').kind).toBe('comment');
		expect(one('; note').kind).toBe('comment');
		expect(one('   ').kind).toBe('blank');
		expect(one('__EOF__').kind).toBe('eof');
		expect(segments(one('# note'))).toEqual([{ from: 0, to: 6, role: 'comment' }]);
	});
});

describe('classification', () => {
	it.each([
		['DO holidays.rem', 'include'],
		['INCLUDE "x y.rem"', 'include'],
		['PUSH-OMIT-CONTEXT', 'ctx'],
		['RETURN', 'ctx'],
		['IF [1]', 'engine'],
		['OMIT Sat Sun', 'omit'],
		['OMIT 25 Dec MSG Christmas', 'omit'],
		['rem mon msg lower case', 'rem']
	])('%s is %s', (line, kind) => {
		expect(one(line).kind).toBe(kind);
	});

	it('records include targets and omit specs', () => {
		expect(one('DO "a b.rem"').target).toBe('a b.rem');
		expect(one('OMIT Sat Sun').omit!.weekdays).toEqual([0, 6]);
		const o = one('OMIT 25 Dec +3 MSG Christmas %b');
		expect(o.omit!.from).toEqual({ d: 25, m: 12, y: null });
		expect(o.rem!.delta).toBe(3);
		expect(o.rem!.fromOmit).toBe(true);
	});

	it('parses the spec without computing anything', () => {
		const r = one(
			'REM TODO 2026-10-28 *14 +2 -1 AT 2:15pm DURATION 90 PRIORITY 10 MAX-OVERDUE 5 COMPLETE-THROUGH 15 Aug 2026 SKIP MSG x'
		).rem!;
		expect(r.spec).toEqual({ d: 28, m: 10, y: 2026, wd: null });
		expect(r.rep).toBe(14);
		expect(r.delta).toBe(2);
		expect(r.back).toBe(1);
		expect(r.at).toBe(14 * 60 + 15);
		expect(r.duration).toBe(90);
		expect(r.prio).toBe(10);
		expect(r.maxOverdue).toBe(5);
		expect(r.complete).toEqual({ y: 2026, m: 8, d: 15 });
		expect(r.omitMode).toBe('SKIP');
		expect(r.todo).toBe(true);
	});

	it('sugar forms keep what was written', () => {
		expect(one('REM Last Friday Nov MSG x').rem!.sugar).toEqual({ ord: 'last' });
		expect(one('REM Last Friday Nov MSG x').rem!.spec.m).toBe(11);
		expect(one('REM Lastworkday MSG x').rem!.sugar).toEqual({ lastday: 'work' });
		expect(one('REM Mon ~2 MSG x').rem!.sugar).toEqual({ tilde: { n: 2, double: false } });
	});
});

describe('parse errors', () => {
	it.each([
		['hello there', 'Start each reminder with REM'],
		['REM Mon', 'Add MSG (or CAL, RUN…) before the reminder text'],
		['REM 2026-02-30 MSG x', '2026-02-30 is not a real date'],
		['REM 2100-01-01 MSG x', 'Remind handles years from 1990 to 2075'],
		['REM 5 6 MSG x', "6 isn't a day (1–31) or a year (1990–2075) here"],
		['REM 5 Jan Feb MSG x', 'The month is given twice'],
		['REM +1 +2 MSG x', 'Only one advance warning (+N) is allowed'],
		['REM -1 -2 MSG x', 'Only one back (-N) is allowed'],
		['REM *2 *3 MSG x', 'Only one repeat (*N) is allowed'],
		['REM SKIP BEFORE MSG x', 'Use only one of SKIP, BEFORE or AFTER'],
		['REM AT MSG x', "MSG isn't a time Remind understands"],
		['REM AT 25:00 MSG x', "25:00 isn't a time Remind understands"],
		['REM DURATION abc MSG x', "abc isn't a duration (use h:mm or minutes)"],
		['REM PRIORITY MSG x', 'PRIORITY needs a number from 0 to 9999'],
		['REM INFO MSG x', 'INFO needs a quoted "Header: Value" string'],
		['REM INFO "nocolon" MSG x', 'INFO strings look like "Header: Value"'],
		['REM Mon INFO "A: 1" INFO "a: 2" MSG x', 'INFO "a" is given twice'],
		[
			'REM TODO COMPLETE-THROUGH MSG x',
			'COMPLETE-THROUGH needs a complete date, like 2026-12-11 or 11 Dec 2026'
		],
		['REM Mon COMPLETE-THROUGH 2026-01-01 MSG x', 'COMPLETE-THROUGH only works on a TODO'],
		['REM Mon UNTIL 2026-01-01 THROUGH 2026-02-01 MSG x', 'Use only one UNTIL or THROUGH'],
		['REM First MSG x', 'First/Second/Third/Fourth needs a weekday, like Last Friday'],
		[
			'REM 5 Last Fri MSG x',
			'First/Last/~N already imply the day of the month, so drop the day number'
		],
		['REM Feb 30 MSG x', 'February has no day 30'],
		['REM Mon *7 MSG x', 'A repeat (*N) needs a complete start date, like 2026-10-30 *14'],
		[
			'REM 2026-10-30 *7 THROUGH 2026-11-01 MSG x',
			'THROUGH already repeats daily; drop the *N or use UNTIL'
		],
		['REM Mon TZ Europe/Paris MSG x', 'TZ needs an AT time too'],
		['REM Mon OMIT MSG x', 'OMIT inside REM takes weekday names, like OMIT Sat Sun'],
		['REM Mon frobnicate MSG x', "I don't recognise “frobnicate”"],
		['DO', 'DO needs a file name'],
		['OMIT', 'OMIT needs weekdays or a date with a month, like OMIT 25 Dec'],
		['OMIT Sat foo', "I don't recognise “foo” after the weekdays"],
		['OMIT 25 Dec THROUGH', 'THROUGH needs an end date'],
		['OMIT 2026-12-25 THROUGH 26 Dec', 'Give the year on both sides of THROUGH, or on neither'],
		['OMIT 2026-12-26 THROUGH 2026-12-25', 'The end of the range is before its start'],
		['OMIT Dec MSG x', 'Give a day for an OMIT that carries a message'],
		['OMIT 25 Dec bogus', "I don't recognise “bogus” here"]
	])('%s', (line, message) => {
		const L = one(line);
		expect(L.kind).toBe('error');
		expect(L.error).toBe(message);
		expect(L.rem).toBeNull();
	});

	it('marks the offending token and reports file offsets', () => {
		const text = '# c\nREM Mon frobnicate MSG x\nREM Mon MSG ok';
		const lines = analyze(text);
		const bad = lines[1]!;
		expect(bad.tokens[bad.errorToken!]!.role).toBe('err');
		const d = diagnostics(lines);
		expect(d).toHaveLength(1);
		expect(text.slice(d[0]!.from, d[0]!.to)).toBe('frobnicate');
		expect(d[0]!.line).toBe(1);
	});

	it('accepts leap days and rejects non-leap ones', () => {
		expect(one('REM 2028-02-29 MSG x').kind).toBe('rem');
		expect(one('REM 2026-02-29 MSG x').kind).toBe('error');
		expect(one('REM 29 Feb MSG x').kind).toBe('rem');
	});
});
