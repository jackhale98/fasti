// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Light, dark or the system's choice. Kept in localStorage as a per-device
 * convenience (Settings writes it); the page renders correctly without it.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'fasti-theme';

function read(): ThemeChoice {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

class Theme {
	choice = $state<ThemeChoice>('system');

	/** Reads the saved choice and applies it; call once in the browser. */
	init() {
		this.set(read());
	}

	set(choice: ThemeChoice) {
		this.choice = choice;
		const root = document.documentElement;
		if (choice === 'system') delete root.dataset.theme;
		else root.dataset.theme = choice;
		try {
			if (choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, choice);
		} catch {
			// Storage unavailable: the choice lasts for this visit.
		}
	}
}

export const theme = new Theme();
