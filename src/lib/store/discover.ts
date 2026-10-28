// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which vault files Remind will read, found by following `DO`, `INCLUDE` and
 * directory includes from the main entry, plus diagnostics for what Fasti
 * can't follow. The rules mirror remind(1), "THE DO, INCLUDE AND SYSINCLUDE
 * COMMANDS", and the engine's MEMFS layout (docs/engine.md):
 *
 * - The vault is `/vault`, Remind's working directory. `INCLUDE` resolves
 *   against it; `DO` against the directory of the file being read.
 * - A directory target reads its `*.rem` files (not subdirectories, not
 *   dotfiles, as glob(3) does) in byte order.
 * - Includes nest at most 9 deep below the main entry (INCLUDE_NEST).
 * - `__EOF__` ends a file.
 *
 * Every include line is followed, even inside IF blocks (only Remind knows
 * which branch runs), so the list may hold a file a given run skips. This is
 * pure text analysis; it never runs anything.
 */
import type { VaultPath } from '../engine/types';
import { analyze } from '../lens/tokenize';
import type { LogicalLine } from '../lens/types';
import { BOM, byteOrder } from './text';

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
	| 'main-missing'
	| 'missing'
	| 'empty-dir'
	| 'outside'
	| 'computed'
	| 'stdin'
	| 'sysinclude'
	| 'includecmd'
	| 'cycle'
	| 'depth'
	| 'bom';

/** A problem with how the vault's files fit together, in file offsets. */
export interface VaultDiagnostic {
	/** The file holding the line (the main entry for `main-missing`). */
	path: VaultPath;
	/** Physical line, zero-based (the first line of a continued line). */
	line: number;
	from: number;
	to: number;
	severity: Severity;
	code: DiagnosticCode;
	message: string;
}

export interface Discovery {
	/** Files Remind reads, in the order it first reads them. */
	read: VaultPath[];
	diagnostics: VaultDiagnostic[];
}

/** Remind's INCLUDE_NEST: includes nested below the main entry. */
export const MAX_NESTING = 9;

/** Root of the vault in the engine's MEMFS; absolute targets under it stay in the vault. */
export const VAULT_ROOT = '/vault';

/** The directory part of a vault path (`''` for the root). */
export function dirname(path: VaultPath): VaultPath {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/**
 * Normalise a path relative to vault directory `base`. Returns null when it
 * leaves the vault (`..` above the root, or an absolute path outside
 * `/vault`). `''` is the vault root.
 */
export function resolvePath(base: VaultPath, target: string): VaultPath | null {
	let parts: string[];
	if (target.startsWith('/')) {
		if (target !== VAULT_ROOT && !target.startsWith(VAULT_ROOT + '/')) return null;
		parts = target.slice(VAULT_ROOT.length).split('/');
	} else parts = [...(base ? base.split('/') : []), ...target.split('/')];
	const out: string[] = [];
	for (const p of parts) {
		if (p === '' || p === '.') continue;
		if (p === '..') {
			if (!out.length) return null;
			out.pop();
		} else out.push(p);
	}
	return out.join('/');
}

/** Index of a vault's files: which paths are files and what each directory directly holds. */
class Tree {
	readonly dirs = new Map<VaultPath, VaultPath[]>();
	constructor(readonly files: Readonly<Record<VaultPath, string>>) {
		for (const path of Object.keys(files)) {
			let child = path;
			for (let dir = dirname(path); ; dir = dirname(dir)) {
				const list = this.dirs.get(dir);
				if (list) {
					if (!list.includes(child)) list.push(child);
				} else this.dirs.set(dir, [child]);
				if (dir === '') break;
				child = dir;
			}
		}
	}
	isFile(path: VaultPath): boolean {
		return Object.hasOwn(this.files, path);
	}
	isDir(path: VaultPath): boolean {
		return this.dirs.has(path);
	}
	/** The `*.rem` files directly in a directory, as glob(3) lists them. */
	remFiles(dir: VaultPath): VaultPath[] {
		return (this.dirs.get(dir) ?? [])
			.filter((p) => this.isFile(p))
			.filter((p) => {
				const name = p.slice(p.lastIndexOf('/') + 1);
				return name.endsWith('.rem') && !name.startsWith('.');
			})
			.sort(byteOrder);
	}
}

/** Find the files Remind reads from `main` and what Fasti can't follow. */
export function discover(files: Readonly<Record<VaultPath, string>>, main: VaultPath): Discovery {
	const tree = new Tree(files);
	const read: VaultPath[] = [];
	const done = new Set<VaultPath>();
	const diagnostics: VaultDiagnostic[] = [];
	const stack: VaultPath[] = [];

	const diag = (
		path: VaultPath,
		L: LogicalLine | null,
		tok: number | null,
		severity: Severity,
		code: DiagnosticCode,
		message: string
	) => {
		let from = L ? L.offset : 0;
		let to = L ? L.offset + L.raw.length : 0;
		const t = L && tok != null ? L.tokens[tok] : undefined;
		if (L && t) {
			from = L.offset + t.rawStart;
			to = L.offset + t.rawEnd;
		}
		diagnostics.push({ path, line: L ? L.start : 0, from, to, severity, code, message });
	};

	const visit = (path: VaultPath, depth: number) => {
		if (!done.has(path)) read.push(path);
		done.add(path);
		stack.push(path);
		const text = files[path]!;
		if (text.startsWith(BOM))
			diag(
				path,
				null,
				null,
				'warning',
				'bom',
				`${path} starts with a byte-order mark, which Remind reads as text on the first line`
			);
		for (const L of analyze(text)) {
			if (L.kind === 'eof') break;
			if (L.kind === 'engine' && L.cmd === 'INCLUDECMD') {
				diag(
					path,
					L,
					0,
					'warning',
					'includecmd',
					'INCLUDECMD runs a command, so Fasti never runs it'
				);
				continue;
			}
			if (L.kind !== 'include' || L.target == null) continue;
			const cmd = L.cmd!;
			const target = L.target;
			if (cmd === 'SYSINCLUDE') {
				diag(
					path,
					L,
					1,
					'warning',
					'sysinclude',
					`SYSINCLUDE reads Remind's system files, which Fasti doesn't have`
				);
				continue;
			}
			if (target === '-') {
				diag(
					path,
					L,
					1,
					'warning',
					'stdin',
					`${cmd} - reads standard input, which is empty in Fasti`
				);
				continue;
			}
			if (target.includes('[')) {
				diag(
					path,
					L,
					1,
					'info',
					'computed',
					`The file name is an expression, so Fasti can't tell which file ${cmd} reads`
				);
				continue;
			}
			const resolved = resolvePath(cmd === 'DO' ? dirname(path) : '', target);
			if (resolved == null) {
				diag(path, L, 1, 'error', 'outside', `${target} is outside the vault`);
				continue;
			}
			let targets: VaultPath[];
			if (tree.isFile(resolved)) targets = [resolved];
			else if (tree.isDir(resolved)) {
				targets = tree.remFiles(resolved);
				if (!targets.length) {
					diag(path, L, 1, 'error', 'empty-dir', `${target} has no *.rem files`);
					continue;
				}
			} else {
				diag(path, L, 1, 'error', 'missing', `${target} is not in the vault`);
				continue;
			}
			for (const t of targets) {
				if (stack.includes(t)) {
					diag(path, L, 1, 'error', 'cycle', `${t} includes itself through ${target}`);
				} else if (depth + 1 > MAX_NESTING) {
					diag(path, L, 1, 'error', 'depth', `Includes are nested more than ${MAX_NESTING} deep`);
				} else if (!done.has(t)) {
					visit(t, depth + 1);
				}
			}
		}
		stack.pop();
	};

	if (tree.isFile(main)) visit(main, 0);
	else if (tree.isDir(main)) {
		const list = tree.remFiles(main);
		if (!list.length)
			diag(main, null, null, 'error', 'main-missing', `${main || 'The vault'} has no *.rem files`);
		for (const p of list) if (!done.has(p)) visit(p, 0);
	} else
		diag(main, null, null, 'error', 'main-missing', `The main entry ${main} is not in the vault`);

	return { read, diagnostics };
}
