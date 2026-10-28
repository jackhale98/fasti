// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Spike checks (docs/engine.md): DO, INCLUDE and directory includes resolve
 * inside MEMFS; Remind's file permission and uid checks don't block reading a
 * vault written 0600; -r disables everything that would run a command.
 */
import { describe, expect, it } from 'vitest';
import { engineBuilt, runRemind, type MonthDescriptor } from './remind';

async function bodies(files: Record<string, string>, main: string, month = '2026-10-01') {
	const r = await runRemind(files, ['-ppp1', main, month]);
	const entries = r.stdout
		? (JSON.parse(r.stdout) as MonthDescriptor[]).flatMap((m) => m.entries)
		: [];
	return { r, entries, list: entries.map((e) => `${e.filename}:${e.lineno} ${e.body}`) };
}

describe.skipIf(!engineBuilt)('includes in MEMFS', () => {
	// `filename` is the path Remind opened: DO joins the including file's
	// directory (absolute here); INCLUDE keeps a relative path as written,
	// relative to the working directory, /vault. The worker resolves both.
	it('DO is relative to the including file; INCLUDE to the working directory (/vault)', async () => {
		const { r, list } = await bodies(
			{
				'main.rem': 'DO sub/a.rem\nINCLUDE sub/c.rem\n',
				'sub/a.rem': 'REM 1 MSG a\nDO b.rem\n',
				'sub/b.rem': 'REM 1 MSG b\n',
				'sub/c.rem': 'REM 1 MSG c\n'
			},
			'/vault/main.rem'
		);
		expect(r.stderr).toBe('');
		expect(list).toEqual(['/vault/sub/a.rem:1 a', '/vault/sub/b.rem:1 b', 'sub/c.rem:1 c']);
	});

	it('INCLUDE of a directory reads its *.rem files in sorted order, skipping others', async () => {
		const { r, list } = await bodies(
			{
				'main.rem': 'INCLUDE dir\n',
				'dir/b.rem': 'REM 1 MSG b\n',
				'dir/a.rem': 'REM 1 MSG a\n',
				'dir/notes.txt': 'REM 1 MSG not a rem file\n',
				'dir/sub/c.rem': 'REM 1 MSG in a subdirectory\n'
			},
			'/vault/main.rem'
		);
		expect(r.stderr).toBe('');
		expect(list).toEqual(['dir/a.rem:1 a', 'dir/b.rem:1 b']);
	});

	it('the main entry can be a directory', async () => {
		const { r, list } = await bodies(
			{ 'b.rem': 'REM 1 MSG b\n', 'a.rem': 'REM 1 MSG a\nDO c.inc\n', 'c.inc': 'REM 1 MSG c\n' },
			'/vault'
		);
		expect(r.stderr).toBe('');
		expect(list).toEqual(['/vault/a.rem:1 a', '/vault/c.inc:1 c', '/vault/b.rem:1 b']);
	});

	it('a missing include is a diagnostic naming the file and line', async () => {
		const { r } = await bodies(
			{ 'main.rem': 'REM 1 MSG a\nINCLUDE nope.rem\n' },
			'/vault/main.rem'
		);
		expect(r.stderr).toMatch(/^\/vault\/main\.rem\(2\): .*nope\.rem/m);
	});
});

describe.skipIf(!engineBuilt)('permissions and uid in MEMFS', () => {
	it('reads files written 0600 (geteuid() is 0 and MEMFS files are uid 0)', async () => {
		const { r, list } = await bodies({ 'm.rem': 'REM 1 MSG ok\n' }, '/vault/m.rem');
		expect(r.code).toBe(0);
		expect(r.stderr).toBe('');
		expect(list).toEqual(['/vault/m.rem:1 ok']);
	});

	it("refuses a world-writable file (MEMFS's default 0666), so the vault must be chmod 0600", async () => {
		const r = await runRemind({}, ['-ppp1', '/tmp/open.rem', '2026-10-01'], {
			dirs: ['/tmp'],
			extraFiles: { '/tmp/open.rem': 'REM 1 MSG x\n' },
			modes: { '/tmp/open.rem': 0o666 }
		});
		expect(r.stderr).toContain("SECURITY: Won't read world-writable file or directory!");
	});

	it('refuses a world-writable directory entry', async () => {
		const r = await runRemind({ 'd/a.rem': 'REM 1 MSG x\n' }, ['-ppp1', '/vault/d', '2026-10-01'], {
			modes: { '/vault/d': 0o777 }
		});
		expect(r.stderr).toContain("SECURITY: Won't read world-writable file or directory!");
	});

	it('reads a group-writable file (only world-writable is refused, despite remind(1))', async () => {
		const r = await runRemind(
			{ 'm.rem': 'REM 1 MSG ok\n' },
			['-ppp1', '/vault/m.rem', '2026-10-01'],
			{
				modes: { '/vault/m.rem': 0o660 }
			}
		);
		expect(r.stderr).toBe('');
		expect(r.stdout).toContain('"body":"ok"');
	});
});

describe.skipIf(!engineBuilt)('-r', () => {
	it('RUN reminders, shell() and INCLUDECMD report "RUN disabled" and run nothing', async () => {
		const r = await runRemind(
			{
				'm.rem': 'REM RUN touch /vault/ran\nSET x shell("echo hi")\nINCLUDECMD echo REM MSG hi\n'
			},
			['-q', '/vault/m.rem', '2026-10-28@00:00']
		);
		expect(r.stderr.split('\n')).toEqual([
			'/vault/m.rem(1): RUN disabled',
			'/vault/m.rem(2): shell(): RUN disabled',
			'/vault/m.rem(3): RUN disabled'
		]);
	});
});
