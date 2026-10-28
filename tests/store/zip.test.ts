// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { encodeText } from '../../src/lib/store/text';
import { crc32, zip, zipVault } from '../../src/lib/store/zip';
import { unzip } from './unzip';

describe('crc32', () => {
	it('matches the standard check values', () => {
		expect(crc32(encodeText('123456789'))).toBe(0xcbf43926);
		expect(crc32(new Uint8Array())).toBe(0);
		expect(crc32(encodeText('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
	});
});

describe('zip', () => {
	it('writes an empty archive', () => {
		const z = zip([]);
		expect(z.length).toBe(22);
		expect(unzip(z).size).toBe(0);
	});

	it('round-trips names and bytes', () => {
		const files = {
			'b.rem': 'REM Mon MSG b\r\n',
			'a.rem': '﻿REM Tue MSG a',
			'dir/ü café.rem': 'é\n'
		};
		const z = zipVault(files);
		const back = unzip(z);
		expect([...back.keys()]).toEqual(['a.rem', 'b.rem', 'dir/ü café.rem']);
		for (const [k, v] of Object.entries(files)) expect(back.get(k)).toEqual(encodeText(v));
	});

	it('is deterministic', () => {
		const files = { 'x.rem': 'REM Mon MSG x\n' };
		expect(zipVault(files)).toEqual(zipVault({ ...files }));
		// The fixed timestamp: 1980-01-01 00:00 in the local header.
		const z = zipVault(files);
		const view = new DataView(z.buffer);
		expect(view.getUint16(10, true)).toBe(0);
		expect(view.getUint16(12, true)).toBe(0x21);
	});
});
