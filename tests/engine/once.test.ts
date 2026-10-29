// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * ONCE is ignored (every run passes -o): the engine writes the vault afresh for
 * each run, so without -o Remind would take a ONCE reminder as already issued
 * on its real today and leave it out.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runOp } from '../../src/lib/engine/ops';
import type { OpResults } from '../../src/lib/engine/protocol';
import type { Engine } from '../../src/lib/engine/run';
import { nodeEngine } from './harness';
import { engineBuilt } from './remind';

const vault = {
	main: 'reminders.rem',
	files: { 'reminders.rem': 'REM ONCE AT 15:00 MSG Water the plants\n' }
};

describe.skipIf(!engineBuilt)('ONCE', () => {
	let engine: Engine;
	beforeAll(async () => {
		// Remind's real today, so ONCE would apply without -o.
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-28T12:00:00Z') });
		engine = await nodeEngine();
	});
	afterAll(() => {
		vi.useRealTimers();
	});

	it("is in the agenda on Remind's real today", async () => {
		const r = (await runOp(engine, {
			op: 'agenda',
			date: '2026-10-28',
			tz: 'UTC',
			vault
		} as never)) as OpResults['agenda'];
		expect(JSON.stringify(r)).toContain('Water the plants');
	});
});
