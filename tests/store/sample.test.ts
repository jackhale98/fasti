// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, diagnostics } from '../../src/lib/lens/tokenize';
import { BROWSER_VAULT_ID, ensureBrowserVault, restoreSample } from '../../src/lib/store/browser';
import { getSettings, updateSettings } from '../../src/lib/store/db';
import { discover } from '../../src/lib/store/discover';
import { SAMPLE_FILES, SAMPLE_MAIN } from '../../src/lib/store/sample';
import { decodeText } from '../../src/lib/store/text';
import { FIXTURES, freshDb, readTree } from './helpers';

describe('sample vault', () => {
	it('is the same text as tests/fixtures/vaults/sample', () => {
		const tree = readTree(join(FIXTURES, 'sample'));
		expect(Object.fromEntries([...tree].map(([p, b]) => [p, decodeText(b)]))).toEqual(SAMPLE_FILES);
	});

	it('is clean for the lens and reads every file', () => {
		for (const [path, text] of Object.entries(SAMPLE_FILES))
			expect(diagnostics(analyze(text)), path).toEqual([]);
		const d = discover(SAMPLE_FILES, SAMPLE_MAIN);
		expect(d.read).toEqual(['reminders.rem', 'holidays.rem', 'birthdays.rem']);
		expect(d.diagnostics).toEqual([]);
	});

	it('computes no dates: every date in it is a literal', () => {
		// Nothing like `${...}` survived from the prototype's date arithmetic.
		for (const text of Object.values(SAMPLE_FILES)) expect(text).not.toMatch(/\$\{/);
	});
});

describe('browser vault', () => {
	it('is seeded once, becomes active, and keeps edits', async () => {
		const db = await freshDb();
		const v = await ensureBrowserVault(db);
		expect(v.id).toBe(BROWSER_VAULT_ID);
		expect(await v.files()).toEqual(SAMPLE_FILES);
		expect((await v.record()).main).toBe(SAMPLE_MAIN);
		expect((await getSettings(db)).activeVault).toBe(BROWSER_VAULT_ID);

		await v.applyEdit('birthdays.rem', { from: 0, to: 0, insert: '# mine\n' });
		const again = await ensureBrowserVault(db);
		expect(await again.read('birthdays.rem')).toBe('# mine\n' + SAMPLE_FILES['birthdays.rem']);
	});

	it('does not take over an active vault already chosen', async () => {
		const db = await freshDb();
		await updateSettings(db, { activeVault: 'other' });
		await ensureBrowserVault(db);
		expect((await getSettings(db)).activeVault).toBe('other');
	});

	it('restores the sample on request, undoably, keeping other files', async () => {
		const db = await freshDb();
		const v = await ensureBrowserVault(db);
		await v.applyEdit('reminders.rem', { from: 0, to: 1, insert: ';' });
		await v.createFile('mine.rem', 'REM Mon MSG mine\n');
		await v.setMain('mine.rem');
		await restoreSample(v);
		expect(await v.read('reminders.rem')).toBe(SAMPLE_FILES['reminders.rem']);
		expect(await v.read('mine.rem')).toBe('REM Mon MSG mine\n');
		expect((await v.record()).main).toBe(SAMPLE_MAIN);
		await v.undo();
		expect((await v.read('reminders.rem'))![0]).toBe(';');
	});
});
