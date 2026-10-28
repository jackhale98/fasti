// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers: an in-memory IndexedDB (fake-indexeddb, a dev-only
 * dependency that never ships), a fresh database per test, and the fixture
 * vaults read as raw bytes.
 */
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFastiDB, type FastiDB } from '../../src/lib/store/db';

let n = 0;

/** A new, empty database. */
export function freshDb(): Promise<FastiDB> {
	return openFastiDB(`fasti-test-${process.pid}-${++n}`);
}

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vaults');

/** Every file under `dir`, as vault paths and raw bytes. */
export function readTree(dir: string): Map<string, Uint8Array> {
	const out = new Map<string, Uint8Array>();
	const walk = (d: string) => {
		for (const name of readdirSync(d).sort()) {
			const full = join(d, name);
			if (statSync(full).isDirectory()) walk(full);
			else out.set(relative(dir, full).split('\\').join('/'), new Uint8Array(readFileSync(full)));
		}
	};
	walk(dir);
	return out;
}

/** The fixture vault directories. */
export function fixtureVaults(): string[] {
	return readdirSync(FIXTURES)
		.filter((name) => statSync(join(FIXTURES, name)).isDirectory())
		.sort();
}
