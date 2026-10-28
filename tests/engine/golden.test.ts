// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Golden tests: the engine's typed results for the fixture vaults, pinned in
 * tests/engine/golden/. Regenerate only deliberately (`npx vitest run
 * tests/engine/golden.test.ts -u`) and review the diff: every date in them
 * comes from Remind.
 */
import { format, resolveConfig } from 'prettier';
import { beforeAll, describe, expect, it } from 'vitest';
import { runOp } from '../../src/lib/engine/ops';
import type { EngineOp, OpResults } from '../../src/lib/engine/protocol';
import type { Engine } from '../../src/lib/engine/run';
import type { CalendarMonth, ReminderEntry } from '../../src/lib/engine/types';
import { fixtureFiles, nodeEngine } from './harness';
import { engineBuilt } from './remind';

let engine: Engine;
const edge = { main: 'reminders.rem', files: fixtureFiles('edge') };
const large = { main: 'reminders.rem', files: fixtureFiles('large') };

async function run<K extends EngineOp['op']>(
	vault: typeof edge,
	op: Extract<EngineOp, { op: K }>
): Promise<OpResults[K]> {
	return (await runOp(engine, { ...op, vault } as never)) as OpResults[K];
}

/** Golden files leave out `raw` (Remind's own keys), which the parse tests cover. */
const lean = (entry: ReminderEntry): Omit<ReminderEntry, 'raw'> => {
	const { raw, ...rest } = entry;
	void raw;
	return rest;
};
const leanMonth = (m: CalendarMonth) => ({
	...m,
	days: m.days.map((d) => ({ ...d, entries: d.entries.map(lean) }))
});
/** JSON as Prettier formats it, so `npm run format` leaves the golden files alone. */
const json = async (v: unknown) =>
	format(JSON.stringify(v, null, '\t'), {
		...(await resolveConfig(new URL('golden/x.json', import.meta.url).pathname)),
		parser: 'json'
	});

describe.skipIf(!engineBuilt)('golden: edge vault', () => {
	beforeAll(async () => {
		engine = await nodeEngine();
	});

	it('agenda for 2026-11-05 08:00', async () => {
		const r = await run(edge, { op: 'agenda', date: '2026-11-05', time: '08:00', tz: 'UTC' });
		await expect(await json({ ...r, entries: r.entries.map(lean) })).toMatchFileSnapshot(
			'golden/edge-agenda-2026-11-05.json'
		);
	});

	for (const month of ['2026-11', '2026-12']) {
		it(`calendar ${month}`, async () => {
			const r = await run(edge, { op: 'calendarMonth', month, tz: 'UTC' });
			await expect(
				await json({ month: leanMonth(r.month), diagnostics: r.diagnostics })
			).toMatchFileSnapshot(`golden/edge-calendar-${month}.json`);
		});
	}

	it('leaves RUN reminders out of the calendar and dedupes diagnostics', async () => {
		const r = await run(edge, { op: 'calendarMonth', month: '2026-11', tz: 'UTC' });
		const all = r.month.days.flatMap((d) => d.entries);
		expect(all.some((e) => e.file === 'reminders.rem' && e.line === 26)).toBe(false);
		// One per day plus one in Remind's output; one after deduplication.
		expect(r.diagnostics).toEqual([
			{ file: 'reminders.rem', line: 27, message: "Ill-formed time: `25:99'", warning: false }
		]);
		expect(r.month.days).toHaveLength(30);
		expect(r.month.days.filter((d) => d.omit === 'dated').map((d) => d.date)).toEqual([
			'2026-11-11',
			'2026-11-20',
			'2026-11-26'
		]);
	});

	it('calendar 2026-11, Monday first, completed TODOs hidden', async () => {
		const r = await run(edge, {
			op: 'calendarMonth',
			month: '2026-11',
			mondayFirst: true,
			hideCompletedTodos: true,
			tz: 'UTC'
		});
		await expect(
			await json({ month: leanMonth(r.month), diagnostics: r.diagnostics })
		).toMatchFileSnapshot('golden/edge-calendar-2026-11-monday-hide.json');
	});

	it('next dates of a few lines', async () => {
		const lines: Record<string, unknown> = {};
		for (const [file, line] of [
			['reminders.rem', 9], // continuation (middle line)
			['reminders.rem', 12], // weekly Standup
			['reminders.rem', 13], // AFTER
			['reminders.rem', 15], // SKIP on holidays
			['reminders.rem', 19], // inside a cleared OMIT context
			['reminders.rem', 23], // overdue TODO
			['reminders.rem', 27], // error line
			['reminders.rem', 28], // SATISFY
			['reminders.rem', 4], // not a REM
			['sub/work.rem', 3],
			['sub/more.rem', 4] // after __EOF__
		] as const) {
			lines[`${file}:${line}`] = await run(edge, {
				op: 'nextDates',
				file,
				line,
				from: '2026-11-01',
				tz: 'UTC'
			});
		}
		await expect(await json(lines)).toMatchFileSnapshot('golden/edge-next-dates.json');
	});
});

describe.skipIf(!engineBuilt)('golden: large vault', () => {
	beforeAll(async () => {
		engine = await nodeEngine();
	});

	it('agenda for 2026-10-28', async () => {
		const r = await run(large, { op: 'agenda', date: '2026-10-28', tz: 'UTC' });
		expect(r.diagnostics).toEqual([]);
		await expect(await json({ ...r, entries: r.entries.map(lean) })).toMatchFileSnapshot(
			'golden/large-agenda-2026-10-28.json'
		);
	});

	it('calendar 2026-10: entry counts per day and omitted days', async () => {
		const r = await run(large, { op: 'calendarMonth', month: '2026-10', tz: 'UTC' });
		expect(r.diagnostics).toEqual([]);
		const days = r.month.days.map(
			(d) => `${d.date} ${d.weekday} ${d.omit ?? '-'} ${d.entries.length}`
		);
		await expect(await json(days)).toMatchFileSnapshot('golden/large-calendar-2026-10-days.json');
		// The spike's 3-month count for October (large-vault.test.ts).
		expect(r.month.days.reduce((n, d) => n + d.entries.length, 0)).toBe(1967);
	});
});
