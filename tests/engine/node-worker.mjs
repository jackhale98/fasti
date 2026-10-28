// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Runs src/lib/engine/worker.ts in a Node worker thread, as the browser runs
 * it in a module Web Worker: messages arrive as `onmessage({ data })` and go
 * back through `postMessage`. Node strips the TypeScript types itself.
 */
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('node-worker.mjs must run in a worker thread');
const port = parentPort;
/** The worker's global scope, as worker.ts sees it. */
const scope =
	/** @type {{ postMessage(m: unknown): void, onmessage?: (e: { data: unknown }) => void }} */ (
		/** @type {unknown} */ (globalThis)
	);
scope.postMessage = (/** @type {unknown} */ message) => port.postMessage(message);
port.on('message', (data) => scope.onmessage?.({ data }));
await import('../../src/lib/engine/worker.ts');
