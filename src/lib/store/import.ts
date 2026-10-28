// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Import from a file or folder picker, and export as a zip, keeping bytes
 * exact. Files are read as bytes and decoded by `decodeText` (no line-ending
 * normalisation; a BOM stays in the text, so it is written back on export).
 * A file that isn't UTF-8 is skipped and reported, never repaired.
 *
 * The pickers use the File System Access API where the browser has it and
 * fall back to `<input type="file">` (with `webkitdirectory` for folders).
 * Importing only reads: the caller hands the result to `Vault.addFiles`,
 * which never overwrites a changed file unless the user chose to.
 */
import type { VaultPath } from '../engine/types';
import { decodeText, NotUtf8Error } from './text';
import { checkPath } from './vault';
import { zipVault } from './zip';

/** Larger files are skipped: a reminder file is text, and this keeps a stray video out. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** At most this many files per import. */
export const MAX_FILES = 5000;

export type SkipReason = 'not-utf8' | 'too-large' | 'invalid-path' | 'too-many';

export interface ImportResult {
	/** Decoded texts by vault path. */
	files: Record<VaultPath, string>;
	skipped: { path: string; reason: SkipReason }[];
}

/** A file to import: where it goes in the vault and its contents. */
export interface ImportItem {
	path: string;
	blob: Blob;
}

/** Decode picked files into vault texts, skipping what isn't UTF-8 text. */
export async function readImport(items: Iterable<ImportItem>): Promise<ImportResult> {
	const out: ImportResult = { files: {}, skipped: [] };
	let count = 0;
	for (const { path, blob } of items) {
		try {
			checkPath(path);
		} catch {
			out.skipped.push({ path, reason: 'invalid-path' });
			continue;
		}
		if (blob.size > MAX_FILE_BYTES) {
			out.skipped.push({ path, reason: 'too-large' });
			continue;
		}
		if (++count > MAX_FILES) {
			out.skipped.push({ path, reason: 'too-many' });
			continue;
		}
		try {
			out.files[path] = decodeText(await blob.arrayBuffer(), path);
		} catch (e) {
			if (!(e instanceof NotUtf8Error)) throw e;
			out.skipped.push({ path, reason: 'not-utf8' });
		}
	}
	return out;
}

/** Whether a folder is hidden (`.git`, `.trash`); hidden files such as `.reminders` are kept. */
const hiddenDir = (parts: string[]) => parts.slice(0, -1).some((p) => p.startsWith('.'));

/**
 * Items from an `<input type="file">`. With `webkitdirectory` each file has a
 * `webkitRelativePath` starting with the chosen folder's name, which is
 * dropped so the folder's contents become the vault root.
 */
export function itemsFromFileList(list: Iterable<File>): ImportItem[] {
	const out: ImportItem[] = [];
	for (const file of list) {
		const rel = file.webkitRelativePath;
		const parts = rel ? rel.split('/').slice(1) : [file.name];
		if (hiddenDir(parts)) continue;
		out.push({ path: parts.join('/'), blob: file });
	}
	return out;
}

/** The parts of the File System Access API handles used here. */
export interface FileHandleLike {
	kind: 'file';
	name: string;
	getFile(): Promise<File>;
}
export interface DirectoryHandleLike {
	kind: 'directory';
	name: string;
	values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
}

/** Items from a directory handle, walked recursively, skipping hidden folders. */
export async function itemsFromDirectory(
	dir: DirectoryHandleLike,
	prefix = ''
): Promise<ImportItem[]> {
	const out: ImportItem[] = [];
	for await (const h of dir.values()) {
		const path = prefix + h.name;
		if (h.kind === 'directory') {
			if (!h.name.startsWith('.')) out.push(...(await itemsFromDirectory(h, path + '/')));
		} else out.push({ path, blob: await h.getFile() });
	}
	return out;
}

interface PickerWindow {
	showOpenFilePicker?: (o: { multiple: boolean }) => Promise<FileHandleLike[]>;
	showDirectoryPicker?: (o: { mode: 'read' }) => Promise<DirectoryHandleLike>;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Ask for files with a hidden `<input type="file">`; resolves with none on cancel. */
function inputPicker(folder: boolean): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		if (folder) input.webkitdirectory = true;
		input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
		input.addEventListener('cancel', () => resolve([]), { once: true });
		input.click();
	});
}

/** Pick one or more files and read them. Null when the user cancels. */
export async function pickFiles(): Promise<ImportResult | null> {
	const w = globalThis as unknown as PickerWindow;
	let items: ImportItem[];
	if (w.showOpenFilePicker) {
		try {
			const handles = await w.showOpenFilePicker({ multiple: true });
			items = await Promise.all(
				handles.map(async (h) => ({ path: h.name, blob: await h.getFile() }))
			);
		} catch (e) {
			if (isAbort(e)) return null;
			throw e;
		}
	} else items = itemsFromFileList(await inputPicker(false));
	return items.length ? readImport(items) : null;
}

/** Pick a folder and read every file in it (subfolders too, hidden ones skipped). Null on cancel. */
export async function pickFolder(): Promise<ImportResult | null> {
	const w = globalThis as unknown as PickerWindow;
	let items: ImportItem[];
	if (w.showDirectoryPicker) {
		try {
			items = await itemsFromDirectory(await w.showDirectoryPicker({ mode: 'read' }));
		} catch (e) {
			if (isAbort(e)) return null;
			throw e;
		}
	} else items = itemsFromFileList(await inputPicker(true));
	return items.length ? readImport(items) : null;
}

/** The vault as a zip file. */
export function exportZip(files: Readonly<Record<VaultPath, string>>): Blob {
	return new Blob([zipVault(files)], { type: 'application/zip' });
}

/** Offer the vault as a zip download named `name`. */
export function downloadZip(files: Readonly<Record<VaultPath, string>>, name: string): void {
	const url = URL.createObjectURL(exportZip(files));
	const a = document.createElement('a');
	a.href = url;
	a.download = name.endsWith('.zip') ? name : `${name}.zip`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
