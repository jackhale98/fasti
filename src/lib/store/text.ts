// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Bytes to text and back without changing a byte.
 *
 * A vault file is UTF-8. It is decoded with `fatal: true` (a file that isn't
 * valid UTF-8 is refused rather than silently repaired) and `ignoreBOM: true`
 * (a byte-order mark stays in the text as U+FEFF, so encoding the text gives
 * back the same bytes). Line endings are never touched. Remind itself does not
 * skip a BOM, so the engine sees exactly what desktop Remind would.
 */

export type LineEnding = 'LF' | 'CRLF' | 'mixed' | 'none';

/** What the store records about a file's text, for display and for new lines. */
export interface TextInfo {
	/** The line endings used: one kind, a mix, or none (a single line). */
	eol: LineEnding;
	/** Whether the text ends with a line break. */
	finalNewline: boolean;
	/** Whether the text starts with a UTF-8 byte-order mark (U+FEFF). */
	bom: boolean;
}

export const BOM = '﻿';

/** Line-ending kind, final newline and BOM of a text. */
export function textInfo(text: string): TextInfo {
	let lf = 0;
	let crlf = 0;
	for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
		if (i > 0 && text[i - 1] === '\r') crlf++;
		else lf++;
	}
	return {
		eol: lf && crlf ? 'mixed' : crlf ? 'CRLF' : lf ? 'LF' : 'none',
		finalNewline: text.endsWith('\n'),
		bom: text.startsWith(BOM)
	};
}

/** The bytes are not valid UTF-8. */
export class NotUtf8Error extends Error {
	constructor(readonly path?: string) {
		super(path ? `${path} is not UTF-8 text` : 'Not UTF-8 text');
	}
}

/** Decode a file's bytes exactly: a BOM is kept and line endings are left alone. */
export function decodeText(bytes: Uint8Array | ArrayBuffer, path?: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		throw new NotUtf8Error(path);
	}
}

/** Encode a text as the UTF-8 bytes it was decoded from. */
export function encodeText(text: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(text);
}

/**
 * Compare two strings by Unicode code point, which is UTF-8 byte order: the
 * order of `strcmp` and of glob(3) in the C locale, so the order Remind reads
 * a directory's files in.
 */
export function byteOrder(a: string, b: string): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n;) {
		const x = a.codePointAt(i)!;
		const y = b.codePointAt(i)!;
		if (x !== y) return x < y ? -1 : 1;
		i += x > 0xffff ? 2 : 1;
	}
	return a.length - b.length;
}
