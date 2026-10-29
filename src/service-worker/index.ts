// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Keeps Fasti working offline once visited: everything is precached at
 * install (#lib/offline/caching.ts decides what, and how each request is
 * answered). Push, notification clicks, push subscription changes and the
 * periodic push check are handled by #lib/notify/sw.ts.
 * Registered by #lib/offline/pwa.svelte.ts after the page has loaded; a new
 * version waits until the person chooses "Reload". Adapted from Tessera's
 * service worker (MIT; see THIRD_PARTY_NOTICES.md).
 */
import { self } from '$app/service-worker';
import { resolve } from '$app/paths';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import {
	cacheName,
	planCaches,
	routeRequest,
	staleCaches,
	type Route
} from '../lib/offline/caching.ts';
import { installNotificationHandlers } from '../lib/notify/sw.ts';
import { resealStored } from '../lib/notify/reseal.ts';
import { getPlan, getPush, openFastiDB, setPush } from '../lib/store/db.ts';

installNotificationHandlers(self, async (fresh) => {
	// Only where push exists (feature-detected); IndexedDB is opened per event.
	const pushManager = self.registration.pushManager;
	if (!pushManager || typeof indexedDB === 'undefined') return;
	const db = await openFastiDB();
	try {
		await resealStored({
			pushManager,
			fresh,
			getRecord: () => getPush(db),
			getPlan: () => getPlan(db),
			saveRecord: (record) => setPush(db, record)
		});
	} finally {
		db.close();
	}
});

const name = cacheName(version);
const plan = planCaches({
	base: resolve('/'),
	immutable: immutable.map((file) => file.path),
	assets: assets.map((file) => file.path),
	prerendered: prerendered.map((page) => page.path)
});

/** Pages and unhashed files are fetched past the HTTP cache, so they match this build. */
const fresh = (path: string) => new Request(path, { cache: 'no-cache' });

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(name);
			const hashed = new Set(immutable.map((file) => `${plan.base}/${file.path}`));
			await cache.addAll([
				...plan.pages.map(fresh),
				...plan.files.map((path) => (hashed.has(path) ? path : fresh(path)))
			]);
			// The SPA fallback is served with status 404 by hosts (that's how deep
			// links reach it), so it is stored as an ordinary page.
			const response = await fetch(fresh(plan.fallback));
			if (!response.ok && response.status !== 404)
				throw new Error(`${plan.fallback}: ${response.status}`);
			await cache.put(
				plan.fallback,
				new Response(await response.blob(), { status: 200, headers: response.headers })
			);
		})()
	);
	// No skipWaiting here: an open tab keeps its version until the person
	// chooses "Reload" (or every tab is closed).
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			await Promise.all(staleCaches(await caches.keys(), name).map((key) => caches.delete(key)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const route = routeRequest(
		{
			url: request.url,
			method: request.method,
			mode: request.mode,
			range: request.headers.has('range')
		},
		self.location.origin,
		plan
	);
	if (route.strategy === 'network') return;
	event.respondWith(answer(request, route));
});

async function answer(request: Request, route: Exclude<Route, { strategy: 'network' }>) {
	const cached = await caches.match(route.key, { cacheName: name });
	if (cached) return cached;
	try {
		return await fetch(request);
	} catch (error) {
		// Offline and not cached (storage was cleared): any page can still boot from the fallback.
		const fallback =
			route.strategy === 'page' ? await caches.match(plan.fallback, { cacheName: name }) : null;
		if (fallback) return fallback;
		throw error;
	}
}

self.addEventListener('message', (event) => {
	if ((event.data as { type?: string } | null)?.type === 'skip-waiting') void self.skipWaiting();
});
