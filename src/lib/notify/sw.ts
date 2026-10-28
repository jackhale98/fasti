// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Push and notification-click handling for the service worker. The service
 * worker (src/service-worker/index.ts) calls this once; the notifications work
 * (Phase 5) fills it in. Must not import anything that touches the DOM.
 *
 * The scope is typed structurally: this file is compiled with the app's DOM
 * types, where ServiceWorkerGlobalScope doesn't exist.
 */
export interface NotificationScope {
	addEventListener(type: 'push' | 'notificationclick', listener: (event: Event) => void): void;
	registration: ServiceWorkerRegistration;
}

export function installNotificationHandlers(scope: NotificationScope): void {
	void scope;
}
