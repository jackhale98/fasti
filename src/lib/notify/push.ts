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
/** The worker accepts at most this many per subscription. */
export const MAX_PUSH = 64;

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

/** Encrypts each message for this subscription, as the worker stores them. */
export async function sealAll(
	sub: SubscriptionKeys,
	list: readonly Outgoing[]
): Promise<{ at: number; payload: string }[]> {
	const p256dh = sub.keys?.p256dh;
	const auth = sub.keys?.auth;
	if (!p256dh || !auth) throw new Error('The push subscription has no encryption keys.');
	const ua = fromBase64Url(p256dh);
	const secret = fromBase64Url(auth);
	const text = new TextEncoder();
	return Promise.all(
		list.map(async (m) => ({
			at: m.at,
			payload: toBase64Url(await encryptPush(text.encode(JSON.stringify(m.payload)), ua, secret))
		}))
	);
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
