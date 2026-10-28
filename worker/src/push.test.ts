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
		put: async (k, v) => void data.set(k, structuredClone(v)),
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
				{ endpoint: ENDPOINT, reminders: Array(65).fill({ at: now + 1, payload: 'a' }) },
				now
			)
		).toMatch(/at most 64/i);
		expect(one({ at: now + 9 * 86_400_000, payload: 'a' })).toMatch(/8 days/);
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
		expect(headers.get('ttl')).toBe('300');
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
		expect(idle.alarm()).toBe(now + 14 * 86_400_000);
		vi.setSystemTime(now + 15 * 86_400_000);
		await b.alarm();
		expect(idle.data.size).toBe(0);
	});
});

describe('/push routes', () => {
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
