// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The 57 golden vectors from reference/manpage-vectors.test.js (worked
 * examples in the Remind 06.03.06 man page), run through the WebAssembly
 * build of Remind instead of the prototype's JS engine.
 *
 * The expected values are copied unchanged. How the prototype's API maps to
 * engine runs:
 *
 * - occ(text, a, b): `remind -ppp<n> -r /vault/m.rem <a's month>-01`, then the
 *   dates of the entries whose `lineno` is the text's last line (the
 *   prototype's "last item"), between a and b inclusive.
 * - ag(text, day): `remind --json -r -q -h /vault/m.rem <day>@00:00`; `t` is
 *   the event's `date`, `msg` its `body`. The prototype's `state` has no
 *   engine field; it is derived from Remind's dates (see stateOf).
 * - err(text): Remind's diagnostics on stderr, `/vault/m.rem(1): message`.
 *
 * Each vector that tests prototype-only behaviour is translated to the
 * equivalent engine assertion, with a TRANSLATED comment saying how.
 */
import { describe, expect, it } from 'vitest';
import {
	engineBuilt,
	monthSpan,
	runRemind,
	type AgendaEvent,
	type CalendarEntry,
	type MonthDescriptor
} from './remind';

const MAIN = '/vault/m.rem';

function lastLine(text: string): number {
	return text.replace(/\n$/, '').split('\n').length;
}

/** All `-ppp` calendar entries for the months spanning [from, to]. */
async function calendar(text: string, from: string, to: string): Promise<CalendarEntry[]> {
	const start = `${from.slice(0, 7)}-01`;
	const r = await runRemind({ 'm.rem': text }, [`-ppp${monthSpan(from, to)}`, MAIN, start]);
	expect(r.code).toBe(0);
	const months = JSON.parse(r.stdout) as MonthDescriptor[];
	return months.flatMap((m) => m.entries);
}

/** Trigger dates of the reminder on `line` (default: the last line) within [a, b]. */
async function occ(text: string, a: string, b: string, line = lastLine(text)): Promise<string[]> {
	const entries = await calendar(text, a, b);
	const dates = entries
		.filter((e) => e.filename === MAIN && e.lineno === line && e.date >= a && e.date <= b)
		.map((e) => e.date);
	return [...new Set(dates)].sort();
}

/** Agenda events (banner and "No reminders." objects dropped). */
async function agenda(text: string, day: string): Promise<AgendaEvent[]> {
	const r = await runRemind({ 'm.rem': text }, ['--json', '-q', '-h', MAIN, `${day}@00:00`]);
	expect(r.code).toBe(0);
	const items = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
	return items.filter((x) => 'date' in x) as AgendaEvent[];
}

/**
 * TRANSLATED: the prototype's agenda `state` ('soon' | 'overdue') is not an
 * engine field. Remind gives the trigger date; the state follows from it:
 * after the agenda day is 'soon', before it is 'overdue'.
 */
function stateOf(t: string, day: string): string {
	return t > day ? 'soon' : t < day ? 'overdue' : 'today';
}

async function ag(text: string, day: string) {
	return (await agenda(text, day)).map((x) => ({
		t: x.date,
		s: stateOf(x.date, day),
		msg: x.body
	}));
}

/** Remind's first diagnostic for line 1 of m.rem, or null. */
async function err(text: string): Promise<string | null> {
	const r = await runRemind({ 'm.rem': text }, ['-q', MAIN, '2026-10-28@00:00']);
	const line = r.stderr.split('\n').find((l) => l.startsWith(`${MAIN}(1):`));
	return line ? line.slice(`${MAIN}(1):`.length).trim() : null;
}

/** Evaluates expressions after the whole file has run (agenda, one day). */
async function probe(text: string, exprs: string[], day = '2026-10-28'): Promise<string[]> {
	const marker = 'PROBE:';
	const body = exprs.map((e) => `[${e}]`).join('|');
	const r = await runRemind({ 'm.rem': `${text}\nMSG ${marker}${body}%\n` }, [
		'-q',
		MAIN,
		`${day}@00:00`
	]);
	const out = r.stdout.split('\n').find((l) => l.startsWith(marker));
	expect(out, r.stdout + r.stderr).toBeDefined();
	return (out ?? '').slice(marker.length).split('|');
}

describe.skipIf(!engineBuilt)('man page vectors through WASM', () => {
	// date spec interpretation
	it('Mon Tue 28 Oct 1990', async () => {
		expect(await occ('REM Mon Tue 28 Oct 1990 MSG Hi', '1990-10-01', '1990-11-30')).toEqual([
			'1990-10-29'
		]);
	});
	it('Sat 1 first Saturday', async () => {
		expect(await occ('REM Sat 1 MSG x', '2026-10-01', '2026-12-31')).toEqual([
			'2026-10-03',
			'2026-11-07',
			'2026-12-05'
		]);
	});
	it('31 every month w/31', async () => {
		expect(await occ('REM 31 MSG x', '2026-09-01', '2026-12-31')).toEqual([
			'2026-10-31',
			'2026-12-31'
		]);
	});
	it('Feb 29', async () => {
		expect(await occ('REM Feb 29 MSG x', '2026-01-01', '2028-12-31')).toEqual(['2028-02-29']);
	});
	it('Last Monday', async () => {
		expect(await occ('REM Last Monday MSG x', '2026-10-01', '2026-12-31')).toEqual([
			'2026-10-26',
			'2026-11-30',
			'2026-12-28'
		]);
	});
	it('Last Monday April = Mon 1 May --7', async () => {
		const a = await occ('REM Last Monday April MSG x', '2026-01-01', '2027-12-31');
		const b = await occ('REM Mon 1 May --7 MSG x', '2026-01-01', '2027-12-31');
		expect(a).toEqual(b);
		expect(a.length).toBeGreaterThan(0); // guard: two empty lists would also be equal
	});
	it('Last Monday December 2025', async () => {
		expect(await occ('REM Last Monday December 2025 MSG x', '2025-01-01', '2026-12-31')).toEqual([
			'2025-12-29'
		]);
	});
	it('Second Monday May', async () => {
		expect(await occ('REM Second Monday in May MSG x', '2026-01-01', '2026-12-31')).toEqual([
			'2026-05-11'
		]);
	});
	it('Lastday', async () => {
		expect(await occ('REM Lastday MSG x', '2026-01-01', '2026-03-31')).toEqual([
			'2026-01-31',
			'2026-02-28',
			'2026-03-31'
		]);
	});
	it('Lastworkday Apr OMIT', async () => {
		const a = await occ('REM Lastworkday April OMIT SAT SUN MSG x', '2026-01-01', '2027-12-31');
		const b = await occ('REM 1 May -1 OMIT SAT SUN MSG x', '2026-01-01', '2027-12-31');
		expect(a).toEqual(b);
		expect(a.length).toBeGreaterThan(0);
	});
	it('Apr ~~7', async () => {
		expect(await occ('REM Apr ~~7 MSG x', '2026-01-01', '2026-12-31')).toEqual(['2026-04-24']);
	});
	// back with omit: 1 -1 OMIT Sat Sun ; 2026-11-01 is Sunday -> Fri Oct 30; 2026-06-01 is Monday -> Fri May 29
	it('1 -1 OMIT Sat Sun', async () => {
		expect(await occ('REM 1 -1 OMIT Sat Sun MSG x', '2026-05-01', '2026-11-30')).toEqual([
			'2026-05-29',
			'2026-06-30',
			'2026-07-31',
			'2026-08-31',
			'2026-09-30',
			'2026-10-30',
			'2026-11-30'
		]);
	});
	it('1 --1 OMIT Sat Sun', async () => {
		expect(await occ('REM 1 --1 OMIT Sat Sun MSG x', '2026-10-01', '2026-10-31')).toEqual([
			'2026-10-31'
		]);
	});

	// delta with omit: 1 +1 OMIT Sat Sun, first is Monday (2026-06-01) -> warn from Fri May 29
	/**
	 * TRANSLATED: the prototype's K.warnStart(rem, trigger) is "the first day the
	 * agenda shows the reminder for that trigger date". Run the agenda for each
	 * day of the week before 2026-06-01 and take the first day with an event
	 * dated 2026-06-01.
	 */
	async function warnStart(text: string, trigger: string): Promise<string | undefined> {
		for (const day of ['2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29'].concat(
			['2026-05-30', '2026-05-31', '2026-06-01']
		)) {
			if ((await agenda(text, day)).some((e) => e.date === trigger)) return day;
		}
		return undefined;
	}
	it('warnStart +1', async () => {
		expect(await warnStart('REM 1 +1 OMIT Sat Sun MSG x', '2026-06-01')).toBe('2026-05-29');
	});
	it('warnStart ++1', async () => {
		expect(await warnStart('REM 1 ++1 OMIT Sat Sun MSG x', '2026-06-01')).toBe('2026-05-31');
	});

	// SKIP / BEFORE / AFTER (man page, 1992)
	const base = 'OMIT 11 Nov +4 MSG Remembrance Day\n';
	it('Wed plain', async () => {
		expect(await occ(base + 'REM Wed MSG Code meeting', '1992-11-09', '1992-11-19')).toEqual([
			'1992-11-11',
			'1992-11-18'
		]);
	});
	it('Wed SKIP', async () => {
		expect(await occ(base + 'REM Wed SKIP MSG Code', '1992-11-09', '1992-11-19')).toEqual([
			'1992-11-18'
		]);
	});
	it('Wed BEFORE', async () => {
		expect(await occ(base + 'REM Wed BEFORE MSG Code', '1992-11-09', '1992-11-19')).toEqual([
			'1992-11-10',
			'1992-11-18'
		]);
	});
	it('Wed AFTER', async () => {
		expect(await occ(base + 'REM Wed AFTER MSG Code', '1992-11-09', '1992-11-19')).toEqual([
			'1992-11-12',
			'1992-11-18'
		]);
	});
	it('OMIT with MSG is also a REM', async () => {
		expect(await occ('OMIT 11 Nov +4 MSG Remembrance Day', '1992-01-01', '1992-12-31')).toEqual([
			'1992-11-11'
		]);
	});

	// THROUGH / UNTIL
	it('jury THROUGH', async () => {
		expect(
			await occ('REM 1992-11-30 +2 THROUGH 1992-12-04 MSG Jury duty', '1992-11-01', '1992-12-31')
		).toEqual(['1992-11-30', '1992-12-01', '1992-12-02', '1992-12-03', '1992-12-04']);
	});
	it('jury *1 UNTIL', async () => {
		expect(
			await occ('REM 1992-11-30 *1 +2 UNTIL 1992-12-04 MSG Jury duty', '1992-11-01', '1992-12-31')
		).toEqual(['1992-11-30', '1992-12-01', '1992-12-02', '1992-12-03', '1992-12-04']);
	});
	it('THROUGH + AFTER respects expiry', async () => {
		expect(
			await occ(
				'OMIT 2021-01-08\nREM 2021-01-01 THROUGH 2021-01-08 AFTER MSG Test',
				'2021-01-01',
				'2021-01-31'
			)
		).toEqual([
			'2021-01-01',
			'2021-01-02',
			'2021-01-03',
			'2021-01-04',
			'2021-01-05',
			'2021-01-06',
			'2021-01-07'
		]);
	});
	it('Fri UNTIL', async () => {
		expect(await occ('REM Fri UNTIL 11 Dec 1992 MSG Class', '1992-11-30', '1992-12-31')).toEqual([
			'1992-12-04',
			'1992-12-11'
		]);
	});
	it('payday *14', async () => {
		expect(await occ('REM 28 Oct 1992 *14 MSG Payday', '1992-10-01', '1992-12-01')).toEqual([
			'1992-10-28',
			'1992-11-11',
			'1992-11-25'
		]);
	});
	it('wkday 15', async () => {
		expect(await occ('REM Mon Tue Wed Thu Fri 15 MSG x', '2026-08-01', '2026-11-30')).toEqual([
			'2026-08-17',
			'2026-09-15',
			'2026-10-15',
			'2026-11-16'
		]);
	});
	/**
	 * TRANSLATED: RUN reminders never reach a calendar ("RUN-type reminders are
	 * not normally inserted into the calendar", remind(1) CALENDAR MODE), and
	 * with -r they only report "RUN disabled". So the vector's line runs
	 * unchanged and a probe line after it marks each day on which it triggered:
	 * trigdate() is the trigger date the line just computed.
	 */
	it('backup AFTER', async () => {
		const text =
			'REM 1 OMIT Sat Sun AFTER RUN do_backup\n' +
			'IF trigvalid() && trigdate() == today()\n' +
			'MSG fired\n' +
			'ENDIF';
		expect(await occ(text, '2026-10-01', '2026-11-30', 3)).toEqual(['2026-10-01', '2026-11-02']);
	});

	// ADDOMIT Labour Day then a delta that skips it
	it('ADDOMIT', async () => {
		expect(
			await occ(
				'REM Mon 1 Sep SCANFROM -7 ADDOMIT MSG Labour Day\nREM Tue 2 Sep -1 MSG day before tue',
				'2026-08-01',
				'2026-09-30'
			)
		).toEqual(['2026-09-06']);
	});

	// TODOs
	it('TODO cat food before', async () => {
		expect(await ag('REM TODO 15 August 2025 ++5 MSG Buy cat food %b.', '2025-08-10')).toEqual([
			{ t: '2025-08-15', s: 'soon', msg: "Buy cat food in 5 days' time." }
		]);
	});
	it('TODO cat food after', async () => {
		expect(await ag('REM TODO 15 August 2025 ++5 MSG Buy cat food %b.', '2025-08-16')).toEqual([
			{ t: '2025-08-15', s: 'overdue', msg: 'Buy cat food yesterday.' }
		]);
	});
	const maxOverdue = 'REM TODO 2025-08-13 ++5 MAX-OVERDUE 5 MSG Task: %b.';
	it('MAX-OVERDUE last', async () => {
		expect((await ag(maxOverdue, '2025-08-18')).length).toBe(1);
	});
	it('MAX-OVERDUE gone', async () => {
		expect((await ag(maxOverdue, '2025-08-19')).length).toBe(0);
	});
	it('MAX-OVERDUE start', async () => {
		expect((await ag(maxOverdue, '2025-08-08')).length).toBe(1);
	});
	it('MAX-OVERDUE before start', async () => {
		expect((await ag(maxOverdue, '2025-08-07')).length).toBe(0);
	});
	it('trash from 1990', async () => {
		expect((await ag('REM TODO Wed +7 MSG Take out the trash %a (%b)', '2025-08-13'))[0]?.msg).toBe(
			'Take out the trash on Wednesday, 3 January, 1990 (13006 days ago)'
		);
	});
	it('trash done', async () => {
		expect(
			(
				await ag(
					'REM TODO Wed +7 COMPLETE-THROUGH 2025-08-13 MSG Take out the trash %a (%b)',
					'2025-08-13'
				)
			)[0]?.msg
		).toBe("Take out the trash on Wednesday, 20 August, 2025 (in 7 days' time)");
	});
	it('plants', async () => {
		expect(
			(await ag('REM TODO Wed +7 FROM 2025-08-06 UNTIL 2025-08-27 MSG Plants %b.', '2025-08-13'))[0]
				?.msg
		).toBe('Plants 7 days ago.');
	});
	it('plants done', async () => {
		expect(
			(
				await ag(
					'REM TODO Wed +7 FROM 2025-08-06 UNTIL 2025-08-27 COMPLETE-THROUGH 2025-08-27 MSG Plants %b.',
					'2025-08-28'
				)
			).length
		).toBe(0);
	});
	it('taxes', async () => {
		expect(
			(
				await ag('REM TODO 30 April ++15 COMPLETE-THROUGH 2025-04-30 MSG File taxes', '2026-04-20')
			)[0]?.t
		).toBe('2026-04-30');
	});

	// substitutions from the man page
	const bob = async (code: string, day: string) =>
		(await ag(`REM 18 Oct 1990 +4 MSG Meeting with Bob ${code}.`, day))[0]?.msg;
	it('%a', async () => {
		expect([
			await bob('%a', '1990-10-16'),
			await bob('%a', '1990-10-17'),
			await bob('%a', '1990-10-18')
		]).toEqual([
			'Meeting with Bob on Thursday, 18 October, 1990.',
			'Meeting with Bob tomorrow.',
			'Meeting with Bob today.'
		]);
	});
	it('%b', async () => {
		expect(await bob('%b', '1990-10-16')).toBe("Meeting with Bob in 2 days' time.");
	});
	it('%c', async () => {
		expect(await bob('%c', '1990-10-16')).toBe('Meeting with Bob on Thursday.');
	});
	it('%x %p', async () => {
		expect(
			(await ag('REM 1 Jan +4 MSG %x day%p to go before New Year!', '2026-12-30'))[0]?.msg
		).toBe('2 days to go before New Year!');
	});
	it('%q', async () => {
		expect((await ag('REM 1 Jan +4 MSG New Year in %x day%q time!', '2026-12-31'))[0]?.msg).toBe(
			"New Year in 1 day's time!"
		);
	});
	it('%j %*c %U', async () => {
		expect((await ag('REM 2026-11-02 MSG %j / %*c / %U', '2026-10-01')).length).toBe(0);
	});
	it('INFO %<>', async () => {
		expect(
			(
				await ag(
					'REM 2026-11-02 INFO "Location: Boardroom #2" MSG Meet at %<location>',
					'2026-11-02'
				)
			)[0]?.msg
		).toBe('Meet at Boardroom #2');
	});
	it('%2 %3', async () => {
		expect((await ag('REM AT 13:05 MSG x %2 %3', '2026-11-02'))[0]?.msg).toBe(
			'x at 1:05pm at 13:05'
		);
	});

	// sugar errors
	/**
	 * TRANSLATED (all five): the prototype returned an error string for the
	 * line; the engine equivalent is a `/vault/m.rem(1): …` diagnostic on stderr.
	 */
	it('err First Monday 3 June', async () => {
		expect(!!(await err('REM First Monday 3 June MSG Huh?'))).toBe(true);
	});
	it('err April 3 ~~1', async () => {
		expect(!!(await err('REM April 3 ~~1 MSG What?'))).toBe(true);
	});
	it('err Second June', async () => {
		expect(!!(await err('REM Second June MSG x'))).toBe(true);
	});
	/**
	 * TRANSLATED: the prototype's wording ("I don't recognise “Mnday”") is its
	 * own. Remind reads the unknown word as the start of the body and reports
	 * "Missing REM type; assuming MSG" on that line.
	 */
	it('err Mnday', async () => {
		expect(await err('REM Mnday MSG x')).toBe('Missing REM type; assuming MSG');
	});
	it('err COMPLETE w/o TODO', async () => {
		expect(await err('REM 15 COMPLETE-THROUGH 2026-01-01 MSG x')).toBe(
			'COMPLETE-THROUGH specified without TODO'
		);
	});

	/**
	 * TRANSLATED (omit range wrap, OMIT May): the prototype read its final OMIT
	 * context with K.isOmitted; the engine equivalent is Remind's isomitted()
	 * evaluated on a line after the vector's text.
	 */
	it('omit range wrap', async () => {
		expect(
			await probe('OMIT 25 Dec THROUGH 4 Jan\nREM 1 Jan MSG x', [
				"isomitted('2026-12-30')",
				"isomitted('2027-01-05')"
			])
		).toEqual(['1', '0']);
	});
	it('OMIT May whole month', async () => {
		expect(await probe('OMIT May', ["isomitted('2026-05-31')"])).toEqual(['1']);
	});
	it('push/pop', async () => {
		const text =
			'PUSH-OMIT-CONTEXT\nOMIT Sat Sun\nREM Sat SKIP MSG a\nPOP-OMIT-CONTEXT\nREM Sat SKIP MSG b';
		expect([
			(await occ(text, '2026-10-01', '2026-10-10', 3)).length,
			(await occ(text, '2026-10-01', '2026-10-10', 5)).length
		]).toEqual([0, 2]);
	});
	it('continuation', async () => {
		expect(await occ('REM Mon \\\n  Wed MSG x', '2026-10-26', '2026-10-31')).toEqual([
			'2026-10-26',
			'2026-10-28'
		]);
	});
	/**
	 * TRANSLATED: `engineOnly` flagged lines the prototype couldn't evaluate.
	 * Through WASM the SATISFY line simply yields Friday-the-13th dates: per
	 * remind(1), "2026-11-13 ... is the first Friday the 13th on or after
	 * 2026-07-01".
	 */
	it('satisfy engine-only', async () => {
		const text = 'REM 13 SATISFY [$Tw == 5] MSG Friday 13th';
		expect(await occ(text, '2026-07-01', '2026-12-31')).toEqual(['2026-11-13']);
		const year = await occ(text, '2026-01-01', '2027-12-31');
		expect(year.length).toBeGreaterThan(0);
		for (const d of year) {
			expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(5);
			expect(d.endsWith('-13')).toBe(true);
		}
	});
});

describe.skipIf(!engineBuilt)('vector count', () => {
	it('ports all 57 checks', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(
			new URL('../../reference/manpage-vectors.test.js', import.meta.url),
			'utf8'
		);
		const checks = src.match(/\bcheck\('/g)?.length ?? 0;
		expect(checks).toBe(57);
	});
});
