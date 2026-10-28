// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Byte-exact helpers for the Script editor.
 *
 * CodeMirror's document always uses \n. For a CRLF file the editor maps
 * CRLF to \n on the way in and back on the way out, which is lossless because
 * every break in the file is CRLF. Saving turns the difference between the stored text and the
 * document into one edit: the changed middle, found by trimming the common
 * start and end. Everything outside that range keeps its bytes.
 */
import type { Edit } from '#lib/lens/types.ts';
import { textInfo } from '#lib/store/text.ts';

/** The line ending of a stored text, or null when it mixes endings (or has a lone CR) and must not be edited here. */
export function separatorFor(text: string): '\n' | '\r\n' | null {
	const { eol } = textInfo(text);
	// A lone CR would be a line break to CodeMirror: leave such files alone.
	if (eol === 'mixed' || /\r(?!\n)/.test(text)) return null;
	return eol === 'CRLF' ? '\r\n' : '\n';
}

/** The smallest single edit turning `before` into `after`, or null when they are equal. */
export function diffEdit(before: string, after: string): Edit | null {
	if (before === after) return null;
	const max = Math.min(before.length, after.length);
	let start = 0;
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
	let end = 0;
	while (
		end < max - start &&
		before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
	)
		end++;
	return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}
