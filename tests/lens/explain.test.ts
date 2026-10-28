// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { explainLine, explainRem, lineLabel } from '../../src/lib/lens/explain';
import { analyze } from '../../src/lib/lens/tokenize';

const one = (text: string) => analyze(text)[0]!;
const rem = (text: string) => explainRem(one(text).rem!);
const line = (text: string) => explainLine(one(text));

describe('explain REM', () => {
	it('restates a date literal without a weekday', () => {
		expect(rem('REM 2026-10-28 MSG x')).toEqual(['On 28 October 2026.']);
		expect(rem('REM 28 Oct 2026 AT 14:00 DURATION 1:30 MSG x')).toEqual([
			'On 28 October 2026 at 2:00pm for 1 hour 30 min.'
		]);
	});

	it.each([
		['REM MSG x', 'Every day.'],
		['REM Mon Tue Wed Thu Fri MSG x', 'Every weekday.'],
		['REM Sat Sun MSG x', 'Every weekend day.'],
		['REM Mon Wed MSG x', 'Every Monday and Wednesday.'],
		['REM 1 MSG x', 'On the 1st of every month.'],
		['REM 31 MSG x', 'On the 31st of every month that has one.'],
		['REM 25 Dec MSG x', 'Every year on 25 December.'],
		['REM Dec MSG x', 'Every day in December.'],
		['REM Second Saturday MSG x', 'The second Saturday of every month.'],
		['REM Last Friday Nov MSG x', 'The last Friday of November each year.'],
		['REM Lastday MSG x', 'The last day of every month.'],
		['REM Lastworkday MSG x', 'The last working day of every month.'],
		['REM Mon ~2 MSG x', 'The 2nd-to-last working day of every month.'],
		['REM Mon -1 MSG x', 'Every Monday, moved back 1 working day.'],
		['REM Mon --2 MSG x', 'Every Monday, moved back 2 days.'],
		['REM 2026-10-30 *14 MSG x', 'Every 2 weeks, counting from 30 October 2026.'],
		['REM 2026-10-30 *7 MSG x', 'Every week, counting from 30 October 2026.'],
		['REM 2026-10-30 *3 MSG x', 'Every 3 days, counting from 30 October 2026.'],
		[
			'REM 2026-10-30 THROUGH 2026-11-02 MSG x',
			'Every day from 30 October 2026 through 2 November 2026.'
		],
		['REM 8 Mon MSG x', 'The second Monday of every month.'],
		['REM 10 Mon MSG x', 'The first Monday on or after the 10th of every month.']
	])('%s', (text, first) => {
		expect(rem(text)[0]).toBe(first);
	});

	it('adds sentences for modifiers', () => {
		expect(
			rem('REM TODO Mon +3 SKIP MAX-OVERDUE 1 PRIORITY 10 FROM 1 Jan 2026 UNTIL 2026-12-31 MSG x')
		).toEqual([
			'Every Monday.',
			'Skipped when it lands on a day off or holiday.',
			'Starts reminding you 3 working days ahead.',
			'Starts on 1 January 2026.',
			'Ends after 31 December 2026.',
			'A task: it keeps reminding you after it is due until you mark it done.',
			'Stops nagging 1 day after it is due.',
			'Priority 10 (default is 5000).'
		]);
		expect(rem('REM Mon OMIT Sat Sun ++2 MSG x')).toContain(
			'Treats Sat & Sun as days off for this reminder.'
		);
		expect(rem('REM TODO 15 COMPLETE-THROUGH 2026-09-15 MSG x')).toContain(
			'Done through 15 September 2026.'
		);
		expect(rem('REM Mon CAL x')).toContain('Shows on the calendar only, with no agenda reminder.');
		expect(rem('REM Mon RUN ls')).toContain(
			'Runs a command instead of showing a message. The web app lists it but never runs it.'
		);
	});

	it('says "evaluated by Remind" for expressions, SATISFY and functions', () => {
		expect(rem('REM 13 SATISFY [$Tw == 5] MSG x')).toEqual([
			'When this fires is evaluated by Remind.',
			'Uses SATISFY, which is evaluated by Remind.'
		]);
		expect(rem('REM [today()] MSG x')[0]).toBe('When this fires is evaluated by Remind.');
		expect(rem('REM Mon OMITFUNC hol MSG x')).toEqual([
			'When this fires is evaluated by Remind.',
			'Uses OMITFUNC, which is evaluated by Remind.'
		]);
		expect(rem('REM Mon AT [x] MSG y')).toEqual([
			'Every Monday.',
			'Uses an expression, which is evaluated by Remind.'
		]);
	});
});

describe('explain OMIT, includes and context commands', () => {
	it.each([
		[
			'OMIT Sat Sun',
			'Treats every weekend day as a day off. Reminders using -N, +N, SKIP, BEFORE or AFTER work around it.'
		],
		['OMIT 25 Dec', 'Marks 25 December as a holiday every year.'],
		['OMIT 25 Dec 2026', 'Marks 25 December 2026 as a holiday.'],
		['OMIT Dec', 'Marks all of December as holidays every year.'],
		['OMIT Dec 2026', 'Marks all of December 2026 as holidays.'],
		['OMIT 24 Dec THROUGH 26 Dec', 'Marks 24 Dec through 26 Dec as holidays every year.'],
		[
			'OMIT 24 Dec 2026 THROUGH 2 Jan 2027',
			'Marks 24 December 2026 through 2 January 2027 as holidays.'
		],
		['OMIT DUMP', 'Prints the current holidays. Ignored by the app.']
	])('%s', (text, sentence) => {
		expect(line(text)[0]).toBe(sentence);
	});

	it('an OMIT with a message is also a reminder', () => {
		expect(line('OMIT 25 Dec +3 MSG Christmas')).toEqual([
			'Marks 25 December as a holiday every year.',
			'Also shows as a reminder, starting 3 days ahead.',
			'Every year on 25 December.',
			'Starts reminding you 3 working days ahead.',
			'This OMIT line is also a reminder, and the day counts as a holiday.'
		]);
	});

	it('other line kinds', () => {
		expect(line('# hi')).toEqual(['A comment. Remind ignores lines that start with # or ;.']);
		expect(line('DO holidays.rem')[0]).toBe(
			'Reads every reminder and holiday in holidays.rem at this point, so its OMITs apply to the lines below.'
		);
		expect(line('PUSH-OMIT-CONTEXT')).toEqual([
			'Saves the current holidays so they can be restored later.'
		]);
		expect(line('POP-OMIT-CONTEXT')[0]).toMatch(/^Restores the holidays/);
		expect(line('CLEAR-OMIT-CONTEXT')[0]).toMatch(/^Clears every holiday/);
		expect(line('RETURN')).toEqual(['Stops reading this file here.']);
		expect(line('SET x 1')).toEqual(['SET is evaluated by Remind.']);
		expect(line('REM Mon bogus')[0]).toBe("I don't recognise “bogus”");
		expect(line('REM Mon bogus')[1]).toMatch(/Remind would stop on this line/);
	});

	it('labels logical lines', () => {
		const lines = analyze('REM Mon \\\n MSG x\nREM Tue MSG y');
		expect(lineLabel(lines[0]!)).toBe('Line 1–2');
		expect(lineLabel(lines[1]!)).toBe('Line 3');
	});
});

describe('the lens never computes dates', () => {
	const dir = join(__dirname, '../../src/lib/lens');
	const forbidden =
		/Date\.UTC|new Date|Date\.now|getUTC|getDay|toISOString|\b(occurrences|nextOccurrence|upcoming|agenda|warnStart|isOmitted|subst)\s*\(/;
	for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'quickadd.ts')) {
		it(`${f} has no date arithmetic`, () => {
			const code = readFileSync(join(dir, f), 'utf8')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/.*$/gm, '');
			expect(code).not.toMatch(forbidden);
		});
	}
});
