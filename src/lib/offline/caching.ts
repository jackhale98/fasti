// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the service worker keeps for offline use, and how it answers each
 * request. Pure functions (no DOM, no worker globals), unit-tested and shared
 * with src/service-worker. Adapted from Tessera's src/lib/offline/caching.ts
 * (MIT; see THIRD_PARTY_NOTICES.md).
 *
 * - Everything the app needs is precached when the worker installs, and served
 *   cache-first: the prerendered pages, the 404.html SPA fallback, the hashed
 *   JS/CSS/fonts, icons, the manifest, and the engine (remind.mjs and
 *   remind.wasm, about 184 KB gzipped), so Fasti works fully offline after the
 *   first visit (docs/PLAN.md section 3.7).
 * - Anything else (other origins such as Fasti's worker or a sync provider,
 *   non-GET requests, range requests, unknown files) goes to the network and
 *   is never cached. The vault itself lives in IndexedDB, not here.
 */

/** Every cache this app creates starts with this; others are left alone. */
export const CACHE_PREFIX = 'fasti-';

/** The cache for one build: a new build gets a new cache, and old ones are deleted. */
export function cacheName(version: string): string {
	return `${CACHE_PREFIX}shell-${version}`;
}

/** Caches from other builds of this app, to delete once a new worker activates. */
export function staleCaches(keys: string[], current: string): string[] {
	return keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== current);
}

export interface CachePlan {
	/** The base path: '' or e.g. '/fasti' (no trailing slash). */
	base: string;
	/** Prerendered pages, as paths (`/fasti/`, `/fasti/month`, …). */
	pages: string[];
	/** The SPA fallback page that boots the router for any other route. */
	fallback: string;
	/** Every other file precached at install: build output, static files, the engine. */
	files: string[];
}

/** Static files not worth keeping offline (dotfiles, robots.txt). */
function skipped(path: string): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1);
	return name.startsWith('.') || name === 'robots.txt';
}

/** Work out what to cache from the build manifest (paths relative to the base, as `$app/manifest` gives them). */
export function planCaches(input: {
	base: string;
	immutable: string[];
	assets: string[];
	prerendered: string[];
}): CachePlan {
	const base = input.base.replace(/\/$/, '');
	const at = (path: string) => `${base}/${path.replace(/^\//, '')}`;
	return {
		base,
		pages: input.prerendered.map(at),
		fallback: at('404.html'),
		files: [...input.immutable, ...input.assets.filter((p) => !skipped(p))].map(at)
	};
}

export type Route =
	/** Leave it to the browser: not cached, not touched. */
	| { strategy: 'network' }
	/** A precached file: from the cache, else the network. */
	| { strategy: 'file'; key: string }
	/** A page: the precached copy of `key` (a prerendered page or the SPA fallback). */
	| { strategy: 'page'; key: string };

export interface RequestFacts {
	url: string;
	method: string;
	/** `Request.mode`: 'navigate' for page loads. */
	mode: string;
	/** Whether it asks for part of a file (a `Range` header); those go to the network. */
	range?: boolean;
}

/** The page path for a navigation: `/fasti/month/` and `/fasti/month.html` are `/fasti/month`. */
function pagePath(pathname: string, base: string): string {
	let path = pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
	if (path.length > base.length + 1) path = path.replace(/\/+$/, '');
	return path === base ? `${base}/` : path;
}

/** How the service worker should answer a request. */
export function routeRequest(request: RequestFacts, origin: string, plan: CachePlan): Route {
	const network: Route = { strategy: 'network' };
	if (request.method !== 'GET' || request.range) return network;
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return network;
	}
	if (url.origin !== origin) return network;
	const { pathname } = url;
	if (pathname !== plan.base && !pathname.startsWith(`${plan.base}/`)) return network;
	if (plan.files.includes(pathname)) return { strategy: 'file', key: pathname };
	if (request.mode === 'navigate') {
		if (pathname === plan.fallback) return { strategy: 'page', key: plan.fallback };
		const page = pagePath(pathname, plan.base);
		if (plan.pages.includes(page)) return { strategy: 'page', key: page };
		// A file that isn't an app route (a download, robots.txt, …).
		if (/\.[a-z0-9]+$/i.test(pathname)) return network;
		// Any other route boots from the SPA fallback.
		return { strategy: 'page', key: plan.fallback };
	}
	return network;
}
