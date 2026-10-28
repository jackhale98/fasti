// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Fasti as an installed, offline-capable web app: whether the network is
 * reachable, whether it runs installed (from the Home Screen), and the
 * service worker, registered once the page has loaded and gone idle, with a
 * quiet "new version" notice instead of a surprise reload. Adapted from
 * Tessera's src/lib/offline/pwa.svelte.ts (MIT; see THIRD_PARTY_NOTICES.md).
 */
import { dev } from '$app/env';
import { resolve } from '$app/paths';
import { toasts } from '#lib/ui/toast.svelte.ts';

/** Look for a new version this often while the app stays open. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

class Pwa {
	/** Whether the browser has a network connection. */
	online = $state(true);
	/** Running as the installed app (from the Home Screen, Dock or app list). */
	installed = $state(false);
	/** A new version is installed and waiting for a reload. */
	updateReady = $state(false);

	#started = false;
	#registration: ServiceWorkerRegistration | null = null;
	#reloading = false;

	init() {
		if (this.#started || typeof window === 'undefined') return;
		this.#started = true;
		this.online = navigator.onLine;
		addEventListener('online', () => (this.online = true));
		addEventListener('offline', () => (this.online = false));
		const standalone = () =>
			(navigator as { standalone?: boolean }).standalone === true ||
			matchMedia('(display-mode: standalone)').matches;
		this.installed = standalone();
		matchMedia('(display-mode: standalone)').addEventListener('change', () => {
			this.installed = standalone();
		});
		if (dev || !('serviceWorker' in navigator)) return;
		// After the page has loaded and gone idle: never in the way of the first paint.
		const later = () => {
			const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1000));
			idle(() => void this.#register(), { timeout: 5000 });
		};
		if (document.readyState === 'complete') later();
		else addEventListener('load', later, { once: true });
	}

	/** The registration, once the worker is registered (notifications use it). */
	get registration(): ServiceWorkerRegistration | null {
		return this.#registration;
	}

	async #register() {
		const sw = navigator.serviceWorker;
		// A page loaded without a worker gets one on first install: that's not an update.
		let controlled = !!sw.controller;
		sw.addEventListener('controllerchange', () => {
			if (this.#reloading) location.reload();
			else if (controlled) this.#announce();
			controlled = true;
		});
		let registration: ServiceWorkerRegistration;
		try {
			registration = await sw.register(`${resolve('/')}service-worker.js`, { type: 'module' });
		} catch {
			return; // Private mode or blocked by the browser: the app still works online.
		}
		this.#registration = registration;
		if (registration.waiting && sw.controller) this.#announce();
		registration.addEventListener('updatefound', () => {
			const installing = registration.installing;
			installing?.addEventListener('statechange', () => {
				if (installing.state === 'installed' && sw.controller) this.#announce();
			});
		});
		setInterval(() => {
			if (this.online && document.visibilityState === 'visible') void registration.update();
		}, UPDATE_CHECK_MS);
	}

	#announce() {
		if (this.updateReady) return;
		this.updateReady = true;
		toasts.offer('A new version of Fasti is ready.', { label: 'Reload', run: () => this.reload() });
	}

	/** Switches to the new version. Edits are saved as they happen, so nothing is lost. */
	reload() {
		const waiting = this.#registration?.waiting;
		if (waiting) {
			this.#reloading = true;
			waiting.postMessage({ type: 'skip-waiting' });
		} else {
			location.reload();
		}
	}
}

export const pwa = new Pwa();
