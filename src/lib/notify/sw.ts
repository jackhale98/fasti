// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Push and notification-click handling for the service worker. The service
 * worker (src/service-worker/index.ts) calls this once. Must not import
 * anything that touches the DOM.
 *
 * Adapted from Mycelium's service worker (https://github.com/jackhale98/mycelium-web,
 * scripts/sw.js, the push and notificationclick handlers), GPL-3.0-or-later,
 * used in Fasti under GPL-2.0-or-later by its copyright holder's grant
 * (THIRD_PARTY_NOTICES.md). Changed: every push shows a notification, even
 * one that can't be read, because iOS revokes a subscription whose pushes
 * show nothing (docs/PLAN.md 3.6, Reliability); a push shown more than
 * five minutes late says when it was due; and the stored plan is re-sealed
 * when the browser changes the subscription or on a periodic check
 * (reseal.ts).
 *
 * The scope is typed structurally: this file is compiled with the app's DOM
 * types, where ServiceWorkerGlobalScope doesn't exist.
 */
import { bodyToShow, firstShowing, readPayload, type NotificationPayload } from './payload.ts';
import { PUSH_CHECK_TAG } from './reseal.ts';

interface WindowClientLike {
	url: string;
	focus(): Promise<unknown>;
	navigate?(url: string): Promise<unknown>;
}

export interface NotificationScope {
	addEventListener(
		type: 'push' | 'notificationclick' | 'pushsubscriptionchange' | 'periodicsync',
		listener: (event: Event) => void
	): void;
	registration: ServiceWorkerRegistration;
	clients?: {
		matchAll(options: {
			type: 'window';
			includeUncontrolled: boolean;
		}): Promise<readonly unknown[]>;
		openWindow(url: string): Promise<unknown>;
	};
}

/** The parts of a PushEvent used here. */
interface PushEventLike extends Event {
	data?: { json(): unknown; text(): string } | null;
	waitUntil(promise: Promise<unknown>): void;
}

/** The parts of a NotificationEvent used here. */
interface NotificationEventLike extends Event {
	notification: Notification;
	waitUntil(promise: Promise<unknown>): void;
}

/** The parts of a PushSubscriptionChangeEvent used here. */
interface SubscriptionChangeEventLike extends Event {
	newSubscription?: { toJSON(): unknown } | null;
	waitUntil(promise: Promise<unknown>): void;
}

/** The parts of a PeriodicSyncEvent used here. */
interface PeriodicSyncEventLike extends Event {
	tag?: string;
	waitUntil(promise: Promise<unknown>): void;
}

/**
 * Re-seals the stored plan (reseal.ts), with a subscription the event
 * carries, if any. Injected so tests can run without IndexedDB.
 */
export type Reseal = (fresh: { toJSON(): unknown } | null) => Promise<unknown>;

/** Shown when a push can't be read: still visible, as iOS requires. */
export const FALLBACK: NotificationPayload = {
	id: '',
	title: 'Fasti',
	body: 'You have a reminder. Open Fasti to see it.',
	url: ''
};

/** The payload of a push, or the fallback. */
export function pushPayload(data: PushEventLike['data']): NotificationPayload {
	if (!data) return FALLBACK;
	try {
		return readPayload(data.json()) ?? FALLBACK;
	} catch {
		return FALLBACK;
	}
}

/** The app's URL for a payload path, inside the service worker's scope. */
export function appUrl(scope: string, path: string): string {
	const base = scope.endsWith('/') ? scope : `${scope}/`;
	return new URL(path.replace(/^\/+/, ''), base).href;
}

export function installNotificationHandlers(
	scope: NotificationScope,
	reseal?: Reseal,
	now: () => number = Date.now
): void {
	const reg = scope.registration;

	scope.addEventListener('push', (event) => {
		const e = event as PushEventLike;
		const payload = pushPayload(e.data);
		e.waitUntil(
			firstShowing(payload.id)
				.catch(() => true)
				.then((first) =>
					reg.showNotification(payload.title, {
						body: bodyToShow(payload, now()),
						...(payload.id ? { tag: payload.id } : {}),
						// Shown already by the open app: replace it quietly rather than twice.
						silent: !first,
						icon: appUrl(reg.scope, 'favicon.svg'),
						data: { url: appUrl(reg.scope, payload.url) }
					})
				)
		);
	});

	if (reseal) {
		// Best effort: a failure leaves the worker's list as it was, and the
		// next open re-uploads.
		scope.addEventListener('pushsubscriptionchange', (event) => {
			const e = event as SubscriptionChangeEventLike;
			e.waitUntil(reseal(e.newSubscription ?? null).catch(() => undefined));
		});
		scope.addEventListener('periodicsync', (event) => {
			const e = event as PeriodicSyncEventLike;
			if (e.tag !== PUSH_CHECK_TAG) return;
			e.waitUntil(reseal(null).catch(() => undefined));
		});
	}

	scope.addEventListener('notificationclick', (event) => {
		const e = event as NotificationEventLike;
		e.notification.close();
		const data = e.notification.data as { url?: unknown } | null;
		const target = typeof data?.url === 'string' ? data.url : appUrl(reg.scope, '');
		const clients = scope.clients;
		if (!clients) return;
		e.waitUntil(
			clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
				const windows = list as WindowClientLike[];
				const open = windows.find((w) => w.url.startsWith(reg.scope));
				if (!open) return clients.openWindow(target);
				// Show the notification's page in the open window, then bring it forward.
				const go = open.url !== target && open.navigate ? open.navigate(target) : null;
				return Promise.resolve(go)
					.catch(() => null)
					.then(() => open.focus());
			})
		);
	});
}
