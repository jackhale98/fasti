// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The push protocol client (Mycelium's protocol, unchanged) against a fake
 * worker, and the service worker's push and notificationclick handlers
 * against a fake scope.
 */
import { describe, expect, it, vi } from 'vitest';
import { fromBase64Url, messageKeys, toBase64Url } from '../../src/lib/notify/encrypt';
import {
	deleteSchedule,
	sealAll,
	serverKey,
	uploadSchedule,
	type SubscriptionKeys
} from '../../src/lib/notify/push';
import { readPayload } from '../../src/lib/notify/payload';
import {
	FALLBACK,
	appUrl,
	installNotificationHandlers,
	type NotificationScope
} from '../../src/lib/notify/sw';

/** A browser-side subscription: its key pair and auth secret. */
async function browserSubscription() {
	const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits'
	])) as CryptoKeyPair;
	const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const sub: SubscriptionKeys = {
		endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
		keys: { p256dh: toBase64Url(p256dh), auth: toBase64Url(auth) }
	};
	return { sub, keys, p256dh, auth };
}

/** What the receiving browser does with one sealed message. */
async function open(
	payload: string,
	keys: CryptoKeyPair,
	p256dh: Uint8Array,
	auth: Uint8Array
): Promise<unknown> {
	const body = fromBase64Url(payload);
	const salt = body.slice(0, 16);
	const idlen = body[20]!;
	const asPublic = body.slice(21, 21 + idlen);
	const sender = await crypto.subtle.importKey(
		'raw',
		asPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const ecdh = new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, keys.privateKey, 256)
	);
	const { cek, nonce } = await messageKeys(ecdh, auth, p256dh, asPublic, salt);
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen))
	);
	return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

describe('push protocol', () => {
	it('reads the VAPID key from GET /push/key, and null when push is off or unreachable', async () => {
		const ok = vi.fn(async () => Response.json({ key: 'BKEY' }));
		expect(await serverKey('https://w.example/', ok)).toBe('BKEY');
		expect(ok).toHaveBeenCalledWith('https://w.example/push/key');
		const off = vi.fn(async () => new Response('Reminders are not set up', { status: 501 }));
		expect(await serverKey('https://w.example', off)).toBeNull();
		const down = vi.fn(async () => {
			throw new TypeError('offline');
		});
		expect(await serverKey('https://w.example', down)).toBeNull();
	});

	it('PUTs the list with each message sealed for this subscription', async () => {
		const { sub, keys, p256dh, auth } = await browserSubscription();
		let sent: { url: string; init: RequestInit } | null = null;
		const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			sent = { url: String(url), init: init! };
			return new Response(null, { status: 204 });
		});
		const payload = { id: 'a', title: 'Dentist', body: 'Today at 9:00am · m.rem', url: '' };
		await uploadSchedule('https://w.example', sub, [{ at: 1_800_000_000_000, payload }], fetchFn);
		expect(sent!.url).toBe('https://w.example/push/reminders');
		expect(sent!.init.method).toBe('PUT');
		const body = JSON.parse(sent!.init.body as string) as {
			endpoint: string;
			reminders: { at: number; payload: string }[];
		};
		expect(body.endpoint).toBe(sub.endpoint);
		expect(body.reminders).toHaveLength(1);
		expect(body.reminders[0]!.at).toBe(1_800_000_000_000);
		// The worker sees only base64url bytes; the browser reads the text back.
		expect(body.reminders[0]!.payload).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(body.reminders[0]!.payload).not.toContain('Dentist');
		expect(await open(body.reminders[0]!.payload, keys, p256dh, auth)).toEqual(payload);
	});

	it('sends at most 64 and says why the worker refused', async () => {
		const { sub } = await browserSubscription();
		const list = Array.from({ length: 70 }, (_, i) => ({
			at: i,
			payload: { id: String(i), title: 't', body: '', url: '' }
		}));
		let count = 0;
		await uploadSchedule('https://w.example', sub, list, async (_u, init) => {
			count = (JSON.parse(init!.body as string) as { reminders: unknown[] }).reminders.length;
			return new Response(null, { status: 204 });
		});
		expect(count).toBe(64);
		await expect(
			uploadSchedule(
				'https://w.example',
				sub,
				[],
				async () => new Response('Reminders reach at most 8 days ahead', { status: 400 })
			)
		).rejects.toThrow('(400: Reminders reach at most 8 days ahead)');
		await expect(sealAll({ endpoint: sub.endpoint }, [])).rejects.toThrow('no encryption keys');
	});

	it('DELETEs the list, ignoring a network failure', async () => {
		const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
		await deleteSchedule('https://w.example', 'https://fcm.googleapis.com/x', fetchFn);
		expect(fetchFn).toHaveBeenCalledWith('https://w.example/push/reminders', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/x' })
		});
		await deleteSchedule('https://w.example', 'x', async () => {
			throw new TypeError('offline');
		});
	});
});

describe('service worker handlers', () => {
	function fakeScope(windows: { url: string; focus: () => Promise<unknown> }[] = []) {
		const listeners = new Map<string, (event: Event) => void>();
		const shown: { title: string; options: NotificationOptions }[] = [];
		const opened: string[] = [];
		const scope: NotificationScope = {
			addEventListener: (type, listener) => listeners.set(type, listener),
			registration: {
				scope: 'https://fasti.example/app/',
				showNotification: async (title: string, options: NotificationOptions) => {
					shown.push({ title, options });
				}
			} as unknown as ServiceWorkerRegistration,
			clients: {
				matchAll: async () => windows,
				openWindow: async (url: string) => opened.push(url)
			}
		};
		installNotificationHandlers(scope);
		const fire = async (type: string, event: object) => {
			const waits: Promise<unknown>[] = [];
			listeners.get(type)!({
				...event,
				waitUntil: (p: Promise<unknown>) => waits.push(p)
			} as unknown as Event);
			await Promise.all(waits);
		};
		return { shown, opened, fire };
	}

	const data = (value: unknown) => ({ json: () => value, text: () => JSON.stringify(value) });

	it('shows the payload of a push, tagged with its occurrence', async () => {
		const { shown, fire } = fakeScope();
		await fire('push', { data: data({ id: 'o1', title: 'Dentist', body: '9:00am', url: '' }) });
		expect(shown).toHaveLength(1);
		expect(shown[0]!.title).toBe('Dentist');
		expect(shown[0]!.options.tag).toBe('o1');
		expect(shown[0]!.options.body).toBe('9:00am');
		expect((shown[0]!.options.data as { url: string }).url).toBe('https://fasti.example/app/');
	});

	it('always shows something, even for an empty or unreadable push (iOS)', async () => {
		const { shown, fire } = fakeScope();
		await fire('push', { data: null });
		await fire('push', {
			data: {
				json: () => {
					throw new SyntaxError('bad');
				},
				text: () => 'bad'
			}
		});
		await fire('push', { data: data({ nope: 1 }) });
		expect(shown.map((s) => s.title)).toEqual([FALLBACK.title, FALLBACK.title, FALLBACK.title]);
	});

	it('focuses an open Fasti window on click, or opens one', async () => {
		const focus = vi.fn(async () => undefined);
		const withWindow = fakeScope([{ url: 'https://fasti.example/app/month', focus }]);
		const notification = { close: vi.fn(), data: { url: 'https://fasti.example/app/' } };
		await withWindow.fire('notificationclick', { notification });
		expect(notification.close).toHaveBeenCalled();
		expect(focus).toHaveBeenCalled();
		expect(withWindow.opened).toEqual([]);

		const none = fakeScope([{ url: 'https://other.example/', focus }]);
		await none.fire('notificationclick', {
			notification: { close: vi.fn(), data: { url: 'https://fasti.example/app/settings' } }
		});
		expect(none.opened).toEqual(['https://fasti.example/app/settings']);
	});

	it('builds app URLs inside the scope and reads payloads strictly', () => {
		expect(appUrl('https://fasti.example/app/', '/settings')).toBe(
			'https://fasti.example/app/settings'
		);
		expect(appUrl('https://fasti.example', '')).toBe('https://fasti.example/');
		expect(readPayload({ title: 'a', body: 3 })).toEqual({ id: '', title: 'a', body: '', url: '' });
		expect(readPayload('x')).toBeNull();
	});
});
