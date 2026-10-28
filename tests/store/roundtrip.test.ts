// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The byte-exact rule (docs/PLAN.md section 2): bytes in, the same bytes out.
 * Every fixture vault is loaded and saved with no edit, and every file gets
 * an edit and an undo; both give identical bytes, through IndexedDB, the
 * snapshot and the zip export.
 */
import { describe, expect, it } from 'vitest';
import {
	appendLines,
	insertLines,
	lineCount,
	markDone,
	replaceLines
} from '../../src/lib/lens/patch';
import { analyze } from '../../src/lib/lens/tokenize';
import { decodeText, encodeText } from '../../src/lib/store/text';
import { Vault } from '../../src/lib/store/vault';
import { zipVault } from '../../src/lib/store/zip';
import { FIXTURES, fixtureVaults, freshDb, readTree } from './helpers';
import { unzip } from './unzip';
import { join } from 'node:path';

/** Awkward files the fixtures may not cover. */
const EDGE: Record<string, Uint8Array> = {
	'crlf.rem': encodeText('# CRLF\r\nREM Mon MSG a\r\nREM TODO 1 MSG b\r\n'),
	'mixed.rem': encodeText('REM Mon MSG a\nREM Tue MSG b\r\nREM Wed MSG c'),
	'noeol.rem': encodeText('REM TODO 15 MSG no final newline'),
	'bom.rem': new Uint8Array([0xef, 0xbb, 0xbf, ...encodeText('REM TODO Fri MSG bom\n')]),
	'continued.rem': encodeText('REM Mon AT 9:00 \\\n    DURATION 1:00 \\\n    MSG long  one\n'),
	'cr-only.rem': encodeText('REM Mon MSG a\rREM Tue MSG b\r'),
	'blank.rem': new Uint8Array(),
	'newlines.rem': encodeText('\n\n\r\n'),
	'unicode.rem': encodeText('REM 1 Jan MSG Neujahr 🎉 — café\t\n'),
	'trailing.rem': encodeText('REM Mon MSG spaces   \n\t\n'),
	'dir/nested.rem': encodeText('INCLUDE ../x\n')
};

const decodeAll = (tree: Map<string, Uint8Array>) =>
	Object.fromEntries([...tree].map(([p, b]) => [p, decodeText(b, p)]));

/** An edit for a file: mark the first TODO done, else change a line, else append. */
function someEdit(text: string) {
	for (const L of analyze(text))
		if (L.rem?.todo) {
			const r = markDone(text, L.start, '2026-10-28');
			if (r) return r;
		}
	if (lineCount(text) > 2) return replaceLines(text, 1, 1, 'REM Sat MSG replaced');
	if (text.length > 0) return insertLines(text, 0, '# inserted');
	return appendLines(text, 'REM Sun MSG appended');
}

const vaults: [string, Map<string, Uint8Array>][] = [
	...fixtureVaults().map((name): [string, Map<string, Uint8Array>] => [
		name,
		readTree(join(FIXTURES, name))
	]),
	['edge cases', new Map(Object.entries(EDGE))]
];

describe.each(vaults)('byte-exact round trip: %s', (_name, tree) => {
	it('has files to test', () => {
		expect(tree.size).toBeGreaterThan(0);
	});

	it('load then save with no edit gives identical bytes', async () => {
		const db = await freshDb();
		const vault = await Vault.create(db, {
			name: _name,
			provider: 'browser',
			main: '',
			files: decodeAll(tree)
		});
		const stored = await vault.files();
		expect(Object.keys(stored).sort()).toEqual([...tree.keys()].sort());
		for (const [path, bytes] of tree) expect(encodeText(stored[path]!), path).toEqual(bytes);
		const snap = await vault.snapshot();
		for (const [path, bytes] of tree) expect(encodeText(snap.files[path]!), path).toEqual(bytes);
		const zipped = unzip(zipVault(stored));
		expect(zipped.size).toBe(tree.size);
		for (const [path, bytes] of tree) expect(zipped.get(path), path).toEqual(bytes);
	});

	it('an edit then undo gives identical bytes', async () => {
		const db = await freshDb();
		const vault = await Vault.create(db, {
			name: _name,
			provider: 'browser',
			main: '',
			files: decodeAll(tree)
		});
		const before = (await vault.snapshot()).hash;
		for (const path of tree.keys()) {
			const r = await vault.edit(path, someEdit, `Edit ${path}`);
			expect(r, path).not.toBeNull();
			expect(await vault.read(path)).not.toBe(decodeText(tree.get(path)!));
		}
		expect((await vault.snapshot()).hash).not.toBe(before);
		for (let i = 0; i < tree.size; i++) expect(await vault.undo()).not.toBeNull();
		const after = await vault.files();
		for (const [path, bytes] of tree) expect(encodeText(after[path]!), path).toEqual(bytes);
		expect((await vault.snapshot()).hash).toBe(before);
	});
});
