// SPDX-License-Identifier: GPL-2.0-or-later
/** Cache keys and the memory/persistent result cache (cache.ts). */
import { describe, expect, it } from 'vitest';
import {
	CACHE_VERSION,
	ResultCache,
	cacheKey,
	type PersistentStore
} from '../../src/lib/engine/cache';

const vault = { hash: 'abc', main: 'reminders.rem' };

describe('cacheKey', () => {
	it('starts with the engine build and format version', () => {
		expect(CACHE_VERSION).toMatch(/^\d+:[0-9a-f]{16}$/);
		expect(cacheKey(vault, { op: 'calendarMonth', month: '2026-11' })).toMatch(
			new RegExp(`^${CACHE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|abc\\|`)
		);
	});

	it('ignores key order and options left at their defaults', () => {
		const a = cacheKey(vault, { op: 'calendarMonth', month: '2026-11', tz: 'UTC' });
		const b = cacheKey(vault, {
			tz: 'UTC',
			hideCompletedTodos: false,
			month: '2026-11',
			mondayFirst: false,
			op: 'calendarMonth'
		});
		expect(a).toBe(b);
		expect(cacheKey(vault, { op: 'nextDates', file: 'a', line: 1, from: '2026-01-01' })).toBe(
			cacheKey(vault, { op: 'nextDates', file: 'a', line: 1, from: '2026-01-01', count: 6 })
		);
	});

	it('differs for a different vault, main entry, request or option', () => {
		const base = cacheKey(vault, { op: 'calendarMonth', month: '2026-11' });
		const others = [
			cacheKey({ ...vault, hash: 'abd' }, { op: 'calendarMonth', month: '2026-11' }),
			cacheKey({ ...vault, main: '' }, { op: 'calendarMonth', month: '2026-11' }),
			cacheKey(vault, { op: 'calendarMonth', month: '2026-12' }),
			cacheKey(vault, { op: 'calendarMonth', month: '2026-11', mondayFirst: true }),
			cacheKey(vault, { op: 'calendarMonth', month: '2026-11', hideCompletedTodos: true }),
			cacheKey(vault, { op: 'calendarMonth', month: '2026-11', tz: 'Europe/Paris' }),
			cacheKey(vault, { op: 'agenda', date: '2026-11-01' })
		];
		expect(new Set([base, ...others]).size).toBe(others.length + 1);
		expect(
			cacheKey(vault, {
				op: 'preview',
				file: 'a',
				line: 1,
				from: '2026-01-01',
				newText: 'REM 1 MSG a'
			})
		).not.toBe(
			cacheKey(vault, {
				op: 'preview',
				file: 'a',
				line: 1,
				from: '2026-01-01',
				newText: 'REM 2 MSG a'
			})
		);
	});

	it('is null for answers that depend on the clock', () => {
		expect(cacheKey(vault, { op: 'agenda' })).toBeNull();
		expect(cacheKey(vault, { op: 'diagnostics' })).toBeNull();
		expect(cacheKey(vault, { op: 'nextDates', file: 'a', line: 1 })).toBeNull();
		expect(cacheKey(vault, { op: 'now' })).toBeNull();
		expect(cacheKey(vault, { op: 'agenda', date: '2026-11-01', time: '09:00' })).not.toBeNull();
	});
});

describe('ResultCache', () => {
	it('evicts the least recently used entry beyond its limit', async () => {
		const c = new ResultCache({ limit: 2 });
		c.set('a', 1);
		c.set('b', 2);
		expect(await c.get('a')).toBe(1); // a is now the most recent
		c.set('c', 3);
		expect(c.peek('b')).toBeUndefined();
		expect(c.peek('a')).toBe(1);
		expect(c.peek('c')).toBe(3);
	});

	it('writes through to the store and reads it back into memory', async () => {
		const rows = new Map<string, unknown>();
		const store: PersistentStore = {
			get: async (k) => rows.get(k),
			set: async (k, v) => void rows.set(k, v)
		};
		new ResultCache({ store }).set('k', { x: 1 });
		await Promise.resolve();
		const fresh = new ResultCache({ store });
		expect(fresh.peek('k')).toBeUndefined();
		expect(await fresh.get('k')).toEqual({ x: 1 });
		expect(fresh.peek('k')).toEqual({ x: 1 });
	});

	it('treats a failing store as a miss', async () => {
		const store: PersistentStore = {
			get: () => Promise.reject(new Error('blocked')),
			set: () => Promise.reject(new Error('full'))
		};
		const c = new ResultCache({ store });
		expect(await c.get('k')).toBeUndefined();
		expect(() => c.set('k', 1)).not.toThrow();
		expect(await c.get('k')).toBe(1);
	});
});
