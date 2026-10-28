// SPDX-License-Identifier: GPL-2.0-or-later
import type { Snippet } from 'svelte';

/**
 * State the app shell shares with the views: the desktop inspector panel's
 * content (a view sets it while it is mounted) and whether quick add is open.
 */
class Shell {
	/** What the inspector panel shows on desktop; null shows the panel's default. */
	panel = $state<Snippet | null>(null);
	/** Quick add (the FAB, the rail button and the `n` key open it). */
	composing = $state(false);
}

export const shell = new Shell();
