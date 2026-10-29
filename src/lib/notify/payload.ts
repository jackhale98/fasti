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
	/** Epoch ms of the moment it was meant to be shown (from Remind's schedule). */
	at?: number;
	/** That moment as the page formatted it ("9:30am" or "09:30"), for a late label. */
	due?: string;
}

/** A notification shown more than this after its moment says when it was due. */
export const LATE_MS = 5 * 60_000;
/** The longest `due` label kept. */
const MAX_DUE = 32;

/** Reads a payload from a push message's JSON, or null. */
export function readPayload(value: unknown): NotificationPayload | null {
	const v = value as Partial<Record<keyof NotificationPayload, unknown>> | null;
	if (!v || typeof v !== 'object' || typeof v.title !== 'string') return null;
	const out: NotificationPayload = {
		id: typeof v.id === 'string' ? v.id : '',
		title: v.title,
		body: typeof v.body === 'string' ? v.body : '',
		url: typeof v.url === 'string' ? v.url : ''
	};
	if (typeof v.at === 'number' && Number.isFinite(v.at)) out.at = v.at;
	if (typeof v.due === 'string' && v.due) out.due = v.due.slice(0, MAX_DUE);
	return out;
}

/**
 * The body to show: prefixed with "Due 9:30am · " when shown more than
 * LATE_MS after its moment (a push held by Doze, a device that was off).
 * Compares two epoch ms; never works out a date.
 */
export function bodyToShow(p: NotificationPayload, now = Date.now()): string {
	if (p.at === undefined || !p.due || !(now - p.at > LATE_MS)) return p.body;
	return p.body ? `Due ${p.due} · ${p.body}` : `Due ${p.due}`;
}

/**
 * Not `fasti-…`: the service worker deletes every cache with that prefix but
 * its own when a new version activates (#lib/offline/caching.ts, staleCaches),
 * which would wipe this log.
 */
export const SHOWN_CACHE = 'notify-shown';
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

/**
 * Whether this occurrence has been shown on this device, without marking it.
 * False when CacheStorage can't tell.
 */
export async function wasShown(id: string): Promise<boolean> {
	if (!id) return false;
	if (shownHere.has(id)) return true;
	try {
		const cache = await caches.open(SHOWN_CACHE);
		return !!(await cache.match(`/shown/${encodeURIComponent(id)}`));
	} catch {
		return false;
	}
}

/**
 * How long the shown log is kept: longer than the push schedule reaches, so
 * the catch-up on open can tell what was shown while Fasti was closed.
 */
export const SHOWN_RETENTION_MS = 32 * 86_400_000;

/** Forgets occurrences shown more than SHOWN_RETENTION_MS ago. */
export async function pruneShown(): Promise<void> {
	try {
		const cache = await caches.open(SHOWN_CACHE);
		for (const req of await cache.keys()) {
			const at = Number(await (await cache.match(req))?.text());
			if (!(Date.now() - at < SHOWN_RETENTION_MS)) await cache.delete(req);
		}
	} catch {
		// No CacheStorage (an insecure context): nothing to prune.
	}
}
