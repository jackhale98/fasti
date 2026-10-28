// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { MAX_NESTING, discover, resolvePath } from '../../src/lib/store/discover';

const codes = (files: Record<string, string>, main: string) =>
	discover(files, main).diagnostics.map((d) => [d.path, d.line, d.code]);

describe('resolvePath', () => {
	it('normalises inside the vault', () => {
		expect(resolvePath('', 'a.rem')).toBe('a.rem');
		expect(resolvePath('sub', 'a.rem')).toBe('sub/a.rem');
		expect(resolvePath('sub/deeper', '../x/./y.rem')).toBe('sub/x/y.rem');
		expect(resolvePath('', 'dir//f.rem')).toBe('dir/f.rem');
		expect(resolvePath('', 'dir/')).toBe('dir');
		expect(resolvePath('', '/vault/a.rem')).toBe('a.rem');
		expect(resolvePath('sub', '/vault')).toBe('');
	});

	it('returns null outside the vault', () => {
		expect(resolvePath('', '../a.rem')).toBeNull();
		expect(resolvePath('sub', '../../a.rem')).toBeNull();
		expect(resolvePath('', '/home/me/.reminders')).toBeNull();
		expect(resolvePath('', '/vaulty/a.rem')).toBeNull();
	});
});

describe('discover', () => {
	it('resolves DO against the including file and INCLUDE against the root', () => {
		const files = {
			'main.rem': 'DO sub/a.rem\n',
			'sub/a.rem': 'DO b.rem\nINCLUDE c.rem\n',
			'sub/b.rem': 'REM Mon MSG b\n',
			'c.rem': 'REM Tue MSG c\n',
			'sub/c.rem': 'REM Wed MSG not this one\n',
			'unused.rem': ''
		};
		const d = discover(files, 'main.rem');
		expect(d.read).toEqual(['main.rem', 'sub/a.rem', 'sub/b.rem', 'c.rem']);
		expect(d.diagnostics).toEqual([]);
	});

	it('reads a directory: its *.rem files in byte order, no subfolders or dotfiles', () => {
		const files = {
			'm.rem': 'INCLUDE "my dir"\n',
			'my dir/b.rem': '',
			'my dir/a.rem': '',
			'my dir/Z.rem': '',
			'my dir/.hidden.rem': '',
			'my dir/notes.txt': '',
			'my dir/sub/c.rem': ''
		};
		expect(discover(files, 'm.rem').read).toEqual([
			'm.rem',
			'my dir/Z.rem',
			'my dir/a.rem',
			'my dir/b.rem'
		]);
	});

	it('takes a directory as the main entry, the root included', () => {
		const files = { 'b.rem': 'DO x/y.rem\n', 'a.rem': '', 'x/y.rem': '', 'x/z.rem': '' };
		expect(discover(files, '').read).toEqual(['a.rem', 'b.rem', 'x/y.rem']);
		expect(discover(files, 'x').read).toEqual(['x/y.rem', 'x/z.rem']);
	});

	it('reports a missing main entry or an empty directory', () => {
		expect(codes({ 'a.rem': '' }, 'b.rem')).toEqual([['b.rem', 0, 'main-missing']]);
		expect(codes({ 'a.txt': '' }, '')).toEqual([['', 0, 'main-missing']]);
		expect(codes({ 'm.rem': 'INCLUDE d\n', 'd/x.txt': '' }, 'm.rem')).toEqual([
			['m.rem', 0, 'empty-dir']
		]);
	});

	it('flags targets outside the vault, missing targets, SYSINCLUDE and INCLUDECMD', () => {
		const text = [
			'# header',
			'DO ../outside.rem',
			'INCLUDE /etc/passwd',
			'DO nowhere.rem',
			'SYSINCLUDE holidays/us.rem',
			'INCLUDECMD cat x.rem',
			'INCLUDE -',
			'INCLUDE [filedir()]/x.rem',
			''
		].join('\n');
		const d = discover({ 'm.rem': text }, 'm.rem');
		expect(d.diagnostics.map((x) => [x.line, x.code, x.severity])).toEqual([
			[1, 'outside', 'error'],
			[2, 'outside', 'error'],
			[3, 'missing', 'error'],
			[4, 'sysinclude', 'warning'],
			[5, 'includecmd', 'warning'],
			[6, 'stdin', 'warning'],
			[7, 'computed', 'info']
		]);
		// Offsets point at the target in the file.
		const missing = d.diagnostics[2]!;
		expect(text.slice(missing.from, missing.to)).toBe('nowhere.rem');
		const cmd = d.diagnostics[4]!;
		expect(text.slice(cmd.from, cmd.to)).toBe('INCLUDECMD');
	});

	it('maps continued lines and CRLF files to file offsets', () => {
		const text = 'REM Mon \\\nMSG x\r\nDO \\\n  gone.rem\r\n';
		const [d] = discover({ 'm.rem': text }, 'm.rem').diagnostics;
		expect(d!.line).toBe(2);
		expect(text.slice(d!.from, d!.to)).toBe('gone.rem');
	});

	it('stops at __EOF__', () => {
		const d = discover({ 'm.rem': 'REM Mon MSG a\n__EOF__\nDO gone.rem\n' }, 'm.rem');
		expect(d.diagnostics).toEqual([]);
	});

	it('reports cycles instead of looping', () => {
		const files = { 'a.rem': 'DO b.rem\n', 'b.rem': 'DO a.rem\nDO b.rem\n' };
		expect(discover(files, 'a.rem').read).toEqual(['a.rem', 'b.rem']);
		expect(codes(files, 'a.rem')).toEqual([
			['b.rem', 0, 'cycle'],
			['b.rem', 1, 'cycle']
		]);
	});

	it('reports nesting deeper than Remind allows', () => {
		const files: Record<string, string> = {};
		for (let i = 0; i <= MAX_NESTING + 1; i++) files[`f${i}.rem`] = `DO f${i + 1}.rem\n`;
		files[`f${MAX_NESTING + 2}.rem`] = '';
		const d = discover(files, 'f0.rem');
		expect(d.read).toHaveLength(MAX_NESTING + 1);
		expect(d.diagnostics.map((x) => [x.path, x.code])).toEqual([[`f${MAX_NESTING}.rem`, 'depth']]);
	});

	it('warns about a byte-order mark', () => {
		expect(codes({ 'm.rem': '﻿REM Mon MSG x\n' }, 'm.rem')).toEqual([['m.rem', 0, 'bom']]);
	});

	it('follows includes in every IF branch, each file once', () => {
		const files = {
			'm.rem': 'IF today() > 0\nDO a.rem\nELSE\nDO b.rem\nENDIF\nDO a.rem\n',
			'a.rem': '',
			'b.rem': ''
		};
		expect(discover(files, 'm.rem').read).toEqual(['m.rem', 'a.rem', 'b.rem']);
	});
});
