// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	MAX_FILE_BYTES,
	exportZip,
	itemsFromDirectory,
	itemsFromFileList,
	readImport,
	type DirectoryHandleLike,
	type FileHandleLike
} from '../../src/lib/store/import';
import { encodeText } from '../../src/lib/store/text';
import { unzip } from './unzip';

const bytes = (s: string) => encodeText(s);

/** A File as `<input webkitdirectory>` gives it. */
function picked(rel: string, data: Uint8Array): File {
	const f = new File([data as Uint8Array<ArrayBuffer>], rel.split('/').pop()!);
	Object.defineProperty(f, 'webkitRelativePath', { value: rel });
	return f;
}

function dir(
	name: string,
	children: (FileHandleLike | DirectoryHandleLike)[]
): DirectoryHandleLike {
	return {
		kind: 'directory',
		name,
		async *values() {
			yield* children;
		}
	};
}
function file(name: string, data: Uint8Array): FileHandleLike {
	return {
		kind: 'file',
		name,
		getFile: async () => new File([data as Uint8Array<ArrayBuffer>], name)
	};
}

describe('readImport', () => {
	it('decodes exactly and reports what it skips', async () => {
		const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x52, 0x0d, 0x0a]);
		const r = await readImport([
			{ path: 'a.rem', blob: new Blob([bytes('REM Mon MSG a\r\n')]) },
			{ path: 'bom.rem', blob: new Blob([bom]) },
			{ path: 'bin.dat', blob: new Blob([new Uint8Array([0xff, 0xfe, 0x00])]) },
			{ path: '../x.rem', blob: new Blob(['x']) },
			{ path: 'big.rem', blob: new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]) }
		]);
		expect(r.files).toEqual({ 'a.rem': 'REM Mon MSG a\r\n', 'bom.rem': '﻿R\r\n' });
		expect(encodeText(r.files['bom.rem']!)).toEqual(bom);
		expect(r.skipped).toEqual([
			{ path: 'bin.dat', reason: 'not-utf8' },
			{ path: '../x.rem', reason: 'invalid-path' },
			{ path: 'big.rem', reason: 'too-large' }
		]);
	});
});

describe('itemsFromFileList', () => {
	it('drops the picked folder name and skips hidden folders', () => {
		const items = itemsFromFileList([
			picked('remind/reminders.rem', bytes('x')),
			picked('remind/sub/a.rem', bytes('y')),
			picked('remind/.git/config', bytes('z')),
			picked('remind/.reminders', bytes('w'))
		]);
		expect(items.map((i) => i.path)).toEqual(['reminders.rem', 'sub/a.rem', '.reminders']);
	});

	it('uses the file name for single files', () => {
		const f = new File(['x'], 'one.rem');
		expect(itemsFromFileList([f]).map((i) => i.path)).toEqual(['one.rem']);
	});
});

describe('itemsFromDirectory', () => {
	it('walks subfolders and skips hidden ones', async () => {
		const root = dir('remind', [
			file('main.rem', bytes('DO sub/a.rem\n')),
			dir('sub', [file('a.rem', bytes('REM Mon MSG a\n'))]),
			dir('.git', [file('HEAD', bytes('ref'))])
		]);
		const r = await readImport(await itemsFromDirectory(root));
		expect(r.files).toEqual({ 'main.rem': 'DO sub/a.rem\n', 'sub/a.rem': 'REM Mon MSG a\n' });
	});
});

describe('exportZip', () => {
	it('gives a zip blob with exact bytes', async () => {
		const blob = exportZip({ 'a.rem': 'x\r\n', 'b/c.rem': '﻿y' });
		expect(blob.type).toBe('application/zip');
		const back = unzip(new Uint8Array(await blob.arrayBuffer()));
		expect(back.get('a.rem')).toEqual(bytes('x\r\n'));
		expect(back.get('b/c.rem')).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, 0x79]));
	});
});
