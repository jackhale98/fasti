// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	BOM,
	NotUtf8Error,
	byteOrder,
	decodeText,
	encodeText,
	textInfo
} from '../../src/lib/store/text';

describe('textInfo', () => {
	it('tells line endings apart', () => {
		expect(textInfo('a\nb\n')).toEqual({ eol: 'LF', finalNewline: true, bom: false });
		expect(textInfo('a\r\nb')).toEqual({ eol: 'CRLF', finalNewline: false, bom: false });
		expect(textInfo('a\r\nb\n').eol).toBe('mixed');
		expect(textInfo('one line').eol).toBe('none');
		expect(textInfo('').finalNewline).toBe(false);
		expect(textInfo('\r\n').eol).toBe('CRLF');
	});

	it('spots a byte-order mark', () => {
		expect(textInfo(`${BOM}REM Mon MSG x\n`).bom).toBe(true);
	});
});

describe('decodeText and encodeText', () => {
	it('keep every byte, BOM and CRs included', () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62, 0x0d, 0xc3, 0xa9]);
		const text = decodeText(bytes);
		expect(text).toBe('﻿a\r\nb\ré');
		expect(encodeText(text)).toEqual(bytes);
	});

	it('refuses bytes that are not UTF-8', () => {
		expect(() => decodeText(new Uint8Array([0x61, 0xff, 0x62]), 'x.rem')).toThrow(NotUtf8Error);
		expect(() => decodeText(new Uint8Array([0xc3]))).toThrow('Not UTF-8');
	});
});

describe('byteOrder', () => {
	it('sorts like strcmp on UTF-8 bytes', () => {
		const list = ['b.rem', 'B.rem', 'a.rem', 'é.rem', '\u{1F600}.rem', '�.rem', 'a.re'];
		expect([...list].sort(byteOrder)).toEqual([
			'B.rem',
			'a.re',
			'a.rem',
			'b.rem',
			'é.rem',
			'�.rem',
			'\u{1F600}.rem'
		]);
		expect(byteOrder('x', 'x')).toBe(0);
	});
});
