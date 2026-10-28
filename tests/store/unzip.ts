// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A minimal reader for store-only zips, for tests: walks the central
 * directory, checks each local header agrees, and verifies CRCs.
 */
import { crc32 } from '../../src/lib/store/zip';

export function unzip(zip: Uint8Array): Map<string, Uint8Array> {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const eocd = zip.length - 22;
	if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error('No end of central directory');
	const count = view.getUint16(eocd + 10, true);
	let pos = view.getUint32(eocd + 16, true);
	const out = new Map<string, Uint8Array>();
	const dec = new TextDecoder('utf-8', { fatal: true });
	for (let i = 0; i < count; i++) {
		if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('Bad central header');
		const flags = view.getUint16(pos + 8, true);
		const method = view.getUint16(pos + 10, true);
		const crc = view.getUint32(pos + 16, true);
		const size = view.getUint32(pos + 24, true);
		const nameLen = view.getUint16(pos + 28, true);
		const extra = view.getUint16(pos + 30, true);
		const comment = view.getUint16(pos + 32, true);
		const local = view.getUint32(pos + 42, true);
		const name = dec.decode(zip.subarray(pos + 46, pos + 46 + nameLen));
		if (method !== 0 || !(flags & 0x0800)) throw new Error(`${name}: not stored UTF-8`);
		if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Bad local header');
		const localName = dec.decode(
			zip.subarray(local + 30, local + 30 + view.getUint16(local + 26, true))
		);
		if (localName !== name) throw new Error('Local and central names differ');
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const data = zip.slice(start, start + size);
		if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
		out.set(name, data);
		pos += 46 + nameLen + extra + comment;
	}
	return out;
}
