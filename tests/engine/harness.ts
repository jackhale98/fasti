// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Helpers for the engine client tests: fixture vaults as VaultSnapshots, and
 * real engine workers in Node worker threads (node-worker.mjs) behind the
 * client's WorkerLike interface.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { EngineClient, type EngineOptions, type WorkerLike } from '../../src/lib/engine/client';
import type { EngineSource, FromWorker, ToWorker } from '../../src/lib/engine/protocol';
import type { Engine } from '../../src/lib/engine/run';
import type { VaultSnapshot } from '../../src/lib/engine/types';
import { engineDir } from './remind';

const fixtures = new URL('../fixtures/vaults/', import.meta.url);

/** A snapshot of tests/fixtures/vaults/<name>/ (or of the given files). */
export function snapshot(files: Record<string, string>, main = 'reminders.rem'): VaultSnapshot {
	const hash = createHash('sha256')
		.update(JSON.stringify([main, Object.entries(files).sort()]))
		.digest('hex');
	return { main, files, hash };
}

/** Reads a fixture vault, keyed by vault-relative path. */
export function fixtureFiles(name: string): Record<string, string> {
	const root = new URL(`${name}/`, fixtures).pathname;
	const out: Record<string, string> = {};
	const walk = (dir: string, prefix: string) => {
		for (const f of readdirSync(dir).sort()) {
			const full = join(dir, f);
			if (statSync(full).isDirectory()) walk(full, `${prefix}${f}/`);
			else out[`${prefix}${f}`] = readFileSync(full, 'utf8');
		}
	};
	walk(root, '');
	return out;
}

export const fixture = (name: string, main = 'reminders.rem') => snapshot(fixtureFiles(name), main);

/** The engine source for workers: the glue by file URL, the wasm as bytes. */
export function nodeSource(): EngineSource {
	return {
		glue: pathToFileURL(join(engineDir, 'remind.mjs')).href,
		wasm: new Uint8Array(readFileSync(join(engineDir, 'remind.wasm')))
	};
}

/** The compiled engine for calling ops.ts directly, in this thread. */
export async function nodeEngine(): Promise<Engine> {
	const { default: create } = (await import(pathToFileURL(join(engineDir, 'remind.mjs')).href)) as {
		default: Engine['create'];
	};
	return {
		create,
		module: await WebAssembly.compile(readFileSync(join(engineDir, 'remind.wasm')))
	};
}

const bootstrap = new URL('./node-worker.mjs', import.meta.url);

/** A real engine worker in a Node worker thread. */
export function nodeWorker(): WorkerLike & { thread: Worker } {
	const thread = new Worker(bootstrap);
	const like: WorkerLike & { thread: Worker } = {
		thread,
		onmessage: null,
		onerror: null,
		postMessage: (message: ToWorker) => thread.postMessage(message),
		terminate: () => void thread.terminate()
	};
	thread.on('message', (data: FromWorker) => like.onmessage?.({ data }));
	thread.on('error', (error) => like.onerror?.(error));
	return like;
}

/** An engine client on Node worker threads, without the IndexedDB cache. */
export function nodeClient(options: EngineOptions = {}): EngineClient & { spawned: () => number } {
	let spawned = 0;
	const client = new EngineClient({
		source: nodeSource(),
		cache: null,
		createWorker: () => {
			spawned++;
			return nodeWorker();
		},
		...options
	});
	return Object.assign(client, { spawned: () => spawned });
}
