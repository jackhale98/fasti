// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine worker (a module Web Worker). It compiles remind.wasm once, on
 * the client's `init` message, and runs each request in a fresh instance
 * (run.ts). The client sends one request at a time and terminates the worker
 * if a run takes too long, so nothing here needs a timeout.
 *
 * Imports carry `.ts` extensions so Node can also load this file directly
 * (the engine tests run it in a worker thread).
 */
import { runOp } from './ops.ts';
import type { EngineSource, FromWorker, ToWorker } from './protocol.ts';
import type { CreateRemind, Engine } from './run.ts';

interface WorkerScope {
	postMessage(message: FromWorker): void;
	onmessage: ((event: { data: ToWorker }) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

async function compile(wasm: EngineSource['wasm']): Promise<WebAssembly.Module> {
	if (wasm instanceof WebAssembly.Module) return wasm;
	if (typeof wasm !== 'string') return WebAssembly.compile(wasm as BufferSource);
	if (typeof WebAssembly.compileStreaming === 'function') {
		try {
			return await WebAssembly.compileStreaming(fetch(wasm));
		} catch {
			// A server that doesn't send application/wasm: fall back to bytes.
		}
	}
	const response = await fetch(wasm);
	if (!response.ok) throw new Error(`Could not load ${wasm}: ${response.status}`);
	return WebAssembly.compile(await response.arrayBuffer());
}

async function load(source: EngineSource): Promise<Engine> {
	const [glue, module] = await Promise.all([
		import(/* @vite-ignore */ source.glue) as Promise<{ default: CreateRemind }>,
		compile(source.wasm)
	]);
	return { create: glue.default, module };
}

// Runs may arrive before `init` (the client posts it once its URLs resolve).
let ready: (engine: Promise<Engine>) => void = () => {};
const engine = new Promise<Engine>((resolve) => {
	ready = resolve;
});
let queue: Promise<unknown> = Promise.resolve();

scope.onmessage = ({ data }) => {
	if (data.type === 'init') {
		const loading = load(data.source);
		loading.catch((e: unknown) => scope.postMessage({ type: 'init-error', error: String(e) }));
		ready(loading);
		return;
	}
	const { id, request } = data;
	queue = queue.then(async () => {
		const start = performance.now();
		try {
			const value = await runOp(await engine, request);
			scope.postMessage({ type: 'result', id, ok: true, value, ms: performance.now() - start });
		} catch (e) {
			scope.postMessage({
				type: 'result',
				id,
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			});
		}
	});
};
