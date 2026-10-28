// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The invocations and output shapes recorded in docs/engine.md, pinned so a
 * change to the engine build that alters them fails here first.
 */
import { describe, expect, it } from 'vitest';
import { engineBuilt, runRemind, type MonthDescriptor } from './remind';

const vault = {
	'reminders.rem': [
		'REM Mon AT 09:30 DURATION 1:00 TAG work MSG Standup',
		'REM TODO 2026-10-27 COMPLETE-THROUGH 2026-10-27 MSG Done thing',
		'REM TODO 2026-10-29 +2 MSG Open thing %b',
		'REM 6 Jan MSG %"Dianne\'s birthday%" is %b',
		'REM 2026-10-28 INFO "Location: Boardroom" MSG Review',
		''
	].join('\n')
};
const MAIN = '/vault/reminders.rem';
const env = { TZ: 'UTC' };

describe.skipIf(!engineBuilt)('agenda: --json -r -q -h <main> YYYY-MM-DD@HH:MM', () => {
	it('is one JSON array of event objects (banner suppressed by -h only when empty)', async () => {
		const r = await runRemind(vault, ['--json', '-q', '-h', MAIN, '2026-10-28@08:00'], { env });
		expect(r.code).toBe(0);
		expect(r.stderr).toBe('');
		const out = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
		expect(out[0]).toEqual({ banner: 'Reminders for Wednesday, 28th October, 2026 (today):' });
		expect(out.slice(1)).toEqual([
			{
				date: '2026-10-29',
				filename: MAIN,
				lineno: 3,
				d: 29,
				m: 10,
				y: 2026,
				is_todo: 1,
				delta: 2,
				trigbase: '2026-10-29',
				priority: 5000,
				body: 'Open thing tomorrow' // no rawbody in agenda JSON (remind(1))
			},
			{
				date: '2026-10-28',
				filename: MAIN,
				lineno: 5,
				d: 28,
				m: 10,
				y: 2026,
				is_todo: 0,
				trigbase: '2026-10-28',
				priority: 5000,
				info: { location: 'Boardroom' },
				body: 'Review'
			}
		]);
	});

	it('is an empty array when nothing triggers and -h is given', async () => {
		const r = await runRemind(vault, ['--json', '-q', '-h', MAIN, '2026-10-20@08:00'], { env });
		expect(JSON.parse(r.stdout)).toEqual([]);
	});
});

describe.skipIf(!engineBuilt)('calendar: -ppp<months> -r -b2 [-m] [--hide-completed-todos]', () => {
	it('is a JSON array of month descriptors with entries', async () => {
		const r = await runRemind(vault, ['-ppp3', '-b2', MAIN, '2026-10-01'], { env });
		expect(r.code).toBe(0);
		const months = JSON.parse(r.stdout) as MonthDescriptor[];
		expect(months.map((m) => `${m.monthname} ${m.year}`)).toEqual([
			'October 2026',
			'November 2026',
			'December 2026'
		]);
		const { entries, translations, ...header } = months[0]!;
		expect(header).toEqual({
			caltype: 'monthly',
			monthname: 'October',
			year: 2026,
			daysinmonth: 31, // rem2ps(1) spells it "daysinmonnth"; Remind emits "daysinmonth"
			firstwkday: 4,
			mondayfirst: 0,
			daynames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
			prevmonthname: 'September',
			daysinprevmonth: 30,
			prevmonthyear: 2026,
			nextmonthname: 'November',
			daysinnextmonth: 30,
			nextmonthyear: 2026
		});
		expect(translations).toBeTypeOf('object'); // first month only
		expect(months[1]).not.toHaveProperty('translations');
		expect(entries[0]).toEqual({
			date: '2026-10-05',
			filename: MAIN,
			lineno: 1,
			tags: 'work',
			duration: 60,
			time: 570,
			wd: ['Monday'],
			is_todo: 0,
			priority: 5000,
			eventstart: '2026-10-05T09:30',
			eventduration: 60,
			body: 'Standup'
		});
		// Completed TODOs are shown unless --hide-completed-todos is given.
		expect(entries.some((e) => e.lineno === 2)).toBe(true);
	});

	it('-b1 prefixes timed bodies with 24-hour times; -b2 does not', async () => {
		const r = await runRemind(vault, ['-ppp1', '-b1', MAIN, '2026-10-01'], { env });
		const [first] = (JSON.parse(r.stdout) as MonthDescriptor[])[0]!.entries;
		expect(first).toMatchObject({ body: '09:30-10:30 Standup', rawbody: 'Standup' });
	});

	it('-m starts weeks on Monday; --hide-completed-todos drops completed TODOs', async () => {
		const r = await runRemind(
			vault,
			['-ppp1', '-b2', '-m', '--hide-completed-todos', MAIN, '2026-10-01'],
			{ env }
		);
		const [month] = JSON.parse(r.stdout) as MonthDescriptor[];
		expect(month!.mondayfirst).toBe(1);
		expect(month!.entries.some((e) => e.lineno === 2)).toBe(false);
	});

	it('without the q flag, body is the %"…%" part and rawbody the full text', async () => {
		const r = await runRemind(vault, ['-ppp1', '-b2', MAIN, '2027-01-01'], { env });
		const entry = (JSON.parse(r.stdout) as MonthDescriptor[])[0]!.entries.find(
			(e) => e.lineno === 4
		);
		expect(entry).toMatchObject({
			body: "Dianne's birthday",
			rawbody: '%"Dianne\'s birthday%" is %b'
		});
	});

	it('repeats each diagnostic once per calendar day, plus once more', async () => {
		const r = await runRemind({ 'm.rem': 'REM Mnday MSG x\n' }, [
			'-ppp1',
			'/vault/m.rem',
			'2026-02-01'
		]);
		expect(r.stderr.split('\n')).toHaveLength(28 + 1);
		expect(new Set(r.stderr.split('\n'))).toEqual(
			new Set(['/vault/m.rem(1): Missing REM type; assuming MSG'])
		);
	});
});

describe.skipIf(!engineBuilt)('weekly calendar: -ppp+<weeks>', () => {
	it('is a JSON array of week descriptors with seven dates', async () => {
		const r = await runRemind(vault, ['-ppp+1', '-b2', '-m', MAIN, '2026-10-28'], { env });
		const [week] = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
		expect(week!.caltype).toBe('weekly');
		expect(week!.dates).toHaveLength(7);
		expect((week!.dates as unknown[])[0]).toEqual({
			dayname: 'Monday',
			date: '2026-10-26',
			year: 2026,
			month: 'October',
			day: 26
		});
		expect(week!.entries).toBeInstanceOf(Array);
	});
});

describe.skipIf(!engineBuilt)('next dates: -n -r <main>', () => {
	it('prints "YYYY/MM/DD [time] body" lines, not JSON, without file or line', async () => {
		const r = await runRemind(vault, ['-n', MAIN, '2026-10-28'], { env });
		expect(r.stdout.split('\n')).toEqual([
			'2026/11/02 9:30am Standup',
			'2026/10/29 Open thing tomorrow',
			"2027/01/06 Dianne's birthday is in 70 days' time",
			'2026/10/28 Review'
		]);
	});
});
