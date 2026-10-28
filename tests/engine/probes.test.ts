// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Fasti's generated Remind scripts (probes.ts): the line probe's scratch copy
 * and line mapping, the report parsers, and the calendar wrapper's omitted-day
 * detection run through Remind.
 */
import { describe, expect, it } from 'vitest';
import {
	calendarWrapper,
	logicalRange,
	mainPath,
	parseNow,
	parseProbeReport,
	probeFile
} from '../../src/lib/engine/probes';
import { runOp } from '../../src/lib/engine/ops';
import type { OpResults } from '../../src/lib/engine/protocol';
import { nodeEngine } from './harness';
import { engineBuilt } from './remind';

describe('line probe', () => {
	const text = 'A\nB \\\nC \\\nD\nE\n';

	it('finds the logical line around any of its physical lines', () => {
		const lines = text.split('\n');
		expect(logicalRange(lines, 1)).toEqual({ start: 1, end: 1 });
		for (const l of [2, 3, 4]) expect(logicalRange(lines, l)).toEqual({ start: 2, end: 4 });
		expect(logicalRange(lines, 5)).toEqual({ start: 5, end: 5 });
	});

	it('puts a reset before and the probe after the line, and maps lines back', () => {
		const p = probeFile(text, 3);
		const lines = p.text.split('\n');
		expect(lines[0]).toBe('A');
		expect(lines[1]).toMatch(/^REM 1990-01-01 \*1 UNTIL 1990-01-01 SPECIAL/);
		expect(lines.slice(2, 5)).toEqual(['B \\', 'C \\', 'D']);
		expect(lines[5]).toBe('SET $DateSep "-"');
		expect(lines).toContain('EXIT 0');
		expect(lines).not.toContain('E');
		expect([p.first, p.last, p.shift]).toEqual([3, 5, -1]);
	});

	it('substitutes new text (with its own line count) for the preview', () => {
		const p = probeFile(text, 2, 'X \\\nY');
		expect(p.text.split('\n').slice(2, 4)).toEqual(['X \\', 'Y']);
		expect([p.first, p.last]).toEqual([3, 4]);
	});

	it('keeps CRs (a backslash before CRLF is not a continuation, as in files.c)', () => {
		const p = probeFile('A \\\r\nB\r\n', 1);
		expect(p.text.split('\n').slice(1, 3)).toEqual(expect.arrayContaining(['A \\\r']));
		expect([p.first, p.last]).toEqual([2, 2]);
	});

	it('parses reports', () => {
		expect(parseProbeReport('x\nFASTI-PROBE 1 2026-11-02 17:00 2026-11-03\n')).toEqual({
			valid: true,
			date: '2026-11-02',
			time: 1020,
			next: '2026-11-03'
		});
		expect(parseProbeReport('FASTI-PROBE 1 2026-11-02 0 2026-11-03')?.time).toBeNull();
		expect(parseProbeReport('FASTI-PROBE 0 0 0 1')?.valid).toBe(false);
		expect(parseProbeReport('nothing')).toBeNull();
		expect(parseNow('FASTI-PROBE 2026-10-28 9:05')).toEqual({ date: '2026-10-28', time: 545 });
	});
});

describe('calendar wrapper', () => {
	it('DOes the main entry by absolute path, file or directory', () => {
		expect(mainPath('reminders.rem')).toBe('/vault/reminders.rem');
		expect(mainPath('')).toBe('/vault');
		expect(calendarWrapper('dir').split('\n')[0]).toBe('DO /vault/dir');
	});
});

describe.skipIf(!engineBuilt)('omitted days through Remind', () => {
	async function omits(files: Record<string, string>, month: string, main = 'm.rem') {
		const engine = await nodeEngine();
		const r = (await runOp(engine, {
			op: 'calendarMonth',
			month,
			tz: 'UTC',
			vault: { main, files }
		})) as OpResults['calendarMonth'];
		expect(r.diagnostics).toEqual([]);
		return Object.fromEntries(r.month.days.filter((d) => d.omit).map((d) => [d.date, d.omit]));
	}

	it('tells weekly days off from dated holidays, in the context at the end of the main file', async () => {
		const files = {
			'm.rem': [
				'OMIT Fri',
				'OMIT 2026-03-03',
				'PUSH-OMIT-CONTEXT',
				'OMIT 2026-03-10', // popped again: not omitted at the end
				'POP-OMIT-CONTEXT',
				'OMIT 2026-03-13', // a Friday: weekly wins
				'REM 2 Mar 2026 MSG not an omit',
				''
			].join('\n')
		};
		expect(await omits(files, '2026-03')).toEqual({
			'2026-03-03': 'dated',
			'2026-03-06': 'weekly',
			'2026-03-13': 'weekly',
			'2026-03-20': 'weekly',
			'2026-03-27': 'weekly'
		});
	});

	it('sees a CLEAR-OMIT-CONTEXT left in force, ADDOMIT and OMIT … THROUGH', async () => {
		const files = {
			'm.rem':
				'OMIT Sat Sun\nCLEAR-OMIT-CONTEXT\nOMIT 30 Mar THROUGH 1 Apr\nREM Mon 1 Apr SCANFROM -7 ADDOMIT MSG x\n'
		};
		expect(await omits(files, '2026-04')).toEqual({
			'2026-04-01': 'dated',
			'2026-04-06': 'dated'
		});
	});

	it('works when the main entry is a directory', async () => {
		const files = { 'a.rem': 'OMIT Sun\n', 'b.rem': 'OMIT 2 Feb\n' };
		expect(await omits(files, '2026-02', '')).toEqual({
			'2026-02-01': 'weekly',
			'2026-02-02': 'dated',
			'2026-02-08': 'weekly',
			'2026-02-15': 'weekly',
			'2026-02-22': 'weekly'
		});
	});
});
