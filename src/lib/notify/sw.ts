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
 * show nothing (docs/PLAN.md 3.6, Reliability).
 *
 * The scope is typed structurally: this file is compiled with the app's DOM
 * types, where ServiceWorkerGlobalScope doesn't exist.
 */
import { firstShowing, readPayload, type NotificationPayload } from './payload.ts';

interface WindowClientLike {
	url: string;
	focus(): Promise<unknown>;
	navigate?(url: string): Promise<unknown>;
}

export interface NotificationScope {
	addEventListener(type: 'push' | 'notificationclick', listener: (event: Event) => void): void;
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

export function installNotificationHandlers(scope: NotificationScope): void {
	const reg = scope.registration;

	scope.addEventListener('push', (event) => {
		const e = event as PushEventLike;
		const payload = pushPayload(e.data);
		e.waitUntil(
			firstShowing(payload.id)
				.catch(() => true)
				.then((first) =>
					reg.showNotification(payload.title, {
						body: payload.body,
						...(payload.id ? { tag: payload.id } : {}),
						// Shown already by the open app: replace it quietly rather than twice.
						silent: !first,
						icon: appUrl(reg.scope, 'favicon.svg'),
						data: { url: appUrl(reg.scope, payload.url) }
					})
				)
		);
	});

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
				return open.focus();
			})
		);
	});
}
