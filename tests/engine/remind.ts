// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Runs the WebAssembly build of Remind under Node for the engine tests.
 *
 * Mirrors what the engine worker will do (docs/engine.md): the module is
 * compiled once and every run gets a fresh instance (Remind keeps global
 * state), the vault is written to MEMFS under /vault/ with files 0600 and
 * directories 0700, the working directory is /vault, and `-r` is always the
 * first argument.
 *
 * Needs static/engine/remind.{mjs,wasm} from engine/build.sh.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const engineDir = join(root, 'static', 'engine');
const glue = join(engineDir, 'remind.mjs');
const wasm = join(engineDir, 'remind.wasm');

/** True once engine/build.sh has produced the module. */
export const engineBuilt = existsSync(glue) && existsSync(wasm);

interface EmStream {
	fd: number;
}

interface DeviceOps {
	open(stream: EmStream): void;
	close(stream: EmStream): void;
	read(stream: EmStream, buffer: Uint8Array, offset: number, length: number): number;
	write(stream: EmStream, buffer: Uint8Array, offset: number, length: number): number;
}

/** The parts of the Emscripten FS API the helper uses. */
interface EmFS {
	mkdir(path: string, mode?: number): void;
	writeFile(path: string, data: string | Uint8Array): void;
	chmod(path: string, mode: number): void;
	chdir(path: string): void;
	makedev(major: number, minor: number): number;
	registerDevice(dev: number, ops: DeviceOps): void;
	mkdev(path: string, mode: number, dev: number): void;
	open(path: string, flags: number): EmStream;
	close(stream: EmStream): void;
	getStream(fd: number): EmStream;
}

/**
 * Points file descriptor `fd` at a MEMFS character device that keeps whole
 * buffers. Emscripten's default stdout and stderr are TTYs that cross into
 * JavaScript once per character and make stdio line-buffered; on a big
 * calendar that was about a fifth of the run time.
 */
function capture(fs: EmFS, fd: number, major: number): Uint8Array[] {
	const chunks: Uint8Array[] = [];
	const dev = fs.makedev(major, 0);
	fs.registerDevice(dev, {
		open() {},
		close() {},
		read: () => 0,
		write(_stream, buffer, offset, length) {
			chunks.push(buffer.slice(offset, offset + length));
			return length;
		}
	});
	const path = `/dev/fasti${fd}`;
	fs.mkdev(path, 0o600, dev);
	fs.close(fs.getStream(fd));
	const stream = fs.open(path, 1 /* O_WRONLY */);
	if (stream.fd !== fd) throw new Error(`expected fd ${fd}, got ${stream.fd}`);
	return chunks;
}

function decode(chunks: Uint8Array[]): string {
	const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		bytes.set(c, at);
		at += c.length;
	}
	return new TextDecoder().decode(bytes).replace(/\n$/, '');
}

interface RemindModule {
	FS: EmFS;
	ENV: Record<string, string>;
	callMain(args: string[]): number | undefined;
}

interface ModuleOptions {
	print(text: string): void;
	printErr(text: string): void;
	onExit(code: number): void;
	preRun: Array<(module: RemindModule) => void>;
	instantiateWasm(
		imports: WebAssembly.Imports,
		receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
	): object;
}

type CreateRemind = (options: ModuleOptions) => Promise<RemindModule>;

let factory: Promise<{ create: CreateRemind; module: WebAssembly.Module }> | undefined;

function load() {
	factory ??= (async () => {
		const { default: create } = (await import(pathToFileURL(glue).href)) as {
			default: CreateRemind;
		};
		const module = await WebAssembly.compile(readFileSync(wasm));
		return { create, module };
	})();
	return factory;
}

export interface RunOptions {
	/** Extra environment variables (TZ, LANG, …). */
	env?: Record<string, string>;
	/** Extra MEMFS directories outside /vault (absolute paths), created 0700. */
	dirs?: string[];
	/** Files outside /vault (absolute paths), written 0600. */
	extraFiles?: Record<string, string | Uint8Array>;
	/** Mode overrides (absolute path to mode), applied after everything is written. */
	modes?: Record<string, number>;
	/**
	 * Zone names to list as empty files under /usr/share/zoneinfo/. Remind
	 * only checks TZ names when that directory exists (it stats the file), so
	 * this turns on its "No time zone file found" warning. Conversion itself
	 * never reads these files (engine/time-zone.js.in uses Intl).
	 */
	zoneNames?: string[];
}

export interface RunResult {
	/** Exit status of `main`. */
	code: number;
	stdout: string;
	stderr: string;
	/** Wall time of instantiation plus the run, in milliseconds. */
	ms: number;
}

function mkdirs(fs: EmFS, path: string, made: Set<string>) {
	let at = '';
	for (const part of path.split('/').filter(Boolean)) {
		at += `/${part}`;
		if (made.has(at)) continue;
		try {
			fs.mkdir(at, 0o700);
		} catch {
			// Exists already (/tmp, /home, …).
		}
		made.add(at);
	}
}

/**
 * Runs Remind once in a fresh instance.
 *
 * @param files vault files, keyed by path relative to /vault/ (subdirectories allowed)
 * @param args arguments after `-r` (which is always added first)
 */
export async function runRemind(
	files: Record<string, string>,
	args: string[],
	options: RunOptions = {}
): Promise<RunResult> {
	const { create, module } = await load();
	// print/printErr only see output written before capture() (none expected).
	const early: string[] = [];
	let exitCode: number | undefined;
	const start = performance.now();
	const instance = await create({
		print: (text) => early.push(text),
		printErr: (text) => early.push(text),
		onExit: (code) => {
			exitCode = code;
		},
		preRun: [
			(m) => {
				Object.assign(m.ENV, options.env ?? {});
			}
		],
		instantiateWasm(imports, receive) {
			void WebAssembly.instantiate(module, imports).then((inst) => receive(inst, module));
			return {};
		}
	});
	const fs = instance.FS;
	const out = capture(fs, 1, 64);
	const err = capture(fs, 2, 65);
	const made = new Set<string>();
	mkdirs(fs, '/vault', made);
	for (const dir of options.dirs ?? []) mkdirs(fs, dir, made);
	const write = (path: string, data: string | Uint8Array) => {
		mkdirs(fs, dirname(path), made);
		fs.writeFile(path, data);
		fs.chmod(path, 0o600);
	};
	for (const [name, text] of Object.entries(files)) write(`/vault/${name}`, text);
	for (const [path, data] of Object.entries(options.extraFiles ?? {})) write(path, data);
	for (const zone of options.zoneNames ?? []) write(`/usr/share/zoneinfo/${zone}`, '');
	for (const [path, mode] of Object.entries(options.modes ?? {})) fs.chmod(path, mode);
	fs.chdir('/vault');
	let code: number | undefined;
	try {
		code = instance.callMain(['-r', ...args]);
	} catch (e) {
		const status = (e as { status?: unknown }).status;
		if (typeof status !== 'number') throw e;
		code = status;
	}
	const ms = performance.now() - start;
	if (early.length) throw new Error(`output before capture: ${early.join('\n')}`);
	return {
		code: exitCode ?? code ?? 0,
		stdout: decode(out),
		stderr: decode(err),
		ms
	};
}

/** One entry of a `-ppp` calendar (rem2ps(1), CALENDAR ENTRIES). */
export interface CalendarEntry {
	date: string;
	filename: string;
	lineno: number;
	lineno_start?: number;
	body: string;
	priority: number;
	is_todo?: number;
	[key: string]: unknown;
}

/** One month descriptor of a `-ppp` calendar (rem2ps(1), PURE JSON INPUT FORMAT). */
export interface MonthDescriptor {
	caltype?: string;
	monthname: string;
	year: number;
	entries: CalendarEntry[];
	[key: string]: unknown;
}

/** One event object of `--json` agenda output (remind(1), AGENDA MODE JSON OUTPUT). */
export interface AgendaEvent {
	date: string;
	filename: string;
	lineno: number;
	body: string;
	is_todo?: number;
	[key: string]: unknown;
}

/** Number of calendar months from the month of `from` to the month of `to`, inclusive. */
export function monthSpan(from: string, to: string): number {
	const [fy, fm] = from.split('-').map(Number) as [number, number];
	const [ty, tm] = to.split('-').map(Number) as [number, number];
	return (ty - fy) * 12 + (tm - fm) + 1;
}
