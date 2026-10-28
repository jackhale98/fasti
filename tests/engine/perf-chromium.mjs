#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine performance check (docs/engine.md): times a 3-month `-ppp` calendar
 * of the 2,000-line fixture vault (tests/fixtures/vaults/large/) in Chromium,
 * with CPU throttling (CDP Emulation.setCPUThrottlingRate) as a proxy for a
 * mid-range phone. Budget: 150 ms at 4x.
 *
 * Each timed run is what the engine worker will do: a fresh instance of the
 * precompiled module, the vault written to MEMFS (0600), stdout and stderr
 * captured as buffers, `remind -r -ppp3 -b2 …`, then JSON.parse. Runs in a
 * module Worker (as the app will) and on the page's main thread; the budget
 * is judged on the main thread, because CDP throttling doesn't reach workers.
 *
 *   node tests/engine/perf-chromium.mjs [--rate 4] [--runs 9] [--months 3]
 *
 * Needs static/engine/ from engine/build.sh and a Chromium for Playwright.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
/** @param {string} name @param {number} fallback */
const opt = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at >= 0 ? Number(args[at + 1]) : fallback;
};
const RATE = opt('rate', 4);
const RUNS = opt('runs', 9);
const MONTHS = opt('months', 3);
const BUDGET_MS = 150;

const fixtureDir = join(root, 'tests', 'fixtures', 'vaults', 'large');
const vault = Object.fromEntries(
	readdirSync(fixtureDir).map((f) => [f, readFileSync(join(fixtureDir, f), 'utf8')])
);
const lines = Object.values(vault).reduce((n, t) => n + t.split('\n').length - 1, 0);

// Shared by the worker and the page: one timed run per call.
const benchModule = `
import createRemind from '/engine/remind.mjs';
const compiled = WebAssembly.compileStreaming(fetch('/engine/remind.wasm'));
export async function run(vault, args) {
	const module = await compiled;
	const t0 = performance.now();
	const m = await createRemind({
		print() {}, printErr() {},
		instantiateWasm(imports, receive) {
			WebAssembly.instantiate(module, imports).then((inst) => receive(inst, module));
			return {};
		}
	});
	const out = [];
	for (const [fd, major] of [[1, 64], [2, 65]]) {
		const dev = m.FS.makedev(major, 0);
		const sink = fd === 1 ? out : [];
		m.FS.registerDevice(dev, {
			open() {}, close() {}, read: () => 0,
			write(s, buf, off, len) { sink.push(buf.slice(off, off + len)); return len; }
		});
		m.FS.mkdev('/dev/fasti' + fd, 0o600, dev);
		m.FS.close(m.FS.getStream(fd));
		m.FS.open('/dev/fasti' + fd, 1);
	}
	m.FS.mkdir('/vault', 0o700);
	for (const [name, text] of Object.entries(vault)) {
		m.FS.writeFile('/vault/' + name, text);
		m.FS.chmod('/vault/' + name, 0o600);
	}
	m.FS.chdir('/vault');
	try { m.callMain(['-r', ...args]); } catch (e) { if (typeof e?.status !== 'number') throw e; }
	const t1 = performance.now();
	const bytes = new Uint8Array(out.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of out) { bytes.set(c, at); at += c.length; }
	const months = JSON.parse(new TextDecoder().decode(bytes));
	const t2 = performance.now();
	return { ms: t2 - t0, runMs: t1 - t0, entries: months.reduce((n, mo) => n + mo.entries.length, 0) };
}
`;
const workerModule = `
import { run } from '/bench.mjs';
onmessage = async ({ data }) => postMessage(await run(data.vault, data.args));
`;
const page = `<!doctype html><meta charset="utf-8"><title>engine bench</title>
<script type="module">
import { run } from '/bench.mjs';
const worker = new Worker('/worker.mjs', { type: 'module' });
window.inWorker = (vault, args) => new Promise((resolve) => {
	worker.onmessage = ({ data }) => resolve(data);
	worker.postMessage({ vault, args });
});
window.inPage = (vault, args) => run(vault, args);
window.ready = true;
</script>`;

const engine = join(root, 'static', 'engine');
if (!existsSync(join(engine, 'remind.wasm'))) {
	console.error('No static/engine/remind.wasm: run engine/build.sh first.');
	process.exit(1);
}
/** @type {Record<string, [string, string | Buffer]>} */
const routes = {
	'/': ['text/html', page],
	'/bench.mjs': ['text/javascript', benchModule],
	'/worker.mjs': ['text/javascript', workerModule],
	'/engine/remind.mjs': ['text/javascript', readFileSync(join(engine, 'remind.mjs'))],
	'/engine/remind.wasm': ['application/wasm', readFileSync(join(engine, 'remind.wasm'))]
};
const server = createServer((req, res) => {
	const route = routes[new URL(req.url ?? '/', 'http://x').pathname];
	if (!route) return void res.writeHead(404).end();
	res.writeHead(200, { 'content-type': route[0] }).end(route[1]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`;

/** Playwright's own Chromium, else one under PLAYWRIGHT_BROWSERS_PATH (as playwright.config.ts). */
function chromiumPath() {
	const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
	if (!base || !existsSync(base)) return undefined;
	for (const dir of readdirSync(base).sort().reverse()) {
		if (!dir.startsWith('chromium-')) continue;
		for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
			if (existsSync(join(base, dir, rel))) return join(base, dir, rel);
		}
	}
	return undefined;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
/** @param {number[]} xs */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const runArgs = [`-ppp${MONTHS}`, '-b2', '/vault/reminders.rem', '2026-10-01'];
/** @type {Record<string, { median: number; min: number; entries: number }>} */
const results = {};
try {
	for (const rate of [1, RATE]) {
		const context = await browser.newContext();
		const tab = await context.newPage();
		const cdp = await context.newCDPSession(tab);
		await tab.goto(url);
		await tab.waitForFunction(() => /** @type {any} */ (window).ready === true);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate });
		for (const where of ['inWorker', 'inPage']) {
			/** @type {number[]} */
			const times = [];
			let entries = 0;
			for (let i = 0; i < RUNS + 2; i++) {
				/** @type {{ ms: number; entries: number }} */
				const r = await tab.evaluate(
					([fn, v, a]) => /** @type {any} */ (window)[/** @type {string} */ (fn)](v, a),
					[where, vault, runArgs]
				);
				if (i >= 2) times.push(r.ms); // two warm-up runs
				entries = r.entries;
			}
			results[`${where} x${rate}`] = { median: median(times), min: Math.min(...times), entries };
		}
		await context.close();
	}
} finally {
	await browser.close();
	server.close();
}

console.log(
	`${lines}-line vault, ${MONTHS}-month -ppp calendar, ${RUNS} runs (fresh instance each), Chromium ${browser.version()}`
);
for (const [k, v] of Object.entries(results)) {
	console.log(
		`  ${k.padEnd(12)} median ${v.median.toFixed(0).padStart(5)} ms   min ${v.min.toFixed(0).padStart(5)} ms   ${v.entries} entries`
	);
}
// CDP's CPU throttling slows the page's main thread but not dedicated workers
// (compare "inWorker x1" with "inWorker x4"), so the budget is judged on the
// throttled main-thread run, the same code the worker runs.
const judged = results[`inPage x${RATE}`]?.median ?? Infinity;
console.log(
	`Budget ${BUDGET_MS} ms at x${RATE} (main thread; CDP doesn't throttle workers): ${judged <= BUDGET_MS ? 'PASS' : 'FAIL'}`
);
process.exitCode = judged <= BUDGET_MS ? 0 : 1;
