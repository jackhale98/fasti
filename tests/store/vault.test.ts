// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { appendLines, markDone, replaceLines } from '../../src/lib/lens/patch';
import {
	DEFAULT_SETTINGS,
	getPush,
	getSettings,
	openFastiDB,
	setPush,
	updateSettings
} from '../../src/lib/store/db';
import {
	FileStateError,
	InvalidPathError,
	UNDO_LIMIT,
	UndoConflictError,
	Vault,
	snapshotHash
} from '../../src/lib/store/vault';
import { freshDb } from './helpers';

const FILES = {
	'main.rem': 'DO todo.rem\r\nREM Mon MSG Standup\r\n',
	'todo.rem': 'REM TODO 15 MSG Pay card %b'
};

async function make(files: Record<string, string> = FILES) {
	const db = await freshDb();
	const vault = await Vault.create(db, {
		name: 'Test',
		provider: 'browser',
		main: 'main.rem',
		files
	});
	return { db, vault };
}

describe('Vault files', () => {
	it('stores files with their line-ending facts', async () => {
		const { vault } = await make();
		expect(await vault.paths()).toEqual(['main.rem', 'todo.rem']);
		expect(await vault.files()).toEqual(FILES);
		const row = await vault.row('main.rem');
		expect(row).toMatchObject({
			eol: 'CRLF',
			finalNewline: true,
			bom: false,
			base: null,
			rev: null,
			dirty: true
		});
		expect(await vault.row('todo.rem')).toMatchObject({ eol: 'none', finalNewline: false });
		expect(await vault.read('nope.rem')).toBeNull();
	});

	it('persists across a reopened database', async () => {
		const name = `fasti-persist-${process.pid}`;
		const db1 = await openFastiDB(name);
		const v1 = await Vault.create(db1, {
			id: 'v',
			name: 'P',
			provider: 'browser',
			main: 'main.rem',
			files: FILES
		});
		await v1.edit('main.rem', (t) => replaceLines(t, 1, 1, 'REM Tue MSG Standup'), 'Move standup');
		db1.close();
		const db2 = await openFastiDB(name);
		const v2 = (await Vault.open(db2, 'v'))!;
		expect(await v2.read('main.rem')).toBe('DO todo.rem\r\nREM Tue MSG Standup\r\n');
		expect((await v2.history()).undo.map((s) => s.label)).toEqual(['Move standup']);
		await v2.undo();
		expect(await v2.read('main.rem')).toBe(FILES['main.rem']);
		db2.close();
	});

	it('rejects bad paths and main entries', async () => {
		const { vault } = await make();
		for (const p of ['', '/abs.rem', 'a//b.rem', '../x.rem', 'a/./b.rem', 'x/'])
			await expect(vault.createFile(p, '')).rejects.toThrow(InvalidPathError);
		await expect(vault.setMain('/x')).rejects.toThrow(InvalidPathError);
		expect((await vault.setMain('')).main).toBe('');
	});

	it('creates nothing when a seed path is bad', async () => {
		const db = await freshDb();
		await expect(
			Vault.create(db, {
				id: 'bad',
				name: 'B',
				provider: 'browser',
				main: '',
				files: { '../x': '' }
			})
		).rejects.toThrow(InvalidPathError);
		expect(await Vault.open(db, 'bad')).toBeNull();
	});

	it('never creates over an existing file', async () => {
		const { vault } = await make();
		await expect(vault.createFile('main.rem', 'x')).rejects.toThrow(FileStateError);
		expect(await vault.read('main.rem')).toBe(FILES['main.rem']);
		await expect(vault.edit('gone.rem', (t) => appendLines(t, 'x'))).rejects.toThrow(
			FileStateError
		);
	});

	it('lists vaults and destroys one with its files', async () => {
		const { db, vault } = await make();
		const other = await Vault.create(db, { name: 'O', provider: 'browser', main: '', files: {} });
		expect((await Vault.list(db)).map((v) => v.name).sort()).toEqual(['O', 'Test']);
		await Vault.destroy(db, vault.id);
		expect(await Vault.open(db, vault.id)).toBeNull();
		expect(await db.getAllFromIndex('files', 'vault', vault.id)).toEqual([]);
		expect(await Vault.open(db, other.id)).not.toBeNull();
		await expect(
			Vault.create(db, { id: other.id, name: 'X', provider: 'browser', main: '' })
		).rejects.toThrow();
	});
});

describe('edits and undo', () => {
	it('records each edit with its inverse and undoes to identical bytes', async () => {
		const { vault } = await make();
		const r = await vault.edit('todo.rem', (t) => markDone(t, 0, '2026-10-15'), 'Done');
		expect(r!.text).toBe('REM TODO 15 COMPLETE-THROUGH 2026-10-15 MSG Pay card %b');
		await vault.edit('main.rem', (t) => appendLines(t, 'REM Fri MSG Demo'), 'Add');
		expect(await vault.read('main.rem')).toBe(FILES['main.rem'] + 'REM Fri MSG Demo\r\n');
		expect((await vault.history()).undo.map((s) => s.label)).toEqual(['Done', 'Add']);

		expect((await vault.undo())!.label).toBe('Add');
		expect((await vault.undo())!.label).toBe('Done');
		expect(await vault.undo()).toBeNull();
		expect(await vault.files()).toEqual(FILES);

		expect((await vault.redo())!.label).toBe('Done');
		expect(await vault.read('todo.rem')).toBe(r!.text);
		expect((await vault.history()).redo.map((s) => s.label)).toEqual(['Add']);
	});

	it('a new edit clears redo, and a no-op edit records nothing', async () => {
		const { vault } = await make();
		await vault.edit('main.rem', (t) => appendLines(t, 'REM Sat MSG x'));
		await vault.undo();
		await vault.edit('main.rem', (t) => replaceLines(t, 0, 0, 'DO todo.rem'));
		await vault.edit('main.rem', () => null);
		const h = await vault.history();
		expect([h.undo.length, h.redo.length]).toEqual([0, 1]);
		await vault.edit('todo.rem', (t) => replaceLines(t, 0, 0, 'REM TODO 16 MSG Pay card %b'));
		expect((await vault.history()).redo).toEqual([]);
	});

	it('applies raw editor edits with their inverse', async () => {
		const { vault } = await make();
		const r = await vault.applyEdit('todo.rem', { from: 9, to: 11, insert: '20' }, 'Type');
		expect(r!.inverse).toEqual({ from: 9, to: 11, insert: '15' });
		expect(await vault.read('todo.rem')).toBe('REM TODO 20 MSG Pay card %b');
		await vault.undo();
		expect(await vault.read('todo.rem')).toBe(FILES['todo.rem']);
		await expect(vault.applyEdit('todo.rem', { from: 5, to: 999, insert: '' })).rejects.toThrow(
			RangeError
		);
	});

	it('undoes file creation and removal', async () => {
		const { vault } = await make();
		await vault.createFile('new.rem', 'REM Mon MSG new\n');
		await vault.removeFile('todo.rem');
		expect(await vault.paths()).toEqual(['main.rem', 'new.rem']);
		await vault.undo();
		await vault.undo();
		expect(await vault.files()).toEqual(FILES);
		await vault.redo();
		expect(await vault.read('new.rem')).toBe('REM Mon MSG new\n');
	});

	it('refuses to undo over a file changed since, leaving everything as it was', async () => {
		const { db, vault } = await make();
		await vault.edit('todo.rem', (t) => markDone(t, 0, '2026-10-15'), 'Done');
		// Another writer (a sync) changes the file without going through the undo history.
		const row = (await vault.row('todo.rem'))!;
		const changed = 'REM TODO 15 MSG Pay card %b\nREM Mon MSG from elsewhere\n';
		await db.put('files', { ...row, text: changed });
		await expect(vault.undo()).rejects.toThrow(UndoConflictError);
		expect(await vault.read('todo.rem')).toBe(changed);
		expect((await vault.history()).undo).toHaveLength(1);
	});

	it('keeps at most UNDO_LIMIT steps', async () => {
		const { vault } = await make({ 'main.rem': '' });
		for (let i = 0; i < UNDO_LIMIT + 5; i++)
			await vault.applyEdit('main.rem', { from: 0, to: 0, insert: 'x' });
		const h = await vault.history();
		expect(h.undo).toHaveLength(UNDO_LIMIT);
		await vault.clearHistory();
		expect((await vault.history()).undo).toEqual([]);
	});
});

describe('importing files', () => {
	it('adds new files, skips identical ones and never overwrites without consent', async () => {
		const { vault } = await make();
		const incoming = { 'main.rem': 'changed\n', 'todo.rem': FILES['todo.rem'], 'x/new.rem': 'n\n' };
		expect(await vault.plan(incoming)).toEqual({
			added: ['x/new.rem'],
			same: ['todo.rem'],
			conflicts: ['main.rem']
		});
		const plan = await vault.addFiles(incoming);
		expect(plan.conflicts).toEqual(['main.rem']);
		expect(await vault.read('main.rem')).toBe(FILES['main.rem']);
		expect(await vault.read('x/new.rem')).toBe('n\n');

		await vault.addFiles(incoming, 'Replace', ['main.rem']);
		expect(await vault.read('main.rem')).toBe('changed\n');
		await vault.undo();
		await vault.undo();
		expect(await vault.files()).toEqual(FILES);
	});
});

describe('snapshot', () => {
	it('matches the engine contract and hashes stably', async () => {
		const { vault } = await make();
		const s = await vault.snapshot();
		expect(s.main).toBe('main.rem');
		expect(s.files).toEqual(FILES);
		expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
		expect((await vault.snapshot()).hash).toBe(s.hash);
		// Order of insertion doesn't matter.
		const reversed = Object.fromEntries(Object.entries(FILES).reverse());
		expect(await snapshotHash('main.rem', reversed)).toBe(s.hash);
	});

	it('changes when any file or the main entry changes', async () => {
		const { vault } = await make();
		const seen = new Set([(await vault.snapshot()).hash]);
		await vault.applyEdit('todo.rem', { from: 0, to: 0, insert: ' ' });
		seen.add((await vault.snapshot()).hash);
		await vault.undo();
		expect(seen.has((await vault.snapshot()).hash)).toBe(true);
		await vault.setMain('todo.rem');
		seen.add((await vault.snapshot()).hash);
		await vault.createFile('empty.rem', '');
		seen.add((await vault.snapshot()).hash);
		expect(seen.size).toBe(4);
		// Moving text between path and contents is a different vault.
		expect(await snapshotHash('', { ab: 'c' })).not.toBe(await snapshotHash('', { a: 'bc' }));
		expect(await snapshotHash('', { a: '\r\n' })).not.toBe(await snapshotHash('', { a: '\n' }));
	});

	it('discovers from the stored main entry', async () => {
		const { vault } = await make();
		expect((await vault.discover()).read).toEqual(['main.rem', 'todo.rem']);
	});
});

describe('sync state', () => {
	it('tracks base, revision and dirty', async () => {
		const { vault } = await make();
		await vault.markSynced('todo.rem', FILES['todo.rem'], 'abc123');
		expect(await vault.row('todo.rem')).toMatchObject({
			base: FILES['todo.rem'],
			rev: 'abc123',
			dirty: false
		});
		await vault.applyEdit('todo.rem', { from: 0, to: 0, insert: '#' });
		expect(await vault.row('todo.rem')).toMatchObject({ rev: 'abc123', dirty: true });
		await vault.undo();
		expect((await vault.row('todo.rem'))!.dirty).toBe(false);
		expect(await vault.bases()).toEqual(
			new Map([['todo.rem', { rev: 'abc123', source: FILES['todo.rem'] }]])
		);
	});
});

describe('settings and push record', () => {
	it('defaults, then keeps what was set', async () => {
		const db = await freshDb();
		expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
		await updateSettings(db, { weekStart: 'monday', clock: '24h' });
		await updateSettings(db, { theme: 'dark', hideCompletedTodos: true });
		expect(await getSettings(db)).toEqual({
			...DEFAULT_SETTINGS,
			weekStart: 'monday',
			clock: '24h',
			theme: 'dark',
			hideCompletedTodos: true
		});
	});

	it('stores and clears the push subscription', async () => {
		const db = await freshDb();
		expect(await getPush(db)).toBeUndefined();
		const rec = {
			subscription: { endpoint: 'https://push.example/1' },
			vault: 'browser',
			createdAt: 1
		};
		await setPush(db, rec);
		expect(await getPush(db)).toEqual(rec);
		await setPush(db, null);
		expect(await getPush(db)).toBeUndefined();
	});
});
