// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Notifications while Fasti is closed: the client side of the worker's push
 * protocol. The next 8 days' notifications go to Fasti's worker, each
 * encrypted first for this browser's push subscription (RFC 8291), so the
 * worker stores only times and sealed messages it can't read.
 *
 * Adapted from Mycelium (https://github.com/jackhale98/mycelium-web,
 * src/app/push.ts), GPL-3.0-or-later, used in Fasti under GPL-2.0-or-later by
 * its copyright holder's grant (THIRD_PARTY_NOTICES.md). The protocol is
 * Mycelium's, unchanged:
 *
 * - `GET  <worker>/push/key` → `{ "key": "<VAPID public key, base64url>" }`
 *   (501 when push isn't set up on the worker).
 * - `PUT  <worker>/push/reminders` with
 *   `{ "endpoint", "reminders": [{ "at": <epoch ms>, "payload": "<base64url>" }] }`
 *   replaces this subscription's list: at most 64, none more than 8 days
 *   ahead, each payload at most 4 KB.
 * - `DELETE <worker>/push/reminders` with `{ "endpoint" }` forgets it.
 *
 * The worker sends each push with `Urgency: high` and a TTL, which the
 * protocol fixes on the worker's side (the client can't set them).
 */
import { encryptPush, fromBase64Url, toBase64Url } from './encrypt.ts';
import type { NotificationPayload } from './payload.ts';

type Fetch = typeof fetch;

/** The worker keeps lists due within this window. */
export const HORIZON_MS = 8 * 86_400_000;
/**
 * Upload only what's due this long before the worker's horizon from the
 * device's clock, so a device clock that runs fast (the worker checks against
 * its own) doesn't get the whole list refused.
 */
export const CLOCK_MARGIN_MS = 3_600_000;
/** The upload's horizon, from the device's now. */
export const uploadHorizon = (now = Date.now()) => now + HORIZON_MS - CLOCK_MARGIN_MS;
/** The worker accepts at most this many per subscription. */
export const MAX_PUSH = 64;
/**
 * The largest plaintext JSON sent. Push services take 4096-byte records
 * (RFC 8291 leaves 4079 bytes of plaintext in one) and the worker refuses a
 * message over 4 KB; this leaves a wide margin.
 */
export const MAX_PLAINTEXT = 3072;
/** The worker's limit on one sealed message, base64url (4 KB). */
const MAX_SEALED = 5462;

const join = (worker: string, path: string) => `${worker.replace(/\/+$/, '')}${path}`;

/** The worker's VAPID public key, or null when it has no push set up or can't be reached. */
export async function serverKey(worker: string, fetchFn: Fetch = fetch): Promise<string | null> {
	try {
		const res = await fetchFn(join(worker, '/push/key'));
		if (!res.ok) return null;
		const key = ((await res.json()) as { key?: unknown }).key;
		return typeof key === 'string' && key ? key : null;
	} catch {
		return null;
	}
}

/** What encrypting for a subscription needs: `PushSubscription.toJSON()`. */
export interface SubscriptionKeys {
	endpoint: string;
	keys?: Record<string, string>;
}

/** One message to send at `at` (epoch ms). */
export interface Outgoing {
	at: number;
	payload: NotificationPayload;
}

const utf8 = new TextEncoder();
const size = (p: NotificationPayload) => utf8.encode(JSON.stringify(p)).length;

/** The first `n` code points of `text` plus an ellipsis, or all of it (never splits a character). */
function cut(chars: string[], n: number): string {
	return n >= chars.length ? chars.join('') : `${chars.slice(0, n).join('')}…`;
}

/**
 * Shortens a payload so its JSON is at most `max` UTF-8 bytes: the body
 * first, then the title, each cut on a character boundary with an ellipsis.
 */
export function fitPayload(p: NotificationPayload, max = MAX_PLAINTEXT): NotificationPayload {
	if (size(p) <= max) return p;
	let out: NotificationPayload = { ...p, id: p.id.slice(0, 256), url: p.url.slice(0, 256) };
	for (const field of ['body', 'title'] as const) {
		const chars = Array.from(out[field]);
		const at = (n: number): NotificationPayload => ({ ...out, [field]: cut(chars, n) });
		if (size(at(0)) > max) {
			out = at(0);
			continue;
		}
		// The longest prefix that fits.
		let lo = 0;
		let hi = chars.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (size(at(mid)) <= max) lo = mid;
			else hi = mid - 1;
		}
		return at(lo);
	}
	return out;
}

/**
 * Encrypts each message for this subscription, as the worker stores them.
 * Each payload is shortened to fit first; one that still wouldn't fit is
 * left out rather than failing the whole list.
 */
export async function sealAll(
	sub: SubscriptionKeys,
	list: readonly Outgoing[]
): Promise<{ at: number; payload: string }[]> {
	const p256dh = sub.keys?.p256dh;
	const auth = sub.keys?.auth;
	if (!p256dh || !auth) throw new Error('The push subscription has no encryption keys.');
	const ua = fromBase64Url(p256dh);
	const secret = fromBase64Url(auth);
	const sealed = await Promise.all(
		list.map(async (m) => ({
			at: m.at,
			payload: toBase64Url(
				await encryptPush(utf8.encode(JSON.stringify(fitPayload(m.payload))), ua, secret)
			)
		}))
	);
	return sealed.filter((m) => m.payload.length <= MAX_SEALED);
}

/**
 * The list with a test message first, in a slot of its own: the real ones
 * keep their order and the total stays within MAX_PUSH.
 */
export function withTest(list: readonly Outgoing[], test: Outgoing, max = MAX_PUSH): Outgoing[] {
	return [test, ...list.slice(0, max - 1)];
}

/**
 * What to do about push when Fasti opens: nothing; drop the stored
 * subscription (permission withdrawn); subscribe (turned on but nothing
 * stored, because subscribing failed before: retried on every open); or
 * refresh (re-check the subscription and upload).
 */
export function pushOnOpen(state: {
	configured: boolean;
	supported: boolean;
	enabled: boolean;
	permission: NotificationPermission | 'unsupported';
	stored: boolean;
}): 'none' | 'drop' | 'subscribe' | 'refresh' {
	if (!state.configured || !state.supported) return 'none';
	if (state.stored) return state.permission === 'granted' ? 'refresh' : 'drop';
	return state.enabled && state.permission === 'granted' ? 'subscribe' : 'none';
}

/** Replaces the worker's list for this subscription. Throws with a reason. */
export async function uploadSchedule(
	worker: string,
	sub: SubscriptionKeys,
	list: readonly Outgoing[],
	fetchFn: Fetch = fetch
): Promise<void> {
	const reminders = await sealAll(sub, list.slice(0, MAX_PUSH));
	let res: Response;
	try {
		res = await fetchFn(join(worker, '/push/reminders'), {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint: sub.endpoint, reminders })
		});
	} catch {
		throw new Error(
			'Fasti’s server couldn’t be reached. Fasti tries again the next time it opens.'
		);
	}
	if (!res.ok) {
		const why = (await res.text().catch(() => '')).slice(0, 200);
		throw new Error(
			`Fasti’s server refused the notifications (${res.status}${why ? `: ${why}` : ''}).`
		);
	}
}

/** Has the worker forget this subscription's list (best effort). */
export async function deleteSchedule(
	worker: string,
	endpoint: string,
	fetchFn: Fetch = fetch
): Promise<void> {
	await fetchFn(join(worker, '/push/reminders'), {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint })
	}).catch(() => undefined);
}
