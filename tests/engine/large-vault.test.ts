// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The 2,000-line performance fixture (tests/fixtures/vaults/large/, made by
 * make-large-vault.mjs) runs clean through WASM. The timing budget is checked
 * in Chromium by perf-chromium.mjs; here the time is only reported.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { engineBuilt, runRemind, type MonthDescriptor } from './remind';

const dir = new URL('../fixtures/vaults/large/', import.meta.url);
const vault = Object.fromEntries(
	readdirSync(dir).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')])
);

describe.skipIf(!engineBuilt)('large fixture vault', () => {
	it('has 2,000 lines', () => {
		const lines = Object.values(vault).reduce((n, t) => n + t.split('\n').length - 1, 0);
		expect(lines).toBe(2000);
	});

	it('gives a 3-month calendar with no diagnostics', async () => {
		const r = await runRemind(vault, ['-ppp3', '-b2', '/vault/reminders.rem', '2026-10-01'], {
			env: { TZ: 'UTC' }
		});
		expect(r.stderr).toBe('');
		const months = JSON.parse(r.stdout) as MonthDescriptor[];
		expect(months.map((m) => m.entries.length)).toEqual([1967, 2039, 2114]);
		console.log(`large vault, 3-month -ppp in Node: ${r.ms.toFixed(0)} ms`);
	});
});
