// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from Mycelium (github.com/jackhale98/mycelium-web) under the owner's grant
// in THIRD_PARTY_NOTICES.md.
/// Reminders while the app is closed (Web Push), the one part of the worker
/// that keeps anything: for each browser push subscription, a short list of
/// "send this sealed message at this time", in its own Durable Object that
/// wakes itself (an alarm) when the next one is due.
///
/// - No accounts: a subscription is an anonymous push address made by the
///   browser; its list is found by a hash of that address.
/// - Nothing readable: each message is encrypted on the device for that same
///   device (RFC 8291) before it is sent here; this code only relays bytes.
/// - Little kept, not for long: at most 64 messages, 4 KB each, due within
///   8 days; a list nobody refreshes for 14 days deletes itself, and so does
///   one whose push address the browser has dropped.
/// - Pushes are signed with this worker's VAPID key (RFC 8292).

export interface PushEnv {
	REMINDERS?: DurableObjectNamespace;
	/** Base64url P-256 public key (uncompressed point), shared with browsers. */
	VAPID_PUBLIC_KEY?: string;
	/** Base64url private scalar `d` (a secret). */
	VAPID_PRIVATE_KEY?: string;
	/** Contact for push services: `mailto:…` or an https URL. */
	VAPID_SUBJECT?: string;
	/** Optional Cloudflare Rate Limiting binding for PUT /push/reminders; unlimited when absent. */
	PUSH_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

// Just enough of Cloudflare's Durable Object types for this file.
export interface DurableObjectNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): { fetch(request: Request): Promise<Response> };
}
export interface DurableObjectStorage {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	deleteAll(): Promise<void>;
	setAlarm(at: number): Promise<void>;
	deleteAlarm(): Promise<void>;
}
export interface DurableObjectState {
	storage: DurableObjectStorage;
}

export const MAX_REMINDERS = 64;
/** Base64url length of a 4 KB message (push services' limit). */
const MAX_PAYLOAD = 5462;
const HORIZON = 8 * 86_400_000;
const EXPIRY = 14 * 86_400_000;
/** Seconds a push service may hold a message (the TTL header). */
const TTL = 300;
const RETRY_AFTER = 60_000;
/** Push service answers that mean the address is gone or never was one. */
const DROPPED = [400, 403, 404, 410];

/** Browser push services; any other address is refused (no relaying elsewhere). */
const PUSH_SERVICES = [
	'fcm.googleapis.com',
	'updates.push.services.mozilla.com',
	'push.services.mozilla.com',
	'web.push.apple.com',
	'notify.windows.com'
];

export function isPushEndpoint(endpoint: unknown): endpoint is string {
	if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
	try {
		const u = new URL(endpoint);
		return (
			u.protocol === 'https:' &&
			!u.port &&
			PUSH_SERVICES.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
		);
	} catch {
		return false;
	}
}

export interface Queued {
	/** Epoch ms to send it. */
	at: number;
	/** The encrypted message, base64url. */
	payload: string;
	/** Set by the worker, never by a browser: a failed send has been retried once. */
	retried?: boolean;
}

/** Check a schedule a browser sent; an error message, or what to store. */
export function readSchedule(
	body: unknown,
	now: number
): { endpoint: string; reminders: Queued[] } | string {
	const b = body as { endpoint?: unknown; reminders?: unknown } | null;
	if (!b || !isPushEndpoint(b.endpoint)) return 'Not a browser push address';
	if (!Array.isArray(b.reminders)) return 'Expected a list of reminders';
	if (b.reminders.length > MAX_REMINDERS) return `At most ${MAX_REMINDERS} reminders`;
	const reminders: Queued[] = [];
	for (const r of b.reminders as { at?: unknown; payload?: unknown }[]) {
		if (typeof r?.at !== 'number' || !Number.isFinite(r.at)) return 'Bad reminder time';
		if (r.at > now + HORIZON) return 'Reminders reach at most 8 days ahead';
		if (typeof r.payload !== 'string' || !/^[A-Za-z0-9_-]+$/.test(r.payload))
			return 'Bad reminder message';
		if (r.payload.length > MAX_PAYLOAD) return 'Reminder message too long';
		// Already past: nothing to send.
		if (r.at >= now - 60_000) reminders.push({ at: r.at, payload: r.payload });
	}
	reminders.sort((x, y) => x.at - y.at);
	return { endpoint: b.endpoint, reminders };
}

const b64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
function fromB64url(text: string): Uint8Array<ArrayBuffer> {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for a push to `endpoint` (RFC 8292). */
export async function vapidAuthorization(
	endpoint: string,
	env: Required<Pick<PushEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY'>> & PushEnv,
	now: number
): Promise<string> {
	const pub = fromB64url(env.VAPID_PUBLIC_KEY);
	const key = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			x: b64url(pub.slice(1, 33)),
			y: b64url(pub.slice(33, 65)),
			d: env.VAPID_PRIVATE_KEY
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	const json = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
	const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json({
		aud: new URL(endpoint).origin,
		exp: Math.floor(now / 1000) + 12 * 3600,
		sub: env.VAPID_SUBJECT || 'https://jackhale98.github.io/fasti'
	})}`;
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			key,
			new TextEncoder().encode(unsigned)
		)
	);
	return `vapid t=${unsigned}.${b64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** The list's name: a hash of the push address, so the address isn't the key. */
export async function queueName(endpoint: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
	return b64url(new Uint8Array(digest));
}

interface Stored {
	endpoint: string;
	reminders: Queued[];
	updated: number;
}

/** One subscription's reminders. */
export class PushQueue {
	constructor(
		private readonly state: DurableObjectState,
		private readonly env: PushEnv
	) {}

	/** PUT: replace the list; DELETE: forget it. */
	async fetch(request: Request): Promise<Response> {
		const storage = this.state.storage;
		if (request.method === 'DELETE') {
			await storage.deleteAlarm();
			await storage.deleteAll();
			return new Response(null, { status: 204 });
		}
		const { endpoint, reminders } = (await request.json()) as Omit<Stored, 'updated'>;
		const stored: Stored = { endpoint, reminders, updated: Date.now() };
		await storage.put('queue', stored);
		await this.#wake(stored);
		return new Response(null, { status: 204 });
	}

	/** Send what's due, then sleep until the next one (or the list expires). */
	async alarm(): Promise<void> {
		const storage = this.state.storage;
		const stored = await storage.get<Stored>('queue');
		const now = Date.now();
		if (!stored || now - stored.updated > EXPIRY) {
			await storage.deleteAll();
			return;
		}
		const due = stored.reminders.filter((r) => r.at <= now + 30_000);
		const later = stored.reminders.filter((r) => r.at > now + 30_000);
		const retry: Queued[] = [];
		for (const r of due) {
			const status = await this.#send(stored.endpoint, r.payload, now);
			// The browser dropped this subscription, or the address is junk: forget it.
			if (DROPPED.includes(status)) {
				await storage.deleteAll();
				return;
			}
			// Busy push service or network error: once more a minute later, while the
			// message would still be fresh (its TTL window); otherwise drop it.
			if ((status === 0 || status === 429 || status >= 500) && !r.retried) {
				if (now + RETRY_AFTER < r.at + TTL * 1000)
					retry.push({ at: now + RETRY_AFTER, payload: r.payload, retried: true });
			}
		}
		const next: Stored = {
			...stored,
			reminders: [...later, ...retry].sort((x, y) => x.at - y.at)
		};
		await storage.put('queue', next);
		await this.#wake(next);
	}

	async #wake(stored: Stored) {
		await this.state.storage.setAlarm(stored.reminders[0]?.at ?? stored.updated + EXPIRY);
	}

	async #send(endpoint: string, payload: string, now: number): Promise<number> {
		const env = this.env;
		if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0;
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					Authorization: await vapidAuthorization(
						endpoint,
						{
							...env,
							VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
							VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY
						},
						now
					),
					'Content-Encoding': 'aes128gcm',
					'Content-Type': 'application/octet-stream',
					// A late reminder is no use: the push service drops it after five minutes.
					TTL: String(TTL),
					Urgency: 'high'
				},
				body: fromB64url(payload)
			});
			return res.status;
		} catch {
			return 0;
		}
	}
}

/** `/push/key` and `/push/reminders` for the browser. */
export async function pushRoute(
	request: Request,
	env: PushEnv,
	url: URL,
	headers: () => Headers
): Promise<Response> {
	const reply = (status: number, body: string | null = null, type = 'text/plain') => {
		const h = headers();
		if (body !== null) h.set('Content-Type', type);
		return new Response(body, { status, headers: h });
	};
	if (!env.REMINDERS || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)
		return reply(501, 'Reminders are not set up on this worker');
	if (url.pathname === '/push/key' && request.method === 'GET')
		return reply(200, JSON.stringify({ key: env.VAPID_PUBLIC_KEY }), 'application/json');
	if (url.pathname !== '/push/reminders') return reply(404, 'Not found');
	if (request.method !== 'PUT' && request.method !== 'DELETE')
		return reply(405, 'Use PUT or DELETE');
	if (request.method === 'PUT' && env.PUSH_RATE_LIMIT) {
		const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
		if (!(await env.PUSH_RATE_LIMIT.limit({ key })).success) return reply(429, 'Too many requests');
	}
	if (Number(request.headers.get('content-length') ?? 0) > 512 * 1024)
		return reply(413, 'Too large');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return reply(400, 'Expected JSON');
	}
	const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
	if (!isPushEndpoint(endpoint)) return reply(400, 'Not a browser push address');
	const stub = env.REMINDERS.get(env.REMINDERS.idFromName(await queueName(endpoint)));
	if (request.method === 'DELETE') {
		await stub.fetch(new Request('https://queue/', { method: 'DELETE' }));
		return reply(204);
	}
	const schedule = readSchedule(body, Date.now());
	if (typeof schedule === 'string') return reply(400, schedule);
	await stub.fetch(
		new Request('https://queue/', { method: 'PUT', body: JSON.stringify(schedule) })
	);
	return reply(204);
}
