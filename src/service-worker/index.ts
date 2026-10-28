// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Phase 0 placeholder: the service worker is built but not registered
 * (vite.config.ts). Phase 6 adds the offline shell and precaches remind.wasm,
 * following Tessera's caching plan.
 */
import { self } from '$app/service-worker';

self.addEventListener('install', () => {
	// Nothing to cache yet.
});
