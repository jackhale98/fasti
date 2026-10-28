// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine client against real engine workers (worker.ts in Node worker
 * threads): typed results, month-first calendars, supersession and abort,
 * in-flight sharing, the cache (including a simulated reload), and the 3 s
 * timeout that replaces a runaway worker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ResultCache, type PersistentStore } from '../../src/lib/engine/cache';
import {
	EngineAbortError,
	EngineClient,
	EngineError,
	EngineTimeoutError,
	addMonths,
	debounce
} from '../../src/lib/engine/client';
import { fixture, nodeClient, nodeWorker, snapshot } from './harness';
import { engineBuilt } from './remind';

const edge = fixture('edge');
const clients: EngineClient[] = [];
const track = <T extends EngineClient>(c: T): T => {
	clients.push(c);
	return c;
};

afterEach(() => {
	for (const c of clients.splice(0)) c.dispose();
});

describe('addMonths and debounce', () => {
	it('steps month labels across years', () => {
		expect(addMonths('2026-11', 0)).toBe('2026-11');
		expect(addMonths('2026-11', 2)).toBe('2027-01');
		expect(addMonths('2026-01', -1)).toBe('2025-12');
		expect(addMonths('2026-12', 13)).toBe('2028-01');
		expect(() => addMonths('2026-1', 1)).toThrow();
	});

	it('debounces at 120 ms by default, with flush and cancel', async () => {
		const calls: number[] = [];
		const d = debounce((n: number) => calls.push(n));
		d(1);
		d(2);
		await new Promise((r) => setTimeout(r, 60));
		d(3);
		expect(calls).toEqual([]);
		await new Promise((r) => setTimeout(r, 140));
		expect(calls).toEqual([3]);
		d(4);
		d.flush();
		expect(calls).toEqual([3, 4]);
		d(5);
		d.cancel();
		await new Promise((r) => setTimeout(r, 140));
		expect(calls).toEqual([3, 4]);
	});
});

describe.skipIf(!engineBuilt)('engine client on real workers', () => {
	it('returns a typed agenda', async () => {
		const client = track(nodeClient());
		const r = await client.agenda(edge, { date: '2026-11-05', time: '08:00', tz: 'UTC' });
		expect(r.banner).toBe('Reminders for Thursday, 5th November, 2026:');
		expect(r.entries.map((e) => `${e.date} ${e.file}:${e.line}-${e.lineEnd} ${e.body}`)).toEqual([
			'2026-11-05 reminders.rem:8-10 Long reminder     spanning three lines',
			'2026-11-04 reminders.rem:23-23 Overdue task',
			"2026-11-10 reminders.rem:25-25 Heads-up in 5 days' time"
		]);
		expect(r.diagnostics).toEqual([
			{ file: 'reminders.rem', line: 27, message: "Ill-formed time: `25:99'", warning: false }
		]);
	});

	it('computes a calendar month by month, in order, the first queued first', async () => {
		const client = track(nodeClient({ poolSize: 2 }));
		const seen: number[] = [];
		const r = await client.calendar(
			edge,
			{ month: '2026-11', months: 3, tz: 'UTC' },
			{ onMonth: (_m, i) => seen.push(i) }
		);
		expect(r.months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01']);
		expect(r.months.map((m) => m.days.length)).toEqual([30, 31, 31]);
		expect(seen.sort()).toEqual([0, 1, 2]);
		expect(r.diagnostics).toHaveLength(1);
		expect(client.workers).toBe(2);
	});

	it('nextDates and preview keep the real OMIT context', async () => {
		const client = track(nodeClient());
		const gym = await client.nextDates(edge, {
			file: 'reminders.rem',
			line: 15,
			count: 3,
			from: '2026-11-09',
			tz: 'UTC'
		});
		// Wednesday 11 November is Remembrance Day (holidays.rem), so SKIP drops it.
		expect(gym.dates.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-25', '2026-12-02']);
		const moved = await client.preview(edge, {
			file: 'reminders.rem',
			line: 15,
			newText: 'REM Wed AFTER MSG Gym (moved after holidays)',
			count: 2,
			from: '2026-11-09',
			tz: 'UTC'
		});
		expect(moved.dates.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-18']);
		const broken = await client.preview(edge, {
			file: 'reminders.rem',
			line: 15,
			newText: 'REM Wed AT 9:7x MSG oops',
			from: '2026-11-09',
			tz: 'UTC'
		});
		expect(broken.dates).toEqual([]);
		expect(broken.diagnostics.map((d) => [d.file, d.line])).toEqual([['reminders.rem', 15]]);
	});

	it("reports Remind's today", async () => {
		const client = track(nodeClient());
		const now = await client.now('UTC');
		expect(now.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(now.time).toBeGreaterThanOrEqual(0);
		expect(now.time).toBeLessThan(1440);
	});

	it('supersedes a queued request for the same view', async () => {
		const client = track(nodeClient({ poolSize: 1 }));
		const large = fixture('large');
		const busy = client.calendar(large, { month: '2026-10', tz: 'UTC' });
		const first = client.agenda(edge, { date: '2026-11-05', tz: 'UTC' }, { view: 'today' });
		const second = client.agenda(edge, { date: '2026-11-06', tz: 'UTC' }, { view: 'today' });
		await expect(first).rejects.toBeInstanceOf(EngineAbortError);
		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		expect((await second).banner).toContain('6th November');
		await busy;
	});

	it('drops a request whose signal aborts', async () => {
		const client = track(nodeClient({ poolSize: 1 }));
		const busy = client.calendar(fixture('large'), { month: '2026-10', tz: 'UTC' });
		const controller = new AbortController();
		const p = client.diagnostics(edge, { date: '2026-11-05' }, { signal: controller.signal });
		controller.abort();
		await expect(p).rejects.toBeInstanceOf(EngineAbortError);
		await busy;
	});

	it('shares one run between identical requests and caches the result', async () => {
		let posted = 0;
		const client = track(
			nodeClient({
				cache: new ResultCache(),
				createWorker: () => {
					const w = nodeWorker();
					const post = w.postMessage.bind(w);
					w.postMessage = (m) => {
						if (m.type === 'run') posted++;
						post(m);
					};
					return w;
				}
			})
		);
		const opts = { month: '2026-11', tz: 'UTC' };
		const [a, b] = await Promise.all([client.calendar(edge, opts), client.calendar(edge, opts)]);
		expect(a).toEqual(b);
		expect(posted).toBe(1);
		await client.calendar(edge, { ...opts, mondayFirst: false });
		expect(posted).toBe(1);
		await client.calendar(edge, { ...opts, mondayFirst: true });
		expect(posted).toBe(2);
		// A changed vault (new hash) runs again.
		const edited = snapshot({ ...edge.files, 'extra.rem': 'REM 1 MSG x\n' });
		await client.calendar(edited, opts);
		expect(posted).toBe(3);
		// Clock-dependent requests are never cached.
		await client.agenda(edge, { tz: 'UTC' });
		await client.agenda(edge, { tz: 'UTC' });
		expect(posted).toBe(5);
	});

	it('serves a reload from the persistent store without running Remind', async () => {
		const rows = new Map<string, unknown>();
		const store: PersistentStore = {
			get: async (k) => structuredClone(rows.get(k)),
			set: async (k, v) => void rows.set(k, structuredClone(v))
		};
		const first = track(nodeClient({ cache: new ResultCache({ store }) }));
		const r1 = await first.agenda(edge, { date: '2026-11-05', tz: 'UTC' });
		first.dispose();
		await new Promise((r) => setTimeout(r, 0));
		expect(rows.size).toBe(1);
		const second = track(nodeClient({ cache: new ResultCache({ store }) }));
		const r2 = await second.agenda(edge, { date: '2026-11-05', tz: 'UTC' });
		expect(r2).toEqual(r1);
		expect(second.spawned()).toBe(0);
	});

	it('reports a Remind failure as an EngineError', async () => {
		const client = track(nodeClient());
		await expect(
			client.nextDates(edge, { file: 'missing.rem', line: 1, from: '2026-11-01' })
		).rejects.toBeInstanceOf(EngineError);
	});

	it('terminates a runaway SATISFY after 3 s, names the file and respawns', async () => {
		const client = track(nodeClient({ poolSize: 1 }));
		const runaway = snapshot(
			{
				'main.rem': 'DO slow.rem\n',
				'slow.rem': 'REM SATISFY [nonomitted(trigdate(), trigdate() + 1000000) < 0] MSG never\n'
			},
			'main.rem'
		);
		const started = performance.now();
		const err = await client.agenda(runaway, { date: '2026-11-05' }).catch((e: unknown) => e);
		const waited = performance.now() - started;
		expect(err).toBeInstanceOf(EngineTimeoutError);
		expect((err as EngineTimeoutError).file).toBe('main.rem');
		expect((err as Error).message).toMatch(/longer than 3 s on main\.rem/);
		expect(waited).toBeGreaterThanOrEqual(2900);
		expect(waited).toBeLessThan(6000);
		// The next request gets a fresh worker.
		const ok = await client.agenda(edge, { date: '2026-11-05', tz: 'UTC' });
		expect(ok.entries.length).toBe(3);
		expect(client.spawned()).toBe(2);
		expect(client.workers).toBe(1);
	}, 15_000);
});
