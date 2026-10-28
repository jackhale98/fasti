// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine's result cache: keyed by (engine build, vault hash, main entry,
 * request, options), in memory and in IndexedDB, so a repeated view or a
 * reload shows Remind's earlier answer at once and only a changed vault (or
 * changed options) runs Remind again.
 */
import type { IDBPDatabase } from 'idb';
import buildInfo from '../../../engine/BUILD-INFO.json';
import type { EngineOp } from './protocol.ts';

/**
 * Part of every key: the engine build (a new remind.wasm or parser gives new
 * answers) and this cache's own format version.
 */
export const CACHE_VERSION = `2:${buildInfo.remindWasmSha256.slice(0, 16)}`;

/** Op fields with defaults, so `{}` and `{ mondayFirst: false }` share a key. */
const DEFAULTS: Record<string, unknown> = {
	mondayFirst: false,
	hideCompletedTodos: false,
	tz: '',
	count: 6
};

/** Sorted-key JSON of a request, with defaults dropped. */
function canonical(op: EngineOp): string {
	const entries = Object.entries(op)
		.filter(([k, v]) => v !== undefined && DEFAULTS[k] !== v)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify(entries);
}

/**
 * The cache key of a request on a vault, or null when the answer depends on
 * the clock (no explicit date), so it must not be cached.
 */
export function cacheKey(vault: { hash: string; main: string }, op: EngineOp): string | null {
	const clockFree =
		op.op === 'calendarMonth' ||
		(op.op === 'agenda' && op.date !== undefined) ||
		(op.op === 'diagnostics' && op.date !== undefined) ||
		((op.op === 'nextDates' || op.op === 'preview') && op.from !== undefined);
	if (!clockFree) return null;
	return `${CACHE_VERSION}|${vault.hash}|${JSON.stringify(vault.main)}|${canonical(op)}`;
}

/** Somewhere to keep results across reloads. */
export interface PersistentStore {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
}

/** Memory first, then an optional persistent store. */
export class ResultCache {
	readonly #memory = new Map<string, unknown>();
	readonly #limit: number;
	readonly #store: PersistentStore | null;

	constructor(options: { limit?: number; store?: PersistentStore | null } = {}) {
		this.#limit = options.limit ?? 300;
		this.#store = options.store ?? null;
	}

	/** The cached value, or undefined. A persistent hit is copied into memory. */
	async get(key: string): Promise<unknown> {
		if (this.#memory.has(key)) {
			const value = this.#memory.get(key);
			// Re-insert: Map order is the LRU order.
			this.#memory.delete(key);
			this.#memory.set(key, value);
			return value;
		}
		if (!this.#store) return undefined;
		try {
			const value = await this.#store.get(key);
			if (value !== undefined) this.#remember(key, value);
			return value;
		} catch {
			return undefined;
		}
	}

	/** The value in memory only (synchronous), or undefined. */
	peek(key: string): unknown {
		return this.#memory.get(key);
	}

	set(key: string, value: unknown): void {
		this.#remember(key, value);
		// Persisting is best effort; a full or blocked store only loses speed.
		this.#store?.set(key, value).catch(() => {});
	}

	#remember(key: string, value: unknown): void {
		this.#memory.delete(key);
		this.#memory.set(key, value);
		while (this.#memory.size > this.#limit) {
			const oldest = this.#memory.keys().next().value as string;
			this.#memory.delete(oldest);
		}
	}
}

const DB_NAME = 'fasti-engine-cache';
const STORE = 'results';

interface Row {
	key: string;
	value: unknown;
	/** Insertion counter (not a date), for evicting the oldest rows. */
	seq: number;
}

/**
 * An IndexedDB store via idb, or null where IndexedDB is unavailable (Node,
 * private modes that refuse it). Keeps at most `limit` rows.
 */
export function indexedDbStore(limit = 1000): PersistentStore | null {
	if (typeof indexedDB === 'undefined') return null;
	let db: Promise<IDBPDatabase> | undefined;
	let seq = 0;
	let writes = 0;
	const open = () =>
		(db ??= import('idb').then(({ openDB }) =>
			openDB(DB_NAME, 1, {
				upgrade(d) {
					d.createObjectStore(STORE, { keyPath: 'key' }).createIndex('seq', 'seq');
				}
			})
		));
	return {
		async get(key) {
			const row = (await (await open()).get(STORE, key)) as Row | undefined;
			return row?.value;
		},
		async set(key, value) {
			const d = await open();
			if (!seq) {
				const cursor = await d.transaction(STORE).store.index('seq').openCursor(null, 'prev');
				seq = ((cursor?.value as Row | undefined)?.seq ?? 0) + 1;
			}
			await d.put(STORE, { key, value, seq: seq++ } satisfies Row);
			if (++writes % 50 !== 0) return;
			const count = await d.count(STORE);
			if (count <= limit) return;
			const tx = d.transaction(STORE, 'readwrite');
			let extra = count - limit;
			for (let c = await tx.store.index('seq').openCursor(); c && extra > 0; extra--) {
				await c.delete();
				c = await c.continue();
			}
			await tx.done;
		}
	};
}
