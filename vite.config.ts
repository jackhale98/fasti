// SPDX-License-Identifier: GPL-2.0-or-later
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * `vite preview` serves SvelteKit's output, not `build/`, so it has no `404.html`
 * (it renders unknown paths on the fly). Copy the SPA fallback in, so the
 * preview serves it like GitHub Pages does and the service worker can cache it.
 */
function previewFallback(): Plugin {
	return {
		name: 'fasti:preview-fallback',
		apply: 'build',
		// After SvelteKit's own post hook, which runs the adapter.
		buildApp: {
			order: 'post',
			async handler() {
				if (existsSync('build/404.html')) {
					await copyFile('build/404.html', '.svelte-kit/output/client/404.html');
				}
			}
		}
	};
}

/** Module ids of every chunk a visitor's browser can load (shippedPackages). */
const shippedModules = new Set<string>();

/**
 * Collects the modules of each chunk it sees into `shippedModules`. Runs in
 * every client-side build: the page, the service worker and (registered under
 * `worker.plugins`) each Web Worker bundle. The server build SvelteKit makes
 * for prerendering never reaches a visitor, so it isn't counted.
 */
function collectModules(): Plugin {
	return {
		name: 'fasti:collect-modules',
		apply: 'build',
		generateBundle(_options, bundle) {
			// Web Worker bundles have no environment of their own: they are client code.
			if (this.environment && this.environment.config.consumer !== 'client') return;
			for (const output of Object.values(bundle)) {
				if (output.type === 'chunk') for (const id of output.moduleIds) shippedModules.add(id);
			}
		}
	};
}

/**
 * Writes which npm packages have code in the site to
 * .svelte-kit/shipped-packages.json, for the licence check
 * (scripts/check-licenses.mjs).
 */
function shippedPackages(): Plugin {
	return {
		name: 'fasti:shipped-packages',
		apply: 'build',
		buildApp: {
			order: 'post',
			async handler() {
				const packages = new Set<string>();
				for (const id of shippedModules) {
					const at = id.lastIndexOf('/node_modules/');
					if (at < 0) continue;
					const parts = id.slice(at + '/node_modules/'.length).split('/');
					const name = parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
					if (name) packages.add(relative('.', `${id.slice(0, at)}/node_modules/${name}`));
				}
				await mkdir('.svelte-kit', { recursive: true });
				await writeFile(
					'.svelte-kit/shipped-packages.json',
					JSON.stringify([...packages].sort(), null, '\t') + '\n'
				);
			}
		}
	};
}

/** The commit being built (About), or '' outside a git checkout. */
function commit(): string {
	try {
		return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], {
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
	} catch {
		return process.env.GITHUB_SHA?.slice(0, 10) ?? '';
	}
}

/** The build's date (UTC), or the date `SOURCE_DATE_EPOCH` gives, for a reproducible build. */
function buildDate(): string {
	const epoch = Number(process.env.SOURCE_DATE_EPOCH);
	return new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now())
		.toISOString()
		.slice(0, 10);
}

// SvelteKit 3 reads its configuration from the `sveltekit()` plugin (svelte.config.js is unsupported).
export default defineConfig({
	plugins: [
		sveltekit({
			// SPA mode: unknown paths are served by 404.html, which boots the client router.
			// GitHub Pages serves 404.html for deep links, so they keep working.
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: '404.html',
				precompress: false,
				strict: true
			}),
			// No inline scripts (docs/PLAN.md section 10): SvelteKit's start-up script is
			// allowed by its hash, which SvelteKit writes into the page's CSP meta tag.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'wasm-unsafe-eval'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					// Narrowed to Fasti's worker and the configured providers in Phase 4.
					'connect-src': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			},
			// Registered in Phase 6 with an update notice, never a surprise reload.
			serviceWorker: { register: false },
			paths: {
				// From the Pages settings: /fasti at <user>.github.io, empty on a custom domain.
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		}),
		previewFallback(),
		collectModules(),
		shippedPackages()
	],
	worker: {
		format: 'es',
		plugins: () => [collectModules()]
	},
	build: {
		// Fonts stay files: the CSP allows fonts from 'self' only, not data: URIs.
		assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined)
	},
	define: {
		__APP_COMMIT__: JSON.stringify(commit()),
		__APP_BUILT__: JSON.stringify(buildDate())
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'tests/{unit,lens,engine,store,export}/**/*.test.ts']
	}
});
