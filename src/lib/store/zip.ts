// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A tiny store-only (uncompressed) zip writer for exporting a vault. Names
 * are UTF-8 (general-purpose flag bit 11), every entry carries the fixed
 * timestamp 1980-01-01 00:00 so the same files always give the same zip, and
 * there is no ZIP64: at most 65,535 entries and 4 GiB, far beyond a vault.
 * Format: PKWARE APPNOTE.TXT, sections 4.3.7 (local header), 4.3.12 (central
 * directory) and 4.3.16 (end of central directory).
 */
import type { VaultPath } from '../engine/types';
import { byteOrder, encodeText } from './text';

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

let table: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320), as zip uses. */
export function crc32(data: Uint8Array): number {
	if (!table) {
		table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

const UTF8_FLAG = 0x0800;
const VERSION = 20; // 2.0: needed for folders in names
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

/** Build a zip holding `entries`, uncompressed, in the given order. */
export function zip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
	if (entries.length > 0xffff) throw new RangeError('Too many files for a zip without ZIP64');
	const names = entries.map((e) => encodeText(e.name));
	let size = 22;
	entries.forEach((e, i) => (size += 30 + 46 + 2 * names[i]!.length + e.data.length));
	if (size > 0xffffffff) throw new RangeError('Too large for a zip without ZIP64');
	const out = new Uint8Array(new ArrayBuffer(size));
	const view = new DataView(out.buffer);
	let pos = 0;
	const u16 = (v: number) => {
		view.setUint16(pos, v, true);
		pos += 2;
	};
	const u32 = (v: number) => {
		view.setUint32(pos, v, true);
		pos += 4;
	};
	const bytes = (b: Uint8Array) => {
		out.set(b, pos);
		pos += b.length;
	};
	const offsets: number[] = [];
	const crcs = entries.map((e) => crc32(e.data));
	entries.forEach((e, i) => {
		offsets.push(pos);
		u32(0x04034b50);
		u16(VERSION);
		u16(UTF8_FLAG);
		u16(0); // stored
		u16(DOS_TIME);
		u16(DOS_DATE);
		u32(crcs[i]!);
		u32(e.data.length);
		u32(e.data.length);
		u16(names[i]!.length);
		u16(0);
		bytes(names[i]!);
		bytes(e.data);
	});
	const cdStart = pos;
	entries.forEach((e, i) => {
		u32(0x02014b50);
		u16(VERSION);
		u16(VERSION);
		u16(UTF8_FLAG);
		u16(0);
		u16(DOS_TIME);
		u16(DOS_DATE);
		u32(crcs[i]!);
		u32(e.data.length);
		u32(e.data.length);
		u16(names[i]!.length);
		u16(0); // extra
		u16(0); // comment
		u16(0); // disk
		u16(0); // internal attributes
		u32(0); // external attributes
		u32(offsets[i]!);
		bytes(names[i]!);
	});
	const cdSize = pos - cdStart;
	u32(0x06054b50);
	u16(0);
	u16(0);
	u16(entries.length);
	u16(entries.length);
	u32(cdSize);
	u32(cdStart);
	u16(0);
	return out;
}

/** A vault's files as a zip: each text encoded back to its exact bytes, paths in byte order. */
export function zipVault(files: Readonly<Record<VaultPath, string>>): Uint8Array<ArrayBuffer> {
	return zip(
		Object.keys(files)
			.sort(byteOrder)
			.map((name) => ({ name, data: encodeText(files[name]!) }))
	);
}
