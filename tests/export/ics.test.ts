// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The ICS writer: escaping, folding, all-day vs timed, stable UIDs, and a
 * golden file for the sample vault over a fixed range (Remind runs in Node).
 * Regenerate the golden only deliberately (`npx vitest run tests/export -u`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildIcs, durationValue, escapeText, foldLine } from '../../src/lib/export/ics';
import { runOp } from '../../src/lib/engine/ops';
import type { Engine } from '../../src/lib/engine/run';
import type { CalendarMonth, ReminderEntry } from '../../src/lib/engine/types';
import { fixtureFiles, nodeEngine } from '../engine/harness';
import { engineBuilt } from '../engine/remind';

const octets = (s: string) => new TextEncoder().encode(s).length;
const stamp = { date: '2026-10-28', time: 10 * 60 + 5 };

/** Checks the output as a small iCalendar parser would. Returns the VEVENTs' properties. */
export function validate(ics: string): Map<string, string>[] {
	expect(ics.endsWith('\r\n')).toBe(true);
	expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
	const physical = ics.split('\r\n').slice(0, -1);
	for (const l of physical) expect(octets(l)).toBeLessThanOrEqual(75);
	const lines: string[] = [];
	for (const l of physical) {
		if (l.startsWith(' ')) lines[lines.length - 1] += l.slice(1);
		else lines.push(l);
	}
	expect(lines[0]).toBe('BEGIN:VCALENDAR');
	expect(lines.at(-1)).toBe('END:VCALENDAR');
	expect(lines).toContain('VERSION:2.0');
	expect(lines).toContain('PRODID:-//Fasti//Fasti//EN');
	expect(lines).toContain('CALSCALE:GREGORIAN');
	const events: Map<string, string>[] = [];
	let current: Map<string, string> | null = null;
	for (const l of lines.slice(1, -1)) {
		if (l === 'BEGIN:VEVENT') {
			expect(current).toBeNull();
			current = new Map();
		} else if (l === 'END:VEVENT') {
			expect(current).not.toBeNull();
			for (const p of ['UID', 'DTSTAMP', 'SUMMARY']) expect(current!.has(p)).toBe(true);
			expect([...current!.keys()].some((k) => k.startsWith('DTSTART'))).toBe(true);
			events.push(current!);
			current = null;
		} else if (current) {
			const m = /^([A-Z][A-Z0-9-]*)((?:;[^:]*)?):(.*)$/.exec(l);
			expect(m, l).not.toBeNull();
			current.set((m?.[1] ?? '') + (m?.[2] ?? ''), m?.[3] ?? '');
		}
	}
	expect(current).toBeNull();
	return events;
}

const entry = (over: Partial<ReminderEntry>): ReminderEntry => ({
	date: '2026-11-05',
	file: 'a.rem',
	line: 1,
	lineEnd: 1,
	body: 'Thing',
	rawBody: null,
	time: null,
	duration: null,
	eventStart: null,
	priority: 5000,
	isTodo: false,
	completeThrough: null,
	completed: false,
	tags: [],
	info: {},
	special: null,
	color: null,
	delta: null,
	tz: null,
	raw: {},
	...over
});
const month = (entries: ReminderEntry[]): CalendarMonth =>
	({
		month: '2026-11',
		days: entries.map((e) => ({ date: e.date, day: 1, weekday: 0, omit: null, entries: [e] }))
	}) as unknown as CalendarMonth;
const files = { 'a.rem': 'REM 5 Nov MSG Thing\nREM 5 Nov AT 9:00 MSG Timed\n' };

describe('escaping and folding', () => {
	it('escapes backslash, comma, semicolon and newline', () => {
		expect(escapeText('a\\b,c;d\ne\r\nf')).toBe('a\\\\b\\,c\\;d\\ne\\nf');
	});

	it('leaves a line of 75 octets alone and folds at 75', () => {
		const exact = 'X:' + 'a'.repeat(73);
		expect(foldLine(exact)).toBe(exact);
		const folded = foldLine(exact + 'b').split('\r\n');
		expect(folded).toHaveLength(2);
		expect(octets(folded[0]!)).toBe(75);
		expect(folded[1]).toBe(' b');
	});

	it('never splits a multi-byte character and unfolds to the original', () => {
		for (const unit of ['é', '€', '日', '😀']) {
			for (let pad = 0; pad < 4; pad++) {
				const line = 'SUMMARY:' + 'x'.repeat(pad) + unit.repeat(60);
				const folded = foldLine(line);
				const parts = folded.split('\r\n');
				for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
				expect(parts[0]).toBe(parts[0]!.normalize()); // no lone surrogate halves
				expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
				expect(folded).not.toContain('�');
			}
		}
	});

	it('formats durations', () => {
		expect(durationValue(15)).toBe('PT15M');
		expect(durationValue(60)).toBe('PT1H');
		expect(durationValue(75)).toBe('PT1H15M');
		expect(durationValue(0)).toBe('PT0M');
	});
});

describe('events', () => {
	it('writes an untimed entry as an all-day event and a timed one as floating time with DURATION', async () => {
		const ics = await buildIcs(
			[
				month([
					entry({
						body: 'Day, one; "x"',
						line: 1,
						info: { location: 'Room 4B' },
						tags: ['a', 'b']
					}),
					entry({
						body: 'Timed',
						line: 2,
						time: 570,
						duration: 75,
						eventStart: { date: '2026-11-05', time: 570 }
					})
				])
			],
			{ files, stamp, tz: 'Europe/Paris' }
		);
		const [day, timed] = validate(ics);
		expect(day!.get('DTSTART;VALUE=DATE')).toBe('20261105');
		expect(day!.has('DTEND')).toBe(false);
		expect(day!.get('SUMMARY')).toBe('Day\\, one\\; "x"');
		expect(day!.get('DESCRIPTION')).toBe('a.rem:1');
		expect(day!.get('LOCATION')).toBe('Room 4B');
		expect(day!.get('CATEGORIES')).toBe('a,b');
		expect(day!.get('DTSTAMP')).toBe('20261028T100500Z');
		expect(timed!.get('DTSTART')).toBe('20261105T093000');
		expect(timed!.get('DURATION')).toBe('PT1H15M');
		expect(ics).not.toContain('RRULE');
		expect(ics).toContain('X-WR-TIMEZONE:Europe/Paris');
	});

	it('marks TODOs with a Task category and honours the TODO options', async () => {
		const months = [
			month([
				entry({ line: 1, body: 'Open', isTodo: true }),
				entry({ line: 2, body: 'Done', isTodo: true, completed: true, tags: ['t'] })
			])
		];
		const only = validate(await buildIcs(months, { files, stamp }));
		expect(only.map((e) => e.get('SUMMARY'))).toEqual(['Open']);
		expect(only[0]!.get('CATEGORIES')).toBe('Task');
		const all = validate(await buildIcs(months, { files, stamp, completed: true }));
		expect(all[1]!.get('CATEGORIES')).toBe('t,Task,Done');
		expect(all[1]!.get('X-FASTI-COMPLETED')).toBe('TRUE');
		expect(validate(await buildIcs(months, { files, stamp, todos: false }))).toHaveLength(0);
	});

	it('filters by file and drops warnings and specials', async () => {
		const months = [
			month([
				entry({ file: 'a.rem', body: 'A' }),
				entry({ file: 'b.rem', body: 'B' }),
				entry({ body: 'Colour', special: 'COLOR' })
			]),
			{
				days: [{ date: '2026-11-03', entries: [entry({ body: 'Warn', delta: 2 })] }]
			} as unknown as CalendarMonth
		];
		const got = validate(await buildIcs(months, { files, stamp, onlyFiles: new Set(['a.rem']) }));
		expect(got.map((e) => e.get('SUMMARY'))).toEqual(['A']);
	});
});

describe('UIDs', () => {
	it('are stable, 32 hex characters at @fasti, and change with file, line text or date', async () => {
		const uid = async (e: Partial<ReminderEntry>, f: Record<string, string> = files) =>
			validate(await buildIcs([month([entry(e)])], { files: f, stamp }))[0]!.get('UID')!;
		const a = await uid({});
		expect(a).toMatch(/^[0-9a-f]{32}@fasti$/);
		expect(await uid({})).toBe(a);
		expect(await uid({ body: 'Renamed' })).toBe(a); // the body isn't part of the identity
		expect(await uid({ date: '2026-11-06' })).not.toBe(a);
		expect(await uid({ file: 'b.rem' }, { 'b.rem': files['a.rem'] })).not.toBe(a);
		expect(await uid({}, { 'a.rem': 'REM 5 Nov MSG Edited\n' })).not.toBe(a);
	});

	it('stay unique when one line triggers twice on a date', async () => {
		const events = validate(await buildIcs([month([entry({}), entry({})])], { files, stamp }));
		expect(new Set(events.map((e) => e.get('UID'))).size).toBe(2);
	});
});

describe.skipIf(!engineBuilt)('sample vault, November and December 2026', () => {
	let engine: Engine;
	beforeAll(async () => {
		engine = await nodeEngine();
	});

	it('matches the golden file', async () => {
		const vault = { main: 'reminders.rem', files: fixtureFiles('sample'), hash: 'x' };
		const months: CalendarMonth[] = [];
		for (const m of ['2026-11', '2026-12']) {
			const r = await runOp(engine, { op: 'calendarMonth', month: m, tz: 'UTC', vault });
			months.push((r as { month: CalendarMonth }).month);
		}
		const ics = await buildIcs(months, {
			files: vault.files,
			stamp,
			tz: 'UTC',
			completed: true
		});
		const events = validate(ics);
		expect(events.length).toBeGreaterThan(20);
		expect(new Set(events.map((e) => e.get('UID'))).size).toBe(events.length);
		await expect(ics).toMatchFileSnapshot('golden/sample-2026-11.ics');
	});
});
