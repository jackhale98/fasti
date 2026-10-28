// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What a notification carries, shared by the page and the service worker
 * (so nothing here touches the DOM). The same JSON is shown by a local timer
 * and, encrypted, sent through the worker as a push. Its shape follows
 * Mycelium's push payload (`id`, `title`, `body`, `url`).
 *
 * The "shown" list is adapted from Mycelium (https://github.com/jackhale98/mycelium-web,
 * src/app/reminders.svelte.ts and scripts/sw.js, `firstShowing`), GPL-3.0-or-later,
 * used in Fasti under GPL-2.0-or-later by its copyright holder's grant
 * (THIRD_PARTY_NOTICES.md).
 */

export interface NotificationPayload {
	/** The occurrence; also the notification's tag. */
	id: string;
	title: string;
	body: string;
	/** Path to open, relative to the app's base (`''` for Today). */
	url: string;
}

/** Reads a payload from a push message's JSON, or null. */
export function readPayload(value: unknown): NotificationPayload | null {
	const v = value as Partial<Record<keyof NotificationPayload, unknown>> | null;
	if (!v || typeof v !== 'object' || typeof v.title !== 'string') return null;
	return {
		id: typeof v.id === 'string' ? v.id : '',
		title: v.title,
		body: typeof v.body === 'string' ? v.body : '',
		url: typeof v.url === 'string' ? v.url : ''
	};
}

const SHOWN_CACHE = 'fasti-notifications-shown';
/** Shown this session (also covers contexts without CacheStorage). */
const shownHere = new Set<string>();

/**
 * Whether this occurrence is being shown for the first time on this device
 * (by a local timer or a push), and marks it shown. CacheStorage is shared
 * by the page and the service worker.
 */
export async function firstShowing(id: string): Promise<boolean> {
	if (!id) return true;
	if (shownHere.has(id)) return false;
	shownHere.add(id);
	try {
		const cache = await caches.open(SHOWN_CACHE);
		const key = `/shown/${encodeURIComponent(id)}`;
		if (await cache.match(key)) return false;
		await cache.put(key, new Response(String(Date.now())));
		return true;
	} catch {
		return true;
	}
}

/** Forgets occurrences shown more than two days ago. */
export async function pruneShown(): Promise<void> {
	try {
		const cache = await caches.open(SHOWN_CACHE);
		for (const req of await cache.keys()) {
			const at = Number(await (await cache.match(req))?.text());
			if (!(Date.now() - at < 2 * 86_400_000)) await cache.delete(req);
		}
	} catch {
		// No CacheStorage (an insecure context): nothing to prune.
	}
}
