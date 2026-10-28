// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Q, parse, toRem } from '../../src/lib/lens/quickadd';
import { analyze } from '../../src/lib/lens/tokenize';

/** Fixed "today": Wednesday 28 October 2026. */
const today = { y: 2026, m: 10, d: 28 };

// Expected lines come from running the prototype's Q.parse / Q.toRem with the same today.
const phrases: [string, string][] = [
	['dentist tomorrow at 3pm', 'REM 2026-10-29 AT 15:00 MSG Dentist'],
	['call mom next Thu', 'REM 2026-10-29 MSG Call mom'],
	['pay rent on the 1st of every month', 'REM 1 MSG Pay rent'],
	['standup every weekday at 9:30', 'REM Mon Tue Wed Thu Fri AT 9:30 MSG Standup'],
	['water plants every Sunday', 'REM Sun MSG Water plants'],
	['todo renew passport 14 Dec', 'REM TODO 2026-12-14 MSG Renew passport %b'],
	["Maya's birthday 3 Nov", "REM 3 Nov +7 MSG Maya's birthday %b"],
	[
		'submit timesheet last working day of every month',
		'REM Lastworkday OMIT Sat Sun MSG Submit timesheet'
	],
	['team lunch in 3 days', 'REM 2026-10-31 MSG Team lunch'],
	['gym every Mon, Wed and Fri at 6pm for 1h', 'REM Mon Wed Fri AT 18:00 DURATION 1:00 MSG Gym'],
	[
		'farmers market second Saturday of the month at 10am',
		'REM Second Saturday AT 10:00 MSG Farmers market'
	],
	['pay credit card every 14 days from 2026-11-06', 'REM 2026-11-06 *14 MSG Pay credit card'],
	['trash every other tue', 'REM 2026-11-03 *14 MSG Trash'],
	['taxes April 30 remind me 2 days before', 'REM 2027-04-30 +2 MSG Taxes %b'],
	['meeting 2026-12-01 14:00 for 90 min', 'REM 2026-12-01 AT 14:00 DURATION 1:30 MSG Meeting'],
	['lunch with sam on friday at noon', 'REM Fri AT 12:00 MSG Lunch with sam'],
	['yoga daily until 20 dec', 'REM UNTIL 2026-12-20 MSG Yoga'],
	['call dad day after tomorrow', 'REM 2026-10-30 MSG Call dad'],
	['review budget last friday of the month', 'REM Last Friday MSG Review budget'],
	['anniversary 5 Mar', 'REM 5 Mar +7 MSG Anniversary %b'],
	['plain text nothing', 'REM 2026-10-28 MSG Plain text nothing'],
	['vacation every year on 25 dec skip holidays', 'REM 25 Dec SKIP MSG Vacation'],
	['dentist next week', 'REM 2026-11-02 MSG Dentist'],
	['todo file taxes 15 Jan +3', 'REM TODO 2027-01-15 +3 MSG File taxes %b'],
	['backup last day of every month', 'REM Lastday MSG Backup'],
	['pay bill today', 'REM 2026-10-28 MSG Pay bill'],
	['wedding 20 Feb 2027', 'REM 2027-02-20 MSG Wedding']
];

describe('quick add phrases', () => {
	it.each(phrases)('%s', (input, expected) => {
		expect(toRem(parse(input, today), today)).toBe(expected);
	});

	it('every output is a REM line the tokenizer accepts', () => {
		for (const [input] of phrases) {
			const line = analyze(toRem(parse(input, today), today))[0]!;
			expect(line.kind, `${input}: ${line.error}`).toBe('rem');
		}
	});

	it('exports the prototype-style Q object', () => {
		expect(Q.toRem(Q.parse('x tomorrow', today), today)).toBe('REM 2026-10-29 MSG X');
	});
});

describe('safety rules', () => {
	it('a new recurring TODO gets COMPLETE-THROUGH yesterday', () => {
		expect(toRem(parse('todo water plants every sunday', today), today)).toBe(
			'REM TODO Sun COMPLETE-THROUGH 2026-10-27 MSG Water plants %b'
		);
		expect(toRem(parse('todo pay card 15th of every month', today), today)).toBe(
			'REM TODO 15 COMPLETE-THROUGH 2026-10-27 MSG Pay card %b'
		);
		expect(toRem(parse('todo every 2 weeks clean filters', today), today)).toBe(
			'REM TODO 2026-10-28 *14 COMPLETE-THROUGH 2026-10-27 MSG Clean filters %b'
		);
	});

	it('yesterday crosses month and year boundaries', () => {
		const line = toRem(parse('todo clean every monday', { y: 2027, m: 1, d: 1 }), {
			y: 2027,
			m: 1,
			d: 1
		});
		expect(line).toContain('COMPLETE-THROUGH 2026-12-31');
		expect(
			toRem(parse('todo clean every monday', { y: 2028, m: 3, d: 1 }), { y: 2028, m: 3, d: 1 })
		).toContain('COMPLETE-THROUGH 2028-02-29');
	});

	it('a one-off TODO has no COMPLETE-THROUGH', () => {
		expect(toRem(parse('todo renew passport 14 Dec', today), today)).not.toContain(
			'COMPLETE-THROUGH'
		);
	});

	it('last working day carries OMIT Sat Sun in the REM line itself', () => {
		const line = toRem(parse('payroll last working day of the month', today), today);
		expect(line).toBe('REM Lastworkday OMIT Sat Sun MSG Payroll');
		expect(line.split('\n')).toHaveLength(1);
	});
});

describe('model', () => {
	it('records what was understood', () => {
		const m = parse('standup every weekday at 9:30 for 15 min', today);
		expect(m.kind).toBe('weekly');
		expect(m.wds).toEqual([1, 2, 3, 4, 5]);
		expect(m.time).toBe(570);
		expect(m.duration).toBe(15);
		expect(m.recognised).toBe(true);
		expect(parse('nothing here', today).recognised).toBe(false);
	});

	it('past dates without a year roll to next year', () => {
		expect(toRem(parse('dentist 14 oct', today), today)).toBe('REM 2027-10-14 MSG Dentist');
		expect(toRem(parse('dentist 28 oct', today), today)).toBe('REM 2026-10-28 MSG Dentist');
	});

	it('an empty message becomes Reminder', () => {
		expect(toRem(parse('tomorrow', today), today)).toBe('REM 2026-10-29 MSG Reminder');
	});
});
