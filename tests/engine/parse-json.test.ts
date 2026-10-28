// SPDX-License-Identifier: GPL-2.0-or-later
/** Unit tests for parse-json.ts on hand-written Remind output (shapes from docs/engine.md). */
import { describe, expect, it } from 'vitest';
import {
	dedupeDiagnostics,
	normalisePath,
	parseAgenda,
	parseCalendar,
	parseDiagnostics,
	parseEntry
} from '../../src/lib/engine/parse-json';

describe('normalisePath', () => {
	it('makes absolute /vault paths (main file, DO) vault-relative', () => {
		expect(normalisePath('/vault/reminders.rem')).toBe('reminders.rem');
		expect(normalisePath('/vault/sub/a.rem')).toBe('sub/a.rem');
		expect(normalisePath('/vault')).toBe('');
		expect(normalisePath('/vault/sub/../x.rem')).toBe('x.rem');
		expect(normalisePath('/vault//sub/./a.rem')).toBe('sub/a.rem');
	});

	it('keeps relative INCLUDE paths (relative to /vault), normalised', () => {
		expect(normalisePath('sub/c.rem')).toBe('sub/c.rem');
		expect(normalisePath('./sub/c.rem')).toBe('sub/c.rem');
		expect(normalisePath('sub/../c.rem')).toBe('c.rem');
	});

	it('gives null outside the vault', () => {
		expect(normalisePath('/fasti/calendar.rem')).toBeNull();
		expect(normalisePath('/vaultx/a.rem')).toBeNull();
		expect(normalisePath('../a.rem')).toBeNull();
		expect(normalisePath('/vault/../etc/passwd')).toBeNull();
	});
});

describe('parseDiagnostics', () => {
	it('parses file(line): message, dedupes calendar repeats and flags warnings', () => {
		const stderr = [
			"/vault/m.rem(3): Ill-formed time: `25:99'",
			"/vault/m.rem(3): Ill-formed time: `25:99'",
			'sub/c.rem(1): Warning: Useless use of UNTIL with fully-specified date and no *rep',
			"/vault/m.rem(3): Ill-formed time: `25:99'",
			''
		].join('\n');
		expect(parseDiagnostics(stderr)).toEqual([
			{ file: 'm.rem', line: 3, message: "Ill-formed time: `25:99'", warning: false },
			{
				file: 'sub/c.rem',
				line: 1,
				message: 'Warning: Useless use of UNTIL with fully-specified date and no *rep',
				warning: true
			}
		]);
	});

	it('joins indented call-frame lines onto the message before them', () => {
		const stderr = [
			"/vault/m.rem(2): `-': Maximum expression complexity exceeded",
			"    /vault/m.rem(1): [#0] In function `f'",
			'    [remaining call frames omitted]'
		].join('\n');
		expect(parseDiagnostics(stderr)).toEqual([
			{
				file: 'm.rem',
				line: 2,
				message:
					"`-': Maximum expression complexity exceeded\n/vault/m.rem(1): [#0] In function `f'\n[remaining call frames omitted]",
				warning: false
			}
		]);
	});

	it('keeps lines without a vault file whole, with file and line null', () => {
		expect(parseDiagnostics("Can't open file\n/fasti/calendar.rem(2): Oops")).toEqual([
			{ file: null, line: null, message: "Can't open file", warning: false },
			{ file: null, line: null, message: '/fasti/calendar.rem(2): Oops', warning: false }
		]);
	});

	it('skips lines matching the skip pattern', () => {
		expect(parseDiagnostics('FASTI-PROBE 1 2\n/vault/a.rem(1): x', /^FASTI-PROBE /)).toEqual([
			{ file: 'a.rem', line: 1, message: 'x', warning: false }
		]);
	});

	it('dedupeDiagnostics keeps the first of each', () => {
		const d = { file: 'a', line: 1, message: 'x', warning: false };
		expect(dedupeDiagnostics([d, { ...d }, { ...d, line: 2 }])).toEqual([d, { ...d, line: 2 }]);
	});
});

describe('parseEntry', () => {
	it('maps rem2ps keys to typed fields', () => {
		const raw = {
			date: '2026-11-05',
			filename: '/vault/m.rem',
			lineno: 10,
			lineno_start: 8,
			tags: 'work,home',
			info: { location: 'Room 1', n: 3 },
			duration: 60,
			time: 570,
			is_todo: 0,
			priority: 4000,
			eventstart: '2026-11-05T09:30',
			eventduration: 60,
			rawbody: 'Long %"x%"',
			body: 'x',
			passthru: 'COLOR',
			r: 1,
			g: 2,
			b: 3,
			delta: -2,
			tz: 'Europe/Paris'
		};
		expect(parseEntry(raw)).toEqual({
			date: '2026-11-05',
			file: 'm.rem',
			line: 8,
			lineEnd: 10,
			body: 'x',
			rawBody: 'Long %"x%"',
			time: 570,
			duration: 60,
			eventStart: { date: '2026-11-05', time: 570 },
			priority: 4000,
			isTodo: false,
			completeThrough: null,
			completed: false,
			tags: ['work', 'home'],
			info: { location: 'Room 1' },
			special: 'COLOR',
			color: { r: 1, g: 2, b: 3 },
			delta: -2,
			tz: 'Europe/Paris',
			raw
		});
	});

	it('marks TODO occurrences on or before COMPLETE-THROUGH as completed', () => {
		const todo = (date: string) =>
			parseEntry({
				date,
				filename: 'a.rem',
				lineno: 1,
				is_todo: 1,
				complete_through: '2026-11-06',
				priority: 5000,
				body: 'r'
			});
		expect(todo('2026-11-06')?.completed).toBe(true);
		expect(todo('2026-10-30')?.completed).toBe(true);
		expect(todo('2026-11-13')?.completed).toBe(false);
	});

	it('defaults missing optional keys and rejects non-entries', () => {
		expect(
			parseEntry({ date: '2026-01-01', filename: '/vault/a.rem', lineno: 2, body: 'b' })
		).toMatchObject({
			line: 2,
			lineEnd: 2,
			time: null,
			duration: null,
			eventStart: null,
			priority: 5000,
			isTodo: false,
			tags: [],
			info: {},
			special: null,
			color: null
		});
		expect(parseEntry({ banner: 'x' })).toBeNull();
		expect(parseEntry({ date: '2026-01-01', filename: '/fasti/c.rem', lineno: 1 })).toBeNull();
		expect(parseEntry(null)).toBeNull();
	});
});

describe('parseAgenda', () => {
	it('takes the banner, entries and diagnostics; ignores noreminders', () => {
		const stdout = [
			'[',
			'{"banner":"Reminders for Wednesday, 28th October, 2026 (today):"},',
			'{"date":"2026-10-29","filename":"/vault/m.rem","lineno":2,"is_todo":1,"delta":2,"priority":5000,"body":"Open thing"},',
			'{"noreminders":"No reminders."}',
			']'
		].join('\n');
		const r = parseAgenda(stdout, '/vault/m.rem(9): Parse error\n');
		expect(r.banner).toBe('Reminders for Wednesday, 28th October, 2026 (today):');
		expect(r.entries.map((e) => [e.date, e.file, e.line, e.isTodo, e.delta, e.body])).toEqual([
			['2026-10-29', 'm.rem', 2, true, 2, 'Open thing']
		]);
		expect(r.diagnostics).toEqual([
			{ file: 'm.rem', line: 9, message: 'Parse error', warning: false }
		]);
	});

	it('handles empty output (-h with nothing to say) and rejects non-JSON', () => {
		expect(parseAgenda('', '')).toEqual({ banner: null, entries: [], diagnostics: [] });
		expect(() => parseAgenda('Reminders for…', '')).toThrow(/not JSON/);
	});
});

describe('parseCalendar', () => {
	const probe = (date: string, body: string) => ({
		date,
		filename: '/fasti/calendar.rem',
		lineno: 3,
		passthru: 'FASTI-DAY',
		is_todo: 0,
		priority: 0,
		body
	});
	const month = {
		caltype: 'monthly',
		monthname: 'November',
		year: 2026,
		daysinmonth: 2, // trimmed for the test
		firstwkday: 0,
		mondayfirst: 1,
		daynames: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		prevmonthname: 'October',
		daysinprevmonth: 31,
		prevmonthyear: 2026,
		nextmonthname: 'December',
		daysinnextmonth: 31,
		nextmonthyear: 2026,
		entries: [
			probe('2026-11-01', '0 weekly'),
			{
				date: '2026-11-02',
				filename: '/vault/m.rem',
				lineno: 1,
				priority: 5000,
				body: 'A',
				is_todo: 0
			},
			probe('2026-11-02', '1 -'),
			{
				date: '2026-11-02',
				filename: 'sub/b.rem',
				lineno: 4,
				priority: 5000,
				body: 'B',
				is_todo: 0
			},
			probe('2026-11-03', '2 dated')
		]
	};

	it("builds days from the wrapper's probe entries and files entries under them", () => {
		const [m] = parseCalendar(JSON.stringify([month]));
		expect(m).toMatchObject({
			month: '2026-11',
			year: 2026,
			monthNumber: 11,
			monthName: 'November',
			daysInMonth: 2,
			firstWeekday: 0,
			mondayFirst: true,
			dayNames: month.daynames,
			prev: { name: 'October', year: 2026, days: 31 },
			next: { name: 'December', year: 2026, days: 31 }
		});
		expect(
			m!.days.map((d) => [
				d.date,
				d.day,
				d.weekday,
				d.omit,
				d.entries.map((e) => `${e.file}:${e.body}`)
			])
		).toEqual([
			['2026-11-01', 1, 0, 'weekly', []],
			['2026-11-02', 2, 1, null, ['m.rem:A', 'sub/b.rem:B']],
			['2026-11-03', 3, 2, 'dated', []]
		]);
	});

	it('ignores a FASTI-DAY special in a vault file (only the wrapper counts)', () => {
		const fake = { ...probe('2026-11-02', '1 weekly'), filename: '/vault/m.rem' };
		const [m] = parseCalendar(
			JSON.stringify([{ ...month, entries: [probe('2026-11-02', '1 -'), fake] }])
		);
		expect(m!.days[0]!.omit).toBeNull();
		expect(m!.days[0]!.entries.map((e) => e.special)).toEqual(['FASTI-DAY']);
	});
});
