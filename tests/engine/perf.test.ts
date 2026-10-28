// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Timing guard on the 2,000-line fixture (docs/engine.md, "Performance"):
 * the agenda, one calendar month, nextDates and preview, each through the
 * same operations the worker runs. Times are reported; the bounds are loose
 * regression guards for CI machines, not the budget itself.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runOp } from '../../src/lib/engine/ops';
import type { EngineRequest } from '../../src/lib/engine/protocol';
import type { Engine } from '../../src/lib/engine/run';
import type { NextDatesResult } from '../../src/lib/engine/types';
import { fixtureFiles, nodeEngine } from './harness';
import { engineBuilt } from './remind';

const vault = { main: 'reminders.rem', files: fixtureFiles('large') };
let engine: Engine;

async function median(req: EngineRequest, runs = 5): Promise<{ ms: number; value: unknown }> {
	const times: number[] = [];
	let value: unknown;
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		value = await runOp(engine, req);
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return { ms: times[Math.floor(runs / 2)]!, value };
}

describe.skipIf(!engineBuilt)('large fixture timings (Node, one thread)', () => {
	beforeAll(async () => {
		engine = await nodeEngine();
		await runOp(engine, { op: 'agenda', date: '2026-10-28', vault }); // warm up the JIT
	});

	it('agenda and one calendar month', async () => {
		const agenda = await median({ op: 'agenda', date: '2026-10-28', tz: 'UTC', vault });
		const month = await median({ op: 'calendarMonth', month: '2026-10', tz: 'UTC', vault }, 3);
		console.log(
			`large vault: agenda ${agenda.ms.toFixed(0)} ms, one calendar month ${month.ms.toFixed(0)} ms`
		);
		expect(agenda.ms).toBeLessThan(500);
		expect(month.ms).toBeLessThan(3000);
	});

	it('nextDates (6 dates) and preview, for a line early and late in the vault', async () => {
		// A yearly birthday in birthdays.rem (DOne second) and a weekly line in personal.rem (DOne last).
		const early = await median({
			op: 'nextDates',
			file: 'birthdays.rem',
			line: 300,
			from: '2026-10-28',
			tz: 'UTC',
			vault
		});
		const late = await median({
			op: 'nextDates',
			file: 'personal.rem',
			line: 601,
			from: '2026-10-28',
			tz: 'UTC',
			vault
		});
		expect((early.value as NextDatesResult).dates).toHaveLength(6);
		expect((late.value as NextDatesResult).dates).toHaveLength(6);
		const preview = await median({
			op: 'preview',
			file: 'personal.rem',
			line: 600,
			newText: 'REM Mon Wed Fri AT 7:30 MSG Run',
			from: '2026-10-28',
			tz: 'UTC',
			vault
		});
		const dates = (preview.value as NextDatesResult).dates;
		expect(dates).toHaveLength(6);
		expect(dates[0]).toEqual({ date: '2026-10-28', time: 450 });
		console.log(
			`large vault: nextDates early ${early.ms.toFixed(0)} ms, late ${late.ms.toFixed(0)} ms; ` +
				`preview late ${preview.ms.toFixed(0)} ms (6 dates each)`
		);
		expect(late.ms).toBeLessThan(1500);
		expect(preview.ms).toBeLessThan(1500);
	});
});
