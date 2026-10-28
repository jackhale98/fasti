// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A vault: its files in IndexedDB, the snapshot the engine runs on, which
 * files Remind reads, and a persisted undo history.
 *
 * Files are never regenerated. Text is stored exactly as decoded; an edit is
 * a lens patch (src/lib/lens/patch.ts) whose inverse is recorded, so undo
 * restores the bytes. Nothing here overwrites a file behind the user's back:
 * creating an existing file, importing over a changed one, or undoing over a
 * file changed since (by a sync) fails and says so.
 */
import type { IDBPTransaction } from 'idb';
import type { VaultPath, VaultSnapshot } from '../engine/types';
import { applyEdit } from '../lens/patch';
import type { Edit, PatchResult } from '../lens/types';
import type {
	Change,
	FastiDB,
	FastiSchema,
	FileRow,
	ProviderId,
	UndoRecord,
	UndoStep,
	VaultRecord
} from './db';
import { discover, type Discovery } from './discover';
import { byteOrder, textInfo } from './text';

/** Undo steps kept per vault. */
export const UNDO_LIMIT = 200;

/** A path that can't name a vault file. */
export class InvalidPathError extends Error {
	constructor(readonly path: string) {
		super(`Not a vault path: ${JSON.stringify(path)}`);
	}
}

/** The file exists already (creating) or doesn't exist (editing). */
export class FileStateError extends Error {
	constructor(
		readonly path: VaultPath,
		readonly exists: boolean
	) {
		super(exists ? `${path} already exists` : `${path} is not in the vault`);
	}
}

/** An undo or redo step no longer fits the files: they changed since (a sync, another tab). */
export class UndoConflictError extends Error {
	constructor(readonly path: VaultPath) {
		super(`${path} changed since, so this step can't be undone safely`);
	}
}

/** A file name or path: forward slashes, no leading slash, no empty, `.` or `..` parts. */
export function checkPath(path: string): VaultPath {
	if (
		typeof path !== 'string' ||
		!path ||
		path.split('/').some((p) => p === '' || p === '.' || p === '..') ||
		path.includes('\0')
	)
		throw new InvalidPathError(path);
	return path;
}

/** A main entry: a file path, or a directory (`''` for the root). */
export function checkMain(main: string): VaultPath {
	return main === '' ? '' : checkPath(main);
}

/** SHA-256 (hex) of the main entry and every file: the snapshot's cache key. */
export async function snapshotHash(
	main: VaultPath,
	files: Readonly<Record<VaultPath, string>>
): Promise<string> {
	const keys = Object.keys(files).sort(byteOrder);
	const canonical = JSON.stringify([main, keys.map((k) => [k, files[k]])]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A file row for `text`, keeping the sync state of the row it replaces. */
export function fileRow(
	vault: string,
	path: VaultPath,
	text: string,
	prev?: Pick<FileRow, 'base' | 'rev'>
): FileRow {
	const base = prev?.base ?? null;
	return {
		vault,
		path,
		text,
		base,
		rev: prev?.rev ?? null,
		dirty: base === null || text !== base,
		...textInfo(text)
	};
}

export interface NewVault {
	id?: string;
	name: string;
	provider: ProviderId;
	main: VaultPath;
	files?: Readonly<Record<VaultPath, string>>;
}

/** What a set of new files would do to the vault. */
export interface FilePlan {
	/** Paths not in the vault yet. */
	added: VaultPath[];
	/** Paths in the vault with exactly this text already. */
	same: VaultPath[];
	/** Paths in the vault with different text: written only when listed in `overwrite`. */
	conflicts: VaultPath[];
}

type FilesTx = IDBPTransaction<FastiSchema, ('files' | 'undo')[], 'readwrite'>;

/** Abort a transaction if it is still running, without an unhandled rejection. */
function abort(tx: { abort(): void; done: Promise<void> }): void {
	tx.done.catch(() => undefined);
	try {
		tx.abort();
	} catch {
		// Already finished: nothing was written by the failed step.
	}
}

export class Vault {
	private constructor(
		readonly db: FastiDB,
		readonly id: string
	) {}

	/** Every vault on this device. */
	static list(db: FastiDB): Promise<VaultRecord[]> {
		return db.getAll('vaults');
	}

	/** An existing vault, or null. */
	static async open(db: FastiDB, id: string): Promise<Vault | null> {
		return (await db.get('vaults', id)) ? new Vault(db, id) : null;
	}

	/** Make a vault with these files. */
	static async create(db: FastiDB, init: NewVault): Promise<Vault> {
		const id = init.id ?? crypto.randomUUID();
		const record: VaultRecord = {
			id,
			name: init.name,
			provider: init.provider,
			main: checkMain(init.main),
			createdAt: Date.now(),
			lastSync: null
		};
		const rows = Object.entries(init.files ?? {}).map(([path, text]) =>
			fileRow(id, checkPath(path), text)
		);
		const tx = db.transaction(['vaults', 'files', 'undo'], 'readwrite');
		if (await tx.objectStore('vaults').get(id)) {
			abort(tx);
			throw new Error(`A vault with id ${id} exists`);
		}
		await tx.objectStore('vaults').put(record);
		for (const row of rows) await tx.objectStore('files').put(row);
		await tx.objectStore('undo').put({ vault: id, undo: [], redo: [] });
		await tx.done;
		return new Vault(db, id);
	}

	/** Remove a vault and all its files from this device. */
	static async destroy(db: FastiDB, id: string): Promise<void> {
		const tx = db.transaction(['vaults', 'files', 'undo'], 'readwrite');
		const files = tx.objectStore('files');
		for (const key of await files.index('vault').getAllKeys(id)) await files.delete(key);
		await tx.objectStore('undo').delete(id);
		await tx.objectStore('vaults').delete(id);
		await tx.done;
	}

	async record(): Promise<VaultRecord> {
		const r = await this.db.get('vaults', this.id);
		if (!r) throw new Error(`Vault ${this.id} is gone`);
		return r;
	}

	private async updateRecord(patch: Partial<Omit<VaultRecord, 'id'>>): Promise<VaultRecord> {
		const tx = this.db.transaction('vaults', 'readwrite');
		const r = await tx.store.get(this.id);
		if (!r) throw new Error(`Vault ${this.id} is gone`);
		const next = { ...r, ...patch };
		await tx.store.put(next);
		await tx.done;
		return next;
	}

	/** Point Remind at another file or directory. */
	async setMain(main: VaultPath): Promise<VaultRecord> {
		return this.updateRecord({ main: checkMain(main) });
	}

	rename(name: string): Promise<VaultRecord> {
		return this.updateRecord({ name });
	}

	/** Every file row. */
	rows(): Promise<FileRow[]> {
		return this.db.getAllFromIndex('files', 'vault', this.id);
	}

	/** Every path, in byte order. */
	async paths(): Promise<VaultPath[]> {
		return (await this.rows()).map((r) => r.path).sort(byteOrder);
	}

	/** Every file's text, keyed by path. */
	async files(): Promise<Record<VaultPath, string>> {
		const out: Record<VaultPath, string> = {};
		for (const r of await this.rows()) out[r.path] = r.text;
		return out;
	}

	row(path: VaultPath): Promise<FileRow | undefined> {
		return this.db.get('files', [this.id, path]);
	}

	/** A file's text, or null when it doesn't exist. */
	async read(path: VaultPath): Promise<string | null> {
		return (await this.row(path))?.text ?? null;
	}

	/** What the engine runs on: the main entry and every file, with a content hash. */
	async snapshot(): Promise<VaultSnapshot> {
		const tx = this.db.transaction(['vaults', 'files']);
		const record = await tx.objectStore('vaults').get(this.id);
		const rows = await tx.objectStore('files').index('vault').getAll(this.id);
		await tx.done;
		if (!record) throw new Error(`Vault ${this.id} is gone`);
		const files: Record<VaultPath, string> = {};
		for (const r of rows) files[r.path] = r.text;
		return { main: record.main, files, hash: await snapshotHash(record.main, files) };
	}

	/** Which files Remind reads from the main entry, and what Fasti can't follow. */
	async discover(): Promise<Discovery> {
		const s = await this.snapshot();
		return discover(s.files, s.main);
	}

	/* ------------------------------- changes ------------------------------- */

	/**
	 * Apply changes in one transaction and push them as one undo step. `make`
	 * gets a reader for current texts and returns the changes (or null for
	 * none); it must not await anything but `read`.
	 */
	private async change<T>(
		label: string,
		make: (read: (path: VaultPath) => Promise<FileRow | undefined>) => Promise<{
			changes: Change[];
			result: T;
		} | null>
	): Promise<T | null> {
		const tx = this.db.transaction(['files', 'undo'], 'readwrite');
		const files = tx.objectStore('files');
		try {
			const made = await make((path) => files.get([this.id, path]));
			if (!made || !made.changes.length) {
				await tx.done;
				return made ? made.result : null;
			}
			await this.write(tx, made.changes, 'forward');
			const undo = tx.objectStore('undo');
			const rec: UndoRecord = (await undo.get(this.id)) ?? { vault: this.id, undo: [], redo: [] };
			rec.undo.push({ label, at: Date.now(), changes: made.changes });
			if (rec.undo.length > UNDO_LIMIT) rec.undo.splice(0, rec.undo.length - UNDO_LIMIT);
			rec.redo = [];
			await undo.put(rec);
			await tx.done;
			return made.result;
		} catch (e) {
			abort(tx);
			throw e;
		}
	}

	/** Write changes forward or backward, checking each still fits the file. */
	private async write(tx: FilesTx, changes: Change[], dir: 'forward' | 'back'): Promise<void> {
		const files = tx.objectStore('files');
		const list = dir === 'forward' ? changes : [...changes].reverse();
		for (const c of list) {
			const row = await files.get([this.id, c.path]);
			if (c.kind === 'patch') {
				if (!row) throw new UndoConflictError(c.path);
				const [e, expectLen] =
					dir === 'forward'
						? [c.edit, c.length - c.edit.insert.length + (c.edit.to - c.edit.from)]
						: [c.inverse, c.length];
				const want = dir === 'forward' ? c.inverse.insert : c.edit.insert;
				if (row.text.length !== expectLen || row.text.slice(e.from, e.to) !== want)
					throw new UndoConflictError(c.path);
				await files.put(fileRow(this.id, c.path, applyEdit(row.text, e), row));
			} else {
				const [from, to] = dir === 'forward' ? [c.before, c.after] : [c.after, c.before];
				if ((row?.text ?? null) !== from) throw new UndoConflictError(c.path);
				if (to === null) await files.delete([this.id, c.path]);
				else await files.put(fileRow(this.id, c.path, to, row));
			}
		}
	}

	/**
	 * Edit a file with a lens patch: `patch` gets the current text and returns
	 * a PatchResult (or null to do nothing). The edit is undoable.
	 */
	edit(
		path: VaultPath,
		patch: (text: string) => PatchResult | null,
		label = 'Edit'
	): Promise<PatchResult | null> {
		return this.change(label, async (read) => {
			const row = await read(path);
			if (!row) throw new FileStateError(path, false);
			const r = patch(row.text);
			if (!r || (r.edit.from === r.edit.to && r.edit.insert === '')) return null;
			return {
				changes: [{ kind: 'patch', path, edit: r.edit, inverse: r.inverse, length: r.text.length }],
				result: r
			};
		});
	}

	/** Apply a raw edit (from the editor), recording its inverse. */
	applyEdit(path: VaultPath, edit: Edit, label = 'Edit'): Promise<PatchResult | null> {
		return this.edit(
			path,
			(text) => {
				if (edit.from < 0 || edit.to < edit.from || edit.to > text.length)
					throw new RangeError(`Edit ${edit.from}..${edit.to} is outside ${path}`);
				const next = applyEdit(text, edit);
				return {
					text: next,
					edit,
					inverse: {
						from: edit.from,
						to: edit.from + edit.insert.length,
						insert: text.slice(edit.from, edit.to)
					}
				};
			},
			label
		);
	}

	/** Make a new file. Fails when it exists. */
	async createFile(path: VaultPath, text: string, label = `New ${path}`): Promise<void> {
		checkPath(path);
		await this.change(label, async (read) => {
			if (await read(path)) throw new FileStateError(path, true);
			return { changes: [{ kind: 'file', path, before: null, after: text }], result: undefined };
		});
	}

	/** Remove a file (undoable). */
	async removeFile(path: VaultPath, label = `Delete ${path}`): Promise<void> {
		await this.change(label, async (read) => {
			const row = await read(path);
			if (!row) throw new FileStateError(path, false);
			return {
				changes: [{ kind: 'file', path, before: row.text, after: null }],
				result: undefined
			};
		});
	}

	/** Compare new files with the vault, without writing. */
	async plan(files: Readonly<Record<VaultPath, string>>): Promise<FilePlan> {
		const plan: FilePlan = { added: [], same: [], conflicts: [] };
		for (const [path, text] of Object.entries(files)) {
			const cur = await this.read(checkPath(path));
			if (cur === null) plan.added.push(path);
			else if (cur === text) plan.same.push(path);
			else plan.conflicts.push(path);
		}
		for (const k of Object.values(plan)) k.sort(byteOrder);
		return plan;
	}

	/**
	 * Add files (an import) as one undo step. A path that exists with other
	 * text is written only when it is in `overwrite` (the user chose to
	 * replace it); otherwise it is left alone and listed in `conflicts`.
	 */
	async addFiles(
		files: Readonly<Record<VaultPath, string>>,
		label = 'Import',
		overwrite: Iterable<VaultPath> = []
	): Promise<FilePlan> {
		const allow = new Set(overwrite);
		const result = await this.change(label, async (read) => {
			const plan: FilePlan = { added: [], same: [], conflicts: [] };
			const changes: Change[] = [];
			for (const [path, text] of Object.entries(files)) {
				const row = await read(checkPath(path));
				if (!row) {
					plan.added.push(path);
					changes.push({ kind: 'file', path, before: null, after: text });
				} else if (row.text === text) plan.same.push(path);
				else if (allow.has(path)) {
					plan.added.push(path);
					changes.push({ kind: 'file', path, before: row.text, after: text });
				} else plan.conflicts.push(path);
			}
			for (const k of Object.values(plan)) k.sort(byteOrder);
			return { changes, result: plan };
		});
		return result!;
	}

	/* --------------------------------- undo -------------------------------- */

	private async step(from: 'undo' | 'redo'): Promise<UndoStep | null> {
		const tx = this.db.transaction(['files', 'undo'], 'readwrite');
		const undo = tx.objectStore('undo');
		const rec = await undo.get(this.id);
		const step = rec?.[from].at(-1);
		if (!rec || !step) {
			await tx.done;
			return null;
		}
		try {
			await this.write(tx, step.changes, from === 'undo' ? 'back' : 'forward');
		} catch (e) {
			abort(tx);
			throw e;
		}
		rec[from].pop();
		rec[from === 'undo' ? 'redo' : 'undo'].push(step);
		await undo.put(rec);
		await tx.done;
		return step;
	}

	/** Undo the last step; returns it, or null when there is nothing to undo. */
	undo(): Promise<UndoStep | null> {
		return this.step('undo');
	}

	/** Redo the last undone step. */
	redo(): Promise<UndoStep | null> {
		return this.step('redo');
	}

	/** The undo and redo stacks (oldest first). */
	async history(): Promise<{ undo: UndoStep[]; redo: UndoStep[] }> {
		const rec = await this.db.get('undo', this.id);
		return { undo: rec?.undo ?? [], redo: rec?.redo ?? [] };
	}

	async clearHistory(): Promise<void> {
		await this.db.put('undo', { vault: this.id, undo: [], redo: [] });
	}

	/* --------------------------------- sync -------------------------------- */

	/** Record that `path` now matches the remote at `rev` with text `base` (Phase 4). */
	async markSynced(path: VaultPath, base: string, rev: string | null): Promise<void> {
		const tx = this.db.transaction('files', 'readwrite');
		const row = await tx.store.get([this.id, path]);
		if (row) await tx.store.put(fileRow(this.id, path, row.text, { base, rev }));
		await tx.done;
	}

	/** Last-synced texts and revisions, by path (the shape Mycelium's sync engine reads). */
	async bases(): Promise<Map<VaultPath, { rev: string; source: string }>> {
		const out = new Map<VaultPath, { rev: string; source: string }>();
		for (const r of await this.rows())
			if (r.base !== null && r.rev !== null) out.set(r.path, { rev: r.rev, source: r.base });
		return out;
	}
}
