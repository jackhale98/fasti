// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The notification schedule against the real engine (worker threads): the
 * days, the queued reminders and their warning times, bodies substituted at
 * the notification's time, and clock times from Remind's localtoutc().
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
	buildSchedule,
	dayScript,
	planTimes,
	queueTimes,
	queueable,
	utcScript,
	type Schedule
} from '../../src/lib/notify/schedule';
import type { AgendaResult, ReminderEntry } from '../../src/lib/engine/types';
import { nodeClient, snapshot } from '../engine/harness';
import { engineBuilt } from '../engine/remind';

const hm = (h: number, m = 0) => h * 60 + m;

describe('queueTimes (remind(1), TIMED REMINDERS)', () => {
	it('issues AT 12:00 +75 *30 at 10:45, 11:15, 11:45 and 12:00', () => {
		expect(queueTimes(hm(12), 75, 30)).toEqual([hm(10, 45), hm(11, 15), hm(11, 45), hm(12)]);
	});
	it('issues AT 12:00 +45 at 11:15 and 12:00 (trep defaults to tdelta)', () => {
		expect(queueTimes(hm(12), 45)).toEqual([hm(11, 15), hm(12)]);
	});
	it('issues a plain AT once', () => {
		expect(queueTimes(hm(9, 30))).toEqual([hm(9, 30)]);
	});
	it('ignores tdelta and trep with SCHED', () => {
		expect(queueTimes(hm(13), 60, 10, true)).toEqual([hm(13)]);
	});
	it('reaches back before midnight with negative minutes', () => {
		expect(queueTimes(hm(0, 30), 60)).toEqual([-30, 30]);
	});
});

function entry(over: Partial<ReminderEntry> & { date: string }): ReminderEntry {
	return {
		file: 'm.rem',
		line: 1,
		lineEnd: 1,
		body: 'x',
		rawBody: null,
		time: hm(9),
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
	};
}

const agendaOf = (...entries: ReminderEntry[]): AgendaResult => ({
	banner: null,
	entries,
	diagnostics: []
});

describe('queueable and planTimes', () => {
	it('leaves out untimed, NOQUEUE, completed and non-message SPECIAL entries', () => {
		const d = '2026-10-28';
		expect(queueable(entry({ date: d }))).toBe(true);
		expect(queueable(entry({ date: d, time: null }))).toBe(false);
		expect(queueable(entry({ date: d, raw: { noqueue: 1 } }))).toBe(false);
		expect(queueable(entry({ date: d, completed: true, isTodo: true }))).toBe(false);
		expect(queueable(entry({ date: d, special: 'COLOR' }))).toBe(true);
		expect(queueable(entry({ date: d, special: 'WEEK' }))).toBe(false);
		expect(queueable(entry({ date: d, body: ' ' }))).toBe(false);
	});

	it('gives a warning before midnight to the previous day, but not past an earlier occurrence', () => {
		const days = ['2026-10-28', '2026-10-29', '2026-10-30'];
		const once = entry({ date: days[2]!, line: 1, time: hm(0, 10), raw: { tdelta: 30 } });
		const daily = (d: string) => entry({ date: d, line: 2, time: hm(0, 10), raw: { tdelta: 30 } });
		const plan = planTimes(
			days,
			[agendaOf(daily(days[0]!)), agendaOf(daily(days[1]!)), agendaOf(daily(days[2]!), once)],
			0
		);
		const of = (line: number) =>
			plan.filter((p) => p.entry.line === line).map((p) => [p.day, p.minute]);
		// Line 1 triggers only on the 30th: its 23:40 warning falls on the 29th.
		expect(of(1)).toEqual([
			[1, hm(23, 40)],
			[2, hm(0, 10)]
		]);
		// Line 2 triggers daily: each day Remind queues that day's occurrence only.
		expect(of(2)).toEqual([
			[0, hm(0, 10)],
			[1, hm(0, 10)],
			[2, hm(0, 10)]
		]);
		// And on the first day, nothing before now.
		expect(planTimes(days, [agendaOf(daily(days[0]!))], hm(1)).length).toBe(0);
	});

	it('ignores entries whose date is not the agenda day (TODOs, +N warnings)', () => {
		const days = ['2026-10-28', '2026-10-29'];
		const plan = planTimes(days, [agendaOf(entry({ date: '2026-10-29' })), agendaOf()], 0);
		expect(plan).toEqual([]);
	});

	it('generates the probe scripts', () => {
		expect(dayScript(2)).toBe(
			'SET $DateSep "-"\nREM MSG FASTI-DAY|0|[today()+0]\nREM MSG FASTI-DAY|1|[today()+1]\nREM MSG FASTI-DAY|2|[today()+2]\n'
		);
		expect(utcScript([{ date: '2026-10-28', minute: 90 }])).toBe(
			"REM MSG FASTI-UTC|0|[localtoutc(datetime('2026-10-28', 0, 0) + 90) - '1990-01-01@00:00']\n"
		);
		expect(() => utcScript([{ date: '28 Oct', minute: 0 }])).toThrow();
	});
});

const VAULT = [
	'REM 2026-10-28 AT 12:00 +75 *30 MSG Example2',
	'REM 2026-10-28 AT 09:00 MSG Already past',
	'REM 2026-10-28 AT 13:00 NOQUEUE MSG Calendar only',
	'REM 2026-10-28 AT 14:00 CAL Not a message',
	'REM 2026-10-28 AT 15:00 RUN echo never',
	'REM 2026-10-28 AT 16:00 +60 MSG Tea %1',
	'REM 2026-10-29 AT 00:30 +60 MSG Early start',
	'REM Mon AT 08:00 MSG Weekly',
	'REM 2026-10-28 AT 09:00 TZ America/New_York MSG New York call',
	'REM 2026-11-20 AT 10:00 MSG Outside the window',
	''
].join('\n');

describe.skipIf(!engineBuilt)('buildSchedule (real engine)', () => {
	const client = nodeClient();
	afterAll(() => client.dispose());
	const vault = snapshot({ 'reminders.rem': VAULT });
	const tz = 'Europe/Berlin';
	const now = { date: '2026-10-28', time: hm(10) };
	let full: Schedule;

	it('lists Remind’s today and the next 8 days', async () => {
		full = await buildSchedule(client, vault, { tz, now });
		expect(full.days).toEqual([
			'2026-10-28',
			'2026-10-29',
			'2026-10-30',
			'2026-10-31',
			'2026-11-01',
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
			'2026-11-05'
		]);
		expect(full.through).toBe('2026-11-05');
		expect(full.truncated).toBe(false);
		// Midnight in Berlin (CET) is 23:00 UTC.
		expect(full.nextDay).toBe(Date.UTC(2026, 9, 28, 23, 0));
	});

	it('honours +tdelta, *trepeat and NOQUEUE, and skips CAL, RUN and the past', () => {
		const list = full.notifications.map((n) => `${n.date} ${n.minute} ${n.body}`);
		expect(list).toEqual([
			`2026-10-28 ${hm(10, 45)} Example2`,
			`2026-10-28 ${hm(11, 15)} Example2`,
			`2026-10-28 ${hm(11, 45)} Example2`,
			`2026-10-28 ${hm(12)} Example2`,
			// 09:00 in New York is 14:00 in Berlin.
			`2026-10-28 ${hm(14)} New York call`,
			`2026-10-28 ${hm(15)} Tea 1 hour from now`,
			`2026-10-28 ${hm(16)} Tea now`,
			`2026-10-28 ${hm(23, 30)} Early start`,
			`2026-10-29 ${hm(0, 30)} Early start`,
			`2026-11-02 ${hm(8)} Weekly`
		]);
	});

	it('gives each notification its moment from Remind’s localtoutc()', () => {
		const at = Object.fromEntries(full.notifications.map((n) => [`${n.date} ${n.minute}`, n.at]));
		expect(at[`2026-10-28 ${hm(12)}`]).toBe(Date.UTC(2026, 9, 28, 11, 0));
		expect(at[`2026-10-29 ${hm(0, 30)}`]).toBe(Date.UTC(2026, 9, 28, 23, 30));
		expect(at[`2026-11-02 ${hm(8)}`]).toBe(Date.UTC(2026, 10, 2, 7, 0));
		const first = full.notifications[0]!;
		expect(first.id).toBe('2026-10-28T10:45|reminders.rem:1');
		expect(first.eventDate).toBe('2026-10-28');
		expect(first.eventTime).toBe(hm(12));
		const early = full.notifications.find((n) => n.body === 'Early start')!;
		expect(early.date).toBe('2026-10-28');
		expect(early.eventDate).toBe('2026-10-29');
	});

	it('stops at the cap and reports the last complete day', async () => {
		const capped = await buildSchedule(client, vault, { tz, now, max: 9 });
		expect(capped.notifications.length).toBe(9);
		expect(capped.truncated).toBe(true);
		// The 10th (Mon 2 Nov) was left out: complete through the day before.
		expect(capped.through).toBe('2026-11-01');
	});

	it('leaves out what is past the horizon', async () => {
		const cut = await buildSchedule(client, vault, {
			tz,
			now,
			horizon: Date.UTC(2026, 9, 30, 0, 0)
		});
		expect(cut.notifications.at(-1)?.body).toBe('Early start');
		expect(cut.truncated).toBe(true);
		expect(cut.through).toBe('2026-11-01');
	});

	it('follows the time zone it is run in', async () => {
		const ny = await buildSchedule(client, vault, {
			tz: 'America/New_York',
			now: { date: '2026-10-28', time: hm(8) }
		});
		const call = ny.notifications.find((n) => n.body === 'New York call')!;
		expect(call.minute).toBe(hm(9));
		expect(call.at).toBe(Date.UTC(2026, 9, 28, 13, 0));
	});
});
