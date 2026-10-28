// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Runs Remind once, in a fresh WebAssembly instance (docs/engine.md, "Running
 * Remind"). Used by the engine worker; free of DOM and Node APIs so the tests
 * can drive the same code.
 *
 * The contract: the module is compiled once and every run instantiates it
 * anew (Remind keeps global state); stdout and stderr go to MEMFS character
 * devices that keep whole buffers; the vault is written under /vault/ with
 * directories 0700 and files 0600 (Remind refuses world-writable files) and
 * the working directory is /vault; `TZ` comes from the request; and `-r` is
 * always the first argument.
 */

interface EmStream {
	fd: number;
}

interface DeviceOps {
	open(stream: EmStream): void;
	close(stream: EmStream): void;
	read(stream: EmStream, buffer: Uint8Array, offset: number, length: number): number;
	write(stream: EmStream, buffer: Uint8Array, offset: number, length: number): number;
}

/** The parts of the Emscripten FS API used here. */
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

/** The default export of static/engine/remind.mjs. */
export type CreateRemind = (options: ModuleOptions) => Promise<RemindModule>;

/** A compiled engine: the Emscripten factory and the compiled `remind.wasm`. */
export interface Engine {
	create: CreateRemind;
	module: WebAssembly.Module;
}

export interface RunInput {
	/** Vault files keyed by vault-relative path, written under /vault/. */
	files: Readonly<Record<string, string>>;
	/** Files outside the vault (absolute paths), e.g. Fasti's generated wrappers. */
	extraFiles?: Readonly<Record<string, string>>;
	/** Arguments after `-r`, which is always added first. */
	args: readonly string[];
	/** IANA zone for `TZ`; empty or absent uses the host zone. */
	tz?: string;
}

export interface RunOutput {
	/** Exit status of `main` (or of `EXIT`). */
	code: number;
	stdout: string;
	stderr: string;
	/** Instantiation plus the run, in milliseconds. */
	ms: number;
}

/**
 * Points `fd` at a MEMFS character device that keeps whole buffers.
 * Emscripten's default TTYs cross into JavaScript once per byte and make
 * stdio line-buffered, which cost about a fifth of a big calendar.
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
	return new TextDecoder().decode(bytes);
}

function mkdirs(fs: EmFS, path: string, made: Set<string>): void {
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

const parent = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Runs Remind once in a fresh instance of `engine`. */
export async function runRemind(engine: Engine, input: RunInput): Promise<RunOutput> {
	const early: string[] = [];
	let exitCode: number | undefined;
	const start = performance.now();
	const instance = await engine.create({
		print: (text) => early.push(text),
		printErr: (text) => early.push(text),
		onExit: (code) => {
			exitCode = code;
		},
		preRun: [
			(m) => {
				if (input.tz) m.ENV.TZ = input.tz;
			}
		],
		instantiateWasm(imports, receive) {
			void WebAssembly.instantiate(engine.module, imports).then((inst) =>
				receive(inst, engine.module)
			);
			return {};
		}
	});
	const fs = instance.FS;
	const out = capture(fs, 1, 64);
	const err = capture(fs, 2, 65);
	const made = new Set<string>();
	mkdirs(fs, '/vault', made);
	const write = (path: string, data: string) => {
		mkdirs(fs, parent(path), made);
		fs.writeFile(path, data);
		fs.chmod(path, 0o600);
	};
	for (const [name, text] of Object.entries(input.files)) write(`/vault/${name}`, text);
	for (const [path, text] of Object.entries(input.extraFiles ?? {})) write(path, text);
	fs.chdir('/vault');
	let code: number | undefined;
	try {
		code = instance.callMain(['-r', ...input.args]);
	} catch (e) {
		const status = (e as { status?: unknown }).status;
		if (typeof status !== 'number') throw e;
		code = status;
	}
	const ms = performance.now() - start;
	const stderr = decode(err) + early.map((line) => `${line}\n`).join('');
	return { code: exitCode ?? code ?? 0, stdout: decode(out), stderr, ms };
}
