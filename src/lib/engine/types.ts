// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Shared types between the vault store (src/lib/store) and the engine
 * (src/lib/engine). The store produces a VaultSnapshot; the engine writes it
 * into MEMFS under /vault/ and runs Remind on it. Engine output types are
 * added below by the engine client (docs/engine.md has the JSON shapes).
 */

/** A vault-relative path with forward slashes and no leading slash, e.g. `holidays/us.rem`. */
export type VaultPath = string;

/** The text Remind reads: every file in the vault, exactly as stored (bytes decoded as UTF-8). */
export interface VaultSnapshot {
	/**
	 * The main entry Remind is pointed at: a file (`reminders.rem`) or a
	 * directory (`''` for the vault root, or `dir`) whose `*.rem` files Remind
	 * reads in sorted order.
	 */
	main: VaultPath;
	/** Every file, keyed by path. Directories are implied by the paths. */
	files: Readonly<Record<VaultPath, string>>;
	/**
	 * A content hash of `main` and `files` (the store keeps it current), used
	 * to key cached engine results. Any stable hex digest.
	 */
	hash: string;
}
