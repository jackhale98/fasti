// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from Mycelium (github.com/jackhale98/mycelium-web) under the owner's grant
// in THIRD_PARTY_NOTICES.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import {
	isPushEndpoint,
	readSchedule,
	PushQueue,
	vapidAuthorization,
	type DurableObjectNamespace,
	type DurableObjectStorage
} from './push';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const b64url = (b: Uint8Array) =>
	btoa(String.fromCharCode(...b))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
const unb64url = (t: string) =>
	Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function vapidKeys() {
	const { publicKey, privateKey } = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify']
	);
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
	const { d } = await crypto.subtle.exportKey('jwk', privateKey);
	return { VAPID_PUBLIC_KEY: b64url(raw), VAPID_PRIVATE_KEY: d!, publicKey };
}

/** An in-memory Durable Object storage. */
function memoryStorage() {
	const data = new Map<string, unknown>();
	let alarm: number | null = null;
	const storage: DurableObjectStorage = {
		get: async <T>(k: string) => data.get(k) as T | undefined,
		put: async (k: string | Record<string, unknown>, v?: unknown) => {
			if (typeof k === 'string') data.set(k, structuredClone(v));
			else {
				const keys = Object.keys(k);
				if (keys.length > 128) throw new Error('too many keys');
				for (const key of keys) data.set(key, structuredClone(k[key]));
			}
		},
		delete: async (keys: string[]) => {
			if (keys.length > 128) throw new Error('too many keys');
			return keys.filter((k) => data.delete(k)).length;
		},
		list: async <T>(o: { prefix?: string; start?: string; end?: string; limit?: number }) => {
			const keys = [...data.keys()]
				.filter(
					(k) =>
						(o.prefix === undefined || k.startsWith(o.prefix)) &&
						(o.start === undefined || k >= o.start) &&
						(o.end === undefined || k < o.end)
				)
				.sort()
				.slice(0, o.limit);
			return new Map(keys.map((k) => [k, structuredClone(data.get(k)) as T]));
		},
		transaction: async (f) => f(storage),
		deleteAll: async () => data.clear(),
		setAlarm: async (at) => void (alarm = at),
		deleteAlarm: async () => void (alarm = null)
	};
	return { storage, data, alarm: () => alarm };
}

describe('push addresses', () => {
	it('accepts only browser push services over HTTPS', () => {
		for (const ok of [
			ENDPOINT,
			'https://updates.push.services.mozilla.com/wpush/v2/x',
			'https://web.push.apple.com/QAbc',
			'https://wns2-par02p.notify.windows.com/w/?token=x'
		])
			expect(isPushEndpoint(ok), ok).toBe(true);
		for (const bad of [
			'http://fcm.googleapis.com/x',
			'https://evil.example/fcm.googleapis.com',
			'https://fcm.googleapis.com.evil.example/x',
			'https://fcm.googleapis.com:8443/x',
			'https://169.254.169.254/',
			42
		])
			expect(isPushEndpoint(bad), String(bad)).toBe(false);
	});
});

describe('readSchedule', () => {
	const now = Date.UTC(2026, 9, 28, 8);
	it('keeps future reminders in order and drops past ones', () => {
		const r = readSchedule(
			{
				endpoint: ENDPOINT,
				reminders: [
					{ at: now + 3_600_000, payload: 'bbb' },
					{ at: now - 3_600_000, payload: 'old' },
					{ at: now + 60_000, payload: 'aaa' }
				]
			},
			now
		);
		expect(r).toEqual({
			endpoint: ENDPOINT,
			reminders: [
				{ at: now + 60_000, payload: 'aaa' },
				{ at: now + 3_600_000, payload: 'bbb' }
			]
		});
	});

	it('refuses too many, too far ahead, too long or malformed', () => {
		const one = (r: object) => readSchedule({ endpoint: ENDPOINT, reminders: [r] }, now);
		expect(
			readSchedule(
				{ endpoint: ENDPOINT, reminders: Array(513).fill({ at: now + 1, payload: 'a' }) },
				now
			)
		).toMatch(/at most 512/i);
		expect(one({ at: now + 33 * 86_400_000, payload: 'a' })).toMatch(/32 days/);
		expect(one({ at: now + 1, payload: 'a'.repeat(6000) })).toMatch(/too long/);
		expect(one({ at: now + 1, payload: 'not base64!' })).toMatch(/message/);
		expect(one({ at: 'soon', payload: 'a' })).toMatch(/time/);
		expect(readSchedule({ endpoint: 'https://evil.example/', reminders: [] }, now)).toMatch(
			/push address/
		);
	});
});

describe('VAPID', () => {
	it('signs a JWT for the push service that its public key verifies', async () => {
		const keys = await vapidKeys();
		const header = await vapidAuthorization(ENDPOINT, keys, Date.UTC(2026, 9, 28));
		const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
		expect(k).toBe(keys.VAPID_PUBLIC_KEY);
		const [h, c, sig] = jwt!.split('.');
		const claims = JSON.parse(new TextDecoder().decode(unb64url(c!)));
		expect(claims.aud).toBe('https://fcm.googleapis.com');
		expect(claims.exp).toBe(Date.UTC(2026, 9, 28) / 1000 + 12 * 3600);
		expect(
			await crypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				keys.publicKey,
				unb64url(sig!),
				new TextEncoder().encode(`${h}.${c}`)
			)
		).toBe(true);
	});
});

describe('PushQueue', () => {
	it('sends what is due, then sleeps until the next one', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const keys = await vapidKeys();
		const queue = new PushQueue({ storage: mem.storage }, keys);
		await queue.fetch(
			new Request('https://queue/', {
				method: 'PUT',
				body: JSON.stringify({
					endpoint: ENDPOINT,
					reminders: [
						{ at: now + 1000, payload: 'AQID' },
						{ at: now + 3_600_000, payload: 'BAUG' }
					]
				})
			})
		);
		expect(mem.alarm()).toBe(now + 1000);

		const sent: { url: string; init: RequestInit }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				sent.push({ url, init });
				return new Response(null, { status: 201 });
			})
		);
		await queue.alarm();
		expect(sent).toHaveLength(1);
		expect(sent[0]!.url).toBe(ENDPOINT);
		const headers = new Headers(sent[0]!.init.headers);
		expect(headers.get('content-encoding')).toBe('aes128gcm');
		expect(headers.get('authorization')).toMatch(/^vapid t=/);
		expect(headers.get('ttl')).toBe('10800');
		expect(headers.get('urgency')).toBe('high');
		expect([...(sent[0]!.init.body as Uint8Array)]).toEqual([1, 2, 3]);
		expect(mem.alarm()).toBe(now + 3_600_000);
	});

	it('forgets a subscription the browser dropped, and an abandoned list', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const keys = await vapidKeys();
		const put = (q: PushQueue) =>
			q.fetch(
				new Request('https://queue/', {
					method: 'PUT',
					body: JSON.stringify({ endpoint: ENDPOINT, reminders: [{ at: now, payload: 'AQ' }] })
				})
			);

		const gone = memoryStorage();
		const a = new PushQueue({ storage: gone.storage }, keys);
		await put(a);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 410 }))
		);
		await a.alarm();
		expect(gone.data.size).toBe(0);

		const idle = memoryStorage();
		const b = new PushQueue({ storage: idle.storage }, keys);
		await b.fetch(
			new Request('https://queue/', {
				method: 'PUT',
				body: JSON.stringify({ endpoint: ENDPOINT, reminders: [] })
			})
		);
		expect(idle.alarm()).toBe(now + 40 * 86_400_000);
		vi.setSystemTime(now + 41 * 86_400_000);
		await b.alarm();
		expect(idle.data.size).toBe(0);
	});
});

describe('PushQueue failures', () => {
	const setup = async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		await queue.fetch(
			new Request('https://queue/', {
				method: 'PUT',
				body: JSON.stringify({ endpoint: ENDPOINT, reminders: [{ at: now, payload: 'AQ' }] })
			})
		);
		return { now, mem, queue };
	};

	it.each([400, 403, 404, 410])('forgets the list when the push service answers %i', async (s) => {
		const { mem, queue } = await setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: s }))
		);
		await queue.alarm();
		expect(mem.data.size).toBe(0);
	});

	it.each([0, 429, 503])(
		'retries at +1, +5, +15, +60 minutes after %i, then gives up',
		async (s) => {
			const { now, mem, queue } = await setup();
			const fetch = vi.fn(async () => {
				if (s === 0) throw new Error('network');
				return new Response(null, { status: s });
			});
			vi.stubGlobal('fetch', fetch);
			await queue.alarm();
			let calls = 1;
			expect(fetch).toHaveBeenCalledTimes(calls);
			for (const minutes of [1, 5, 15, 60]) {
				expect(mem.alarm()).toBe(now + minutes * 60_000);
				vi.setSystemTime(now + minutes * 60_000);
				await queue.alarm();
				expect(fetch).toHaveBeenCalledTimes(++calls);
			}
			expect([...mem.data.keys()]).toEqual(['meta']);
			expect(mem.alarm()).toBe(now + 40 * 86_400_000);
		}
	);

	it('does not retry once the message would be stale', async () => {
		const { now, mem, queue } = await setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 503 }))
		);
		// The alarm fired late: the message's three hours are nearly over.
		vi.setSystemTime(now + 10_800_000 - 30_000);
		await queue.alarm();
		expect([...mem.data.keys()]).toEqual(['meta']);
	});
});

describe('PushQueue storage', () => {
	const putAll = (queue: PushQueue, reminders: object[]) =>
		queue.fetch(
			new Request('https://queue/', {
				method: 'PUT',
				body: JSON.stringify({ endpoint: ENDPOINT, reminders })
			})
		);

	it('stores 512 reminders one key each, in time order, and replaces them on PUT', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		const payload = 'A'.repeat(5462);
		const reminders = Array.from({ length: 512 }, (_, i) => ({
			at: now + (512 - i) * 60_000,
			payload
		}));
		const r = readSchedule({ endpoint: ENDPOINT, reminders }, now);
		expect(typeof r).toBe('object');
		await putAll(queue, (r as { reminders: object[] }).reminders);
		expect(mem.data.size).toBe(513);
		expect(mem.data.get('meta')).toEqual({ endpoint: ENDPOINT, updated: now, gen: now });
		const keys = [...mem.data.keys()].filter((k) => k.startsWith('r:')).sort();
		expect(keys).toHaveLength(512);
		expect(mem.data.get(keys[0]!)).toEqual({ at: now + 60_000, payload });
		expect(mem.alarm()).toBe(now + 60_000);

		await putAll(queue, [{ at: now + 5000, payload: 'AQ' }]);
		expect(mem.data.size).toBe(2);
		expect(mem.alarm()).toBe(now + 5000);
	});

	it('sends only what is due and re-arms for the next', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		await putAll(queue, [
			{ at: now, payload: 'AQ' },
			{ at: now, payload: 'Ag' },
			{ at: now + 20_000, payload: 'Aw' },
			{ at: now + 31_000, payload: 'BA' },
			{ at: now + 86_400_000, payload: 'BQ' }
		]);
		const fetch = vi.fn(async () => new Response(null, { status: 201 }));
		vi.stubGlobal('fetch', fetch);
		await queue.alarm();
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(mem.data.size).toBe(3);
		expect(mem.alarm()).toBe(now + 31_000);
	});

	it('sends at most 40 per run and re-arms at once while more are due', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		await putAll(
			queue,
			Array.from({ length: 120 }, (_, i) => ({ at: now + i, payload: 'AQ' }))
		);
		const fetch = vi.fn(async () => new Response(null, { status: 201 }));
		vi.stubGlobal('fetch', fetch);
		for (const left of [80, 40, 0]) {
			await queue.alarm();
			expect(mem.data.size).toBe(left + 1);
			expect(fetch).toHaveBeenCalledTimes(120 - left);
			if (left) expect(mem.alarm()).toBeLessThanOrEqual(Date.now());
		}
	});

	it('does not resend what was sent before a crash', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		await putAll(queue, [
			{ at: now, payload: 'AQ' },
			{ at: now + 1, payload: 'Ag' },
			{ at: now + 2, payload: 'Aw' }
		]);
		let n = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				if (++n === 2) throw new Error('boom');
				return new Response(null, { status: 201 });
			})
		);
		// Crash right after the second send's key is handled: make delete fail then.
		const del = mem.storage.delete;
		let deletes = 0;
		mem.storage.delete = async (k) => {
			if (++deletes === 2) throw new Error('crash');
			return del(k);
		};
		await expect(queue.alarm()).rejects.toThrow('crash');
		mem.storage.delete = del;
		// The first is gone; the second (status 0 -> retry key) and third remain.
		const fetch = vi.fn(async () => new Response(null, { status: 201 }));
		vi.stubGlobal('fetch', fetch);
		await queue.alarm();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('a PUT during a send leaves the new schedule intact', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		await putAll(queue, [{ at: now, payload: 'AQ' }]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				vi.setSystemTime(now + 1);
				await putAll(queue, [{ at: now + 3_600_000, payload: 'Ag' }]);
				return new Response(null, { status: 503 });
			})
		);
		await queue.alarm();
		const keys = [...mem.data.keys()].filter((k) => k.startsWith('r:'));
		expect(keys).toHaveLength(1);
		expect(mem.data.get(keys[0]!)).toEqual({ at: now + 3_600_000, payload: 'Ag' });
		expect(mem.alarm()).toBe(now + 3_600_000);
	});

	it('gives a retry only the TTL that is left', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 9), toFake: ['Date'] });
		const now = Date.now();
		const mem = memoryStorage();
		const queue = new PushQueue({ storage: mem.storage }, await vapidKeys());
		await putAll(queue, [{ at: now, payload: 'AQ' }]);
		const ttls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_u: string, init: RequestInit) => {
				ttls.push(new Headers(init.headers).get('ttl')!);
				return new Response(null, { status: 503 });
			})
		);
		await queue.alarm();
		vi.setSystemTime(now + 60_000);
		await queue.alarm();
		expect(ttls).toEqual(['10800', '10740']);
	});

	it('refuses an oversized chunked body', async () => {
		const env: Env = {
			ALLOWED_ORIGINS: 'https://app.example',
			...(await vapidKeys()),
			REMINDERS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null) }) }
		};
		const chunk = new Uint8Array(1024 * 1024).fill(32);
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(c) {
				if (sent++ < 10) c.enqueue(chunk);
				else c.close();
			}
		});
		const res = await worker.fetch(
			new Request('https://proxy.example/push/reminders', {
				method: 'PUT',
				headers: { Origin: 'https://app.example' },
				body,
				duplex: 'half'
			} as RequestInit),
			env
		);
		expect(res.status).toBe(413);
		expect(sent).toBeLessThan(10);
	});

	it('refuses oversized bodies', async () => {
		const env: Env = {
			ALLOWED_ORIGINS: 'https://app.example',
			...(await vapidKeys()),
			REMINDERS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null) }) }
		};
		const res = await worker.fetch(
			new Request('https://proxy.example/push/reminders', {
				method: 'PUT',
				headers: { Origin: 'https://app.example' },
				body: ' '.repeat(3 * 1024 * 1024 + 1)
			}),
			env
		);
		expect(res.status).toBe(413);
	});
});

describe('/push routes', () => {
	it('limits PUT /push/reminders per client when a rate limit is bound', async () => {
		const keys = await vapidKeys();
		const seen: string[] = [];
		let allow = false;
		const env: Env = {
			ALLOWED_ORIGINS: 'https://app.example',
			...keys,
			REMINDERS: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null) }) },
			PUSH_RATE_LIMIT: {
				limit: async ({ key }) => (seen.push(key), { success: allow })
			}
		};
		const put = () =>
			worker.fetch(
				new Request('https://proxy.example/push/reminders', {
					method: 'PUT',
					headers: { Origin: 'https://app.example', 'CF-Connecting-IP': '203.0.113.9' },
					body: JSON.stringify({ endpoint: ENDPOINT, reminders: [] })
				}),
				env
			);
		expect((await put()).status).toBe(429);
		expect(seen).toEqual(['203.0.113.9']);
		allow = true;
		expect((await put()).status).toBe(204);
	});

	const ORIGIN = 'https://app.example';
	const base: Env = { ALLOWED_ORIGINS: ORIGIN };
	const req = (path: string, init: RequestInit = {}) =>
		new Request(`https://proxy.example${path}`, {
			...init,
			headers: { Origin: ORIGIN, ...(init.headers as object) }
		});

	it('says so when reminders are not set up', async () => {
		expect((await worker.fetch(req('/push/key'), base)).status).toBe(501);
	});

	it('hands out the public key and stores schedules under a hash of the address', async () => {
		const keys = await vapidKeys();
		const names: string[] = [];
		const bodies: unknown[] = [];
		const ns: DurableObjectNamespace = {
			idFromName: (name) => (names.push(name), name),
			get: () => ({
				fetch: async (r: Request) => {
					bodies.push(r.method === 'PUT' ? await r.json() : r.method);
					return new Response(null, { status: 204 });
				}
			})
		};
		const env: Env = { ...base, ...keys, REMINDERS: ns };
		const key = await worker.fetch(req('/push/key'), env);
		expect(await key.json()).toEqual({ key: keys.VAPID_PUBLIC_KEY });
		expect(key.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

		const at = Date.now() + 60_000;
		const put = await worker.fetch(
			req('/push/reminders', {
				method: 'PUT',
				body: JSON.stringify({ endpoint: ENDPOINT, reminders: [{ at, payload: 'AQ' }] })
			}),
			env
		);
		expect(put.status).toBe(204);
		expect(names[0]).not.toContain('fcm');
		expect(bodies[0]).toEqual({ endpoint: ENDPOINT, reminders: [{ at, payload: 'AQ' }] });

		const bad = await worker.fetch(
			req('/push/reminders', {
				method: 'PUT',
				body: JSON.stringify({ endpoint: 'https://evil.example/', reminders: [] })
			}),
			env
		);
		expect(bad.status).toBe(400);
		const del = await worker.fetch(
			req('/push/reminders', { method: 'DELETE', body: JSON.stringify({ endpoint: ENDPOINT }) }),
			env
		);
		expect(del.status).toBe(204);
		expect(bodies.at(-1)).toBe('DELETE');
	});
});
