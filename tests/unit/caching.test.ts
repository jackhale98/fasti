// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { cacheName, planCaches, routeRequest, staleCaches } from '#lib/offline/caching.ts';

const plan = planCaches({
	base: '/fasti',
	immutable: ['_app/immutable/entry/start.abc.js', '_app/immutable/assets/0.def.css'],
	assets: [
		'favicon.svg',
		'manifest.webmanifest',
		'engine/remind.mjs',
		'engine/remind.wasm',
		'robots.txt',
		'.nojekyll'
	],
	prerendered: ['/', '/month', '/script', '/sync', '/settings']
});
const O = 'https://jackhale98.github.io';
const nav = (path: string) => ({ url: O + path, method: 'GET', mode: 'navigate' });
const get = (path: string) => ({ url: O + path, method: 'GET', mode: 'cors' });

describe('cache plan', () => {
	it('precaches the shell and the engine under the base path, not robots.txt or dotfiles', () => {
		expect(plan.files).toContain('/fasti/engine/remind.wasm');
		expect(plan.files).toContain('/fasti/engine/remind.mjs');
		expect(plan.files).toContain('/fasti/_app/immutable/entry/start.abc.js');
		expect(plan.files).not.toContain('/fasti/robots.txt');
		expect(plan.files).not.toContain('/fasti/.nojekyll');
		expect(plan.pages).toEqual([
			'/fasti/',
			'/fasti/month',
			'/fasti/script',
			'/fasti/sync',
			'/fasti/settings'
		]);
		expect(plan.fallback).toBe('/fasti/404.html');
	});

	it('works at the root of a custom domain', () => {
		const root = planCaches({
			base: '',
			immutable: [],
			assets: ['engine/remind.wasm'],
			prerendered: ['/']
		});
		expect(root.files).toEqual(['/engine/remind.wasm']);
		expect(root.pages).toEqual(['/']);
		expect(routeRequest(nav('/'), O, root)).toEqual({ strategy: 'page', key: '/' });
	});
});

describe('routing', () => {
	it('serves precached files and pages from the cache', () => {
		expect(routeRequest(get('/fasti/engine/remind.wasm'), O, plan)).toEqual({
			strategy: 'file',
			key: '/fasti/engine/remind.wasm'
		});
		expect(routeRequest(nav('/fasti/month'), O, plan)).toEqual({
			strategy: 'page',
			key: '/fasti/month'
		});
		expect(routeRequest(nav('/fasti/month/'), O, plan)).toEqual({
			strategy: 'page',
			key: '/fasti/month'
		});
		expect(routeRequest(nav('/fasti/month.html'), O, plan)).toEqual({
			strategy: 'page',
			key: '/fasti/month'
		});
		expect(routeRequest(nav('/fasti'), O, plan)).toEqual({ strategy: 'page', key: '/fasti/' });
	});

	it('boots unknown routes from the fallback, but not unknown files', () => {
		expect(routeRequest(nav('/fasti/script?file=a.rem&line=3'), O, plan)).toEqual({
			strategy: 'page',
			key: '/fasti/script'
		});
		expect(routeRequest(nav('/fasti/nowhere'), O, plan)).toEqual({
			strategy: 'page',
			key: '/fasti/404.html'
		});
		expect(routeRequest(nav('/fasti/report.pdf'), O, plan)).toEqual({ strategy: 'network' });
	});

	it('leaves other origins, other paths, writes and ranges to the network', () => {
		const network = { strategy: 'network' };
		expect(routeRequest(get('https://fasti-worker.example.workers.dev/push'), O, plan)).toEqual(
			network
		);
		expect(routeRequest(get('/other/app.js'), O, plan)).toEqual(network);
		expect(routeRequest({ ...get('/fasti/favicon.svg'), method: 'POST' }, O, plan)).toEqual(
			network
		);
		expect(routeRequest({ ...get('/fasti/engine/remind.wasm'), range: true }, O, plan)).toEqual(
			network
		);
		expect(routeRequest({ ...get('/fasti/favicon.svg'), url: 'not a url' }, O, plan)).toEqual(
			network
		);
	});
});

describe('cache names', () => {
	it('deletes only this app’s caches from other builds', () => {
		const current = cacheName('123');
		expect(
			staleCaches(['fasti-shell-100', current, 'other-app', 'fasti-shell-099'], current)
		).toEqual(['fasti-shell-100', 'fasti-shell-099']);
	});
});
