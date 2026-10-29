// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * SCHED (remind(1) PRECISE SCHEDULING): the rules of Remind's queue.c as a
 * pure function, the generated probe script, and the man page example
 * evaluated by the real engine after the whole script.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
	buildSchedule,
	planTimes,
	queueTimes,
	schedScript,
	schedTimes,
	type SchedValue
} from '../../src/lib/notify/schedule';
import type { AgendaResult, ReminderEntry } from '../../src/lib/engine/types';
import { nodeClient, snapshot } from '../engine/harness';
import { engineBuilt } from '../engine/remind';

const hm = (h: number, m = 0) => h * 60 + m;
const ints = (...n: number[]): SchedValue[] => n.map((int) => ({ int }));
const clock = (times: number[]) =>
	times.map(
		(t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
	);

/** The man page's `choose(x, -60, 30, 15, 10, 3, 1, 1, 1, 1, 0)`, fn(1) … fn(12). */
const SFUN = ints(-60, 30, 15, 10, 3, 1, 1, 1, 1, 0, 0, 0);
const SFUN_TIMES = [
	'12:00',
	'12:30',
	'12:45',
	'12:55',
	'12:58',
	'12:59',
	'13:00',
	'13:01',
	'13:02'
];

describe('schedTimes (queue.c CalculateNextDtimeUsingSched)', () => {
	it('gives the man page example', () => {
		expect(clock(schedTimes(hm(13), SFUN))).toEqual(SFUN_TIMES);
	});

	it('takes a TIME as that time and zero or a negative INT from the AT time', () => {
		const v: SchedValue[] = [{ time: hm(9, 15) }, { time: hm(9, 45) }, { int: 0 }, { int: 0 }];
		expect(clock(schedTimes(hm(10), v))).toEqual(['09:15', '09:45', '10:00']);
	});

	it('adds a first positive INT to the AT time', () => {
		expect(clock(schedTimes(hm(13), ints(5)))).toEqual(['13:05']);
	});

	it('is the plain AT, tdelta and trep times without values (no such function)', () => {
		expect(schedTimes(hm(12), [], 75, 30)).toEqual(queueTimes(hm(12), 75, 30));
		expect(schedTimes(hm(12), [])).toEqual([hm(12)]);
	});

	// Remind drops tdelta with SCHED (dorem.c), but queue.c's fallback would use it.
	it('falls back to tdelta and trep after an error, from the last time issued', () => {
		const v: SchedValue[] = [...ints(-20, -10), null, { int: 1 }];
		expect(clock(schedTimes(hm(13), v, 60, 15))).toEqual(['12:40', '12:50', '13:00']);
		expect(clock(schedTimes(hm(13), v, 60, 4))).toEqual([
			'12:40',
			'12:50',
			'12:52',
			'12:56',
			'13:00'
		]);
	});

	it('stops at a value that is not later than the last, and the AT time still fires', () => {
		expect(clock(schedTimes(hm(13), ints(-10, -20, -5)))).toEqual(['12:50', '13:00']);
		expect(clock(schedTimes(hm(13), ints(-10, 0, 0)))).toEqual(['12:50', '13:00']);
	});

	it('does not fire the AT time when the sequence ends after it', () => {
		expect(clock(schedTimes(hm(13), [{ time: hm(13, 30) }]))).toEqual(['13:30']);
	});

	it('issues nothing past the end of the day, leaving that call to the AT time', () => {
		// fn(2) runs past midnight: the AT time stands in; fn(3) is asked next, as in queue.c.
		expect(clock(schedTimes(hm(13), ints(-10, 2000, 1)))).toEqual(['12:50', '13:00', '13:01']);
	});

	it('reaches back before midnight with negative minutes', () => {
		expect(schedTimes(hm(0, 30), ints(-60))).toEqual([-30, hm(0, 30)]);
	});
});

function entry(over: Partial<ReminderEntry> & { date: string }): ReminderEntry {
	return {
		file: 'm.rem',
		line: 1,
		lineEnd: 1,
		body: 'x',
		rawBody: null,
		time: hm(13),
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

describe('planTimes with SCHED', () => {
	const days = ['2026-10-28'];
	const e = entry({ date: days[0]!, raw: { sched: '_sfun', tdelta: 30 } });

	it('skips the values before now', () => {
		const plan = planTimes(days, [agendaOf(e)], hm(12, 50), new Map([['_sfun', SFUN]]));
		expect(clock(plan.map((p) => p.minute))).toEqual(SFUN_TIMES.slice(3));
	});

	it('uses the AT time and tdelta for a function it has no values for', () => {
		const plan = planTimes(days, [agendaOf(e)], 0);
		expect(clock(plan.map((p) => p.minute))).toEqual(['12:30', '13:00']);
	});
});

describe('schedScript', () => {
	it('DOes the main entry, then prints each value with its type', () => {
		const text = schedScript('reminders.rem', ['_a', '_b'], 2);
		expect(text.split('\n')).toEqual([
			'DO /vault/reminders.rem',
			'FSET __fasti_sched_value(v) iif(typeof(v) == "TIME", "T" + coerce("INT", v), typeof(v) == "INT", "I" + v, "X")',
			'REM MSG FASTI-SCHED|0|[catch(__fasti_sched_value(_a(1)), "E")]|',
			'REM MSG FASTI-SCHED|1|[catch(__fasti_sched_value(_a(2)), "E")]|',
			'REM MSG FASTI-SCHED|2|[catch(__fasti_sched_value(_b(1)), "E")]|',
			'REM MSG FASTI-SCHED|3|[catch(__fasti_sched_value(_b(2)), "E")]|',
			''
		]);
		expect(schedScript('', ['_a'], 1)).toMatch(/^DO \/vault\n/);
		expect(() => schedScript('m.rem', ['x]; y'])).toThrow();
	});
});

describe.skipIf(!engineBuilt)('SCHED through the real engine', () => {
	const client = nodeClient();
	afterAll(() => client.dispose());
	const tz = 'Europe/Berlin';
	const now = { date: '2026-10-28', time: hm(8) };
	const today = (s: Awaited<ReturnType<typeof buildSchedule>>, body: string) =>
		clock(
			s.notifications.filter((n) => n.date === now.date && n.body === body).map((n) => n.minute)
		);

	it('follows the man page example', async () => {
		const vault = snapshot({
			'reminders.rem': [
				'FSET _sfun(x) choose(x, -60, 30, 15, 10, 3, 1, 1, 1, 1, 0)',
				'REM AT 13:00 SCHED _sfun MSG foo',
				''
			].join('\n')
		});
		const s = await buildSchedule(client, vault, { tz, now });
		expect(today(s, 'foo')).toEqual(SFUN_TIMES);
		// 12:00 in Berlin (CET) is 11:00 UTC.
		expect(s.notifications.find((n) => n.body === 'foo')?.at).toBe(Date.UTC(2026, 9, 28, 11, 0));
		// From 12:50, the values before now are skipped.
		const later = await buildSchedule(client, vault, {
			tz,
			now: { date: now.date, time: hm(12, 50) }
		});
		expect(today(later, 'foo')).toEqual(SFUN_TIMES.slice(3));
	});

	it('uses the definitions in force at the end of the script, TIMEs, errors and fallbacks', async () => {
		const vault = snapshot({
			'reminders.rem': [
				'REM AT 13:00 SCHED _late MSG late',
				'FSET _late(x) choose(x, -60, -1)',
				'FSET _late(x) choose(x, -5, 0)',
				'FSET _t(x) choose(x, 09:15, 09:45, 0)',
				'REM AT 10:00 SCHED _t MSG times',
				'FSET _bad(x) iif(x < 3, -30 + 10 * x, 1 / 0)',
				'REM AT 13:00 +60 *15 SCHED _bad MSG bad',
				'REM AT 14:00 +30 SCHED _missing MSG missing',
				''
			].join('\n')
		});
		const s = await buildSchedule(client, vault, { tz, now });
		expect(today(s, 'late')).toEqual(['12:55', '13:00']);
		expect(today(s, 'times')).toEqual(['09:15', '09:45', '10:00']);
		expect(today(s, 'bad')).toEqual(['12:40', '12:50', '13:00']);
		// Remind drops the +30 of a reminder with SCHED: the AT time alone.
		expect(today(s, 'missing')).toEqual(['14:00']);
	});
});
