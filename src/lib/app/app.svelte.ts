// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The app's state, shared by every view: the open vault (src/lib/store), what
 * Remind says about it (src/lib/engine) and the edits the views make through
 * the lens patcher (src/lib/lens). Views read the fields and call the
 * methods; every edit is a byte-exact patch, undoable from its toast.
 *
 * Line numbers: the engine reports 1-based lines; the lens patcher takes
 * 0-based physical lines. The methods here take the engine's 1-based lines.
 */
import { appendLines, markDone as markDonePatch, replaceLines } from '#lib/lens/patch.ts';
import type { PatchResult } from '#lib/lens/types.ts';
import type { EngineNow, VaultPath, VaultSnapshot } from '#lib/engine/types.ts';
import { now as engineNow } from '#lib/engine/client.ts';
import {
	DEFAULT_SETTINGS,
	ensureBrowserVault,
	getSettings,
	openFastiDB,
	updateSettings,
	type Discovery,
	type FastiDB,
	type Settings,
	type Vault
} from '#lib/store/index.ts';
import { toasts } from '#lib/ui/toast.svelte.ts';
import { deviceZone } from './format.ts';

class App {
	/** True once the vault is loaded. */
	ready = $state(false);
	/** A message when loading failed (no IndexedDB, a broken database). */
	error = $state<string | null>(null);
	settings = $state<Settings>({ ...DEFAULT_SETTINGS });
	/** True once the saved settings are read; until then `settings` holds the defaults. */
	settingsLoaded = $state(false);
	/**
	 * The snapshot Remind runs on; replaced (never mutated) after every change.
	 * Raw, not a deep proxy, so it can be posted to the engine worker as is
	 * (a $state proxy can't be structured-cloned).
	 */
	snapshot = $state.raw<VaultSnapshot | null>(null);
	/** Which files Remind reads, and include problems. */
	discovery = $state.raw<Discovery | null>(null);
	/** Remind's today and now in the device's zone. */
	today = $state.raw<EngineNow | null>(null);
	/** The device's time zone, passed to every engine run. */
	tz = deviceZone();
	/** Bumped after each change, for views that re-query. */
	version = $state(0);

	#db: FastiDB | null = null;
	#vault: Vault | null = null;
	#starting: Promise<void> | null = null;

	/** Opens the database and the browser vault (seeded with the sample on first run). */
	start(): Promise<void> {
		this.#starting ??= this.#start();
		return this.#starting;
	}

	async #start() {
		try {
			this.#db = await openFastiDB();
			this.settings = await getSettings(this.#db);
			this.settingsLoaded = true;
			this.#vault = await ensureBrowserVault(this.#db);
			await this.refresh();
			this.ready = true;
			await this.refreshToday();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		}
	}

	/** Re-reads the vault after a change. */
	async refresh() {
		if (!this.#vault) return;
		const [snapshot, discovery] = await Promise.all([
			this.#vault.snapshot(),
			this.#vault.discover()
		]);
		this.snapshot = snapshot;
		this.discovery = discovery;
		this.version++;
	}

	/** Asks Remind for today's date and the time, in the device's zone. */
	async refreshToday() {
		try {
			this.today = await engineNow(this.tz);
		} catch {
			// The engine failed to start; views show its error when they query.
		}
	}

	get vault(): Vault | null {
		return this.#vault;
	}

	/** The text of a file, from the current snapshot. */
	text(path: VaultPath): string | null {
		return this.snapshot?.files[path] ?? null;
	}

	async setSettings(patch: Partial<Settings>) {
		if (!this.#db) return;
		this.settings = await updateSettings(this.#db, patch);
	}

	/**
	 * Applies a lens patch to one file as an undoable edit, refreshes, and
	 * shows `message` with Undo. Returns false when the patch did nothing.
	 */
	async edit(
		path: VaultPath,
		patch: (text: string) => PatchResult | null,
		message: string
	): Promise<boolean> {
		if (!this.#vault) return false;
		const result = await this.#vault.edit(path, patch, message);
		if (!result) return false;
		await this.refresh();
		toasts.show(message, () => this.undo());
		return true;
	}

	/** Marks the TODO on `line` (1-based) done through `date`. */
	markDone(path: VaultPath, line: number, date: string) {
		return this.edit(
			path,
			(text) => markDonePatch(text, line - 1, date),
			`Done through ${date} · ${path}:${line}`
		);
	}

	/** Replaces lines `line`..`lineEnd` (1-based, inclusive) with `text`. */
	replace(path: VaultPath, line: number, lineEnd: number, text: string) {
		return this.edit(
			path,
			(t) => replaceLines(t, line - 1, lineEnd - 1, text),
			`Saved ${path} line ${line}`
		);
	}

	/** Deletes lines `line`..`lineEnd` (1-based, inclusive). */
	remove(path: VaultPath, line: number, lineEnd: number) {
		return this.edit(
			path,
			(t) => replaceLines(t, line - 1, lineEnd - 1, null),
			`Deleted ${path} line ${line}`
		);
	}

	/** Appends `text` as new lines at the end of a file. */
	append(path: VaultPath, text: string) {
		return this.edit(path, (t) => appendLines(t, text), `Added to ${path}`);
	}

	/** Undoes the last edit. */
	async undo() {
		if (!this.#vault) return;
		const step = await this.#vault.undo();
		await this.refresh();
		if (step) toasts.show('Undone');
	}
}

export const app = new App();
