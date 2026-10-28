// SPDX-License-Identifier: GPL-2.0-or-later
import type { Snippet } from 'svelte';
import type { IsoDate, VaultPath } from '#lib/engine/types.ts';

/** A reminder picked in a view: its line in the vault and, when known, the occurrence. */
export interface Selection {
	file: VaultPath;
	/** 1-based first physical line (the engine's `line`). */
	line: number;
	/** 1-based last physical line (the engine's `lineEnd`). */
	lineEnd: number;
	/** The occurrence that was picked (agenda or calendar date), if any. */
	date: IsoDate | null;
}

/**
 * State the app shell shares with the views: the selected reminder (the
 * inspector shows it: the right panel on desktop, a bottom sheet on phones),
 * an optional panel override, and whether quick add is open.
 */
class Shell {
	/** The reminder the inspector shows; null shows the panel's default. */
	selected = $state<Selection | null>(null);
	/** What the desktop panel shows when nothing is selected (a view may set it). */
	panel = $state<Snippet | null>(null);
	/** Quick add (the FAB, the rail button and the `n` key open it). */
	composing = $state(false);

	select(selection: Selection | null) {
		this.selected = selection;
	}
}

export const shell = new Shell();
