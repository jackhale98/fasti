// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Placeholder until Phase 6 adds the offline shell. Push and notification
 * clicks are handled by #lib/notify/sw.ts.
 */
import { self } from '$app/service-worker';
import { installNotificationHandlers } from '../lib/notify/sw.ts';

installNotificationHandlers(self);

self.addEventListener('install', () => {
	// Nothing to cache yet.
});
