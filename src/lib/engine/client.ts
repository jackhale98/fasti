// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The app's engine API. Every date the app shows comes through here, from
 * Remind running in a small pool of Web Workers (worker.ts).
 *
 * - Pool: 2–4 workers by `navigator.hardwareConcurrency`, spawned on demand.
 * - Queue: highest priority first, then first come. A request made for a
 *   `view` supersedes that view's earlier request: if it is still queued it
 *   is dropped, if it is running its result is cached but not delivered.
 *   Either way the earlier promise rejects with an EngineAbortError.
 * - Timeout: a run over 3 s terminates its worker, spawns a fresh one and
 *   rejects with an EngineTimeoutError naming the file.
 * - Cache: results keyed by (engine build, vault hash, request, options) in
 *   memory and IndexedDB (cache.ts). Requests that depend on the clock (no
 *   explicit date) are never cached.
 * - Month first: a calendar is one run per month, the visible month queued
 *   ahead of the rest, so it arrives first and the others fill in.
 */
import { ResultCache, cacheKey, indexedDbStore } from './cache.ts';
import { dedupeDiagnostics } from './parse-json.ts';
import type {
	AgendaOp,
	CalendarMonthOp,
	EngineOp,
	EngineSource,
	FromWorker,
	NextDatesOp,
	OpResults,
	PreviewOp,
	ToWorker
} from './protocol.ts';
import type {
	AgendaResult,
	CalendarMonth,
	CalendarResult,
	Diagnostic,
	EngineNow,
	NextDatesResult,
	PreviewResult,
	VaultSnapshot
} from './types.ts';

/** The parts of a Worker the client uses (a Web Worker, or a test double). */
export interface WorkerLike {
	postMessage(message: ToWorker): void;
	terminate(): void;
	onmessage: ((event: { data: FromWorker }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export interface EngineOptions {
	/** Makes a worker. Default: the module worker in worker.ts. */
	createWorker?: () => WorkerLike;
	/** Where workers load Remind from. Default: static/engine/ under the app's base path. */
	source?: EngineSource | (() => EngineSource | Promise<EngineSource>);
	/** Number of workers. Default: hardwareConcurrency − 1, clamped to 2–4. */
	poolSize?: number;
	/** Per-run limit before the worker is replaced. Default 3000 ms. */
	timeoutMs?: number;
	/** Result cache; null disables caching. Default: memory plus IndexedDB. */
	cache?: ResultCache | null;
}

export interface CallOptions {
	/**
	 * The view asking (e.g. `month`, `inspector`). A new request for the same
	 * view supersedes the previous one.
	 */
	view?: string;
	signal?: AbortSignal;
	/** Higher runs sooner. Interactive requests default to 2, background months to 1. */
	priority?: number;
}

/** Rejection for a superseded or aborted request. */
export class EngineAbortError extends Error {
	override name = 'AbortError';
	constructor(message = 'Superseded by a newer request') {
		super(message);
	}
}

/** Remind failed or the worker crashed. */
export class EngineError extends Error {
	override name = 'EngineError';
}

/** A run exceeded the time limit; its worker was replaced. */
export class EngineTimeoutError extends EngineError {
	override name = 'EngineTimeoutError';
	/** The vault file named in the message. */
	readonly file: string;
	constructor(file: string, ms: number) {
		super(
			`Remind took longer than ${ms / 1000} s on ${file || 'the vault folder'} and was stopped. ` +
				'A SATISFY clause or an expression there (or in a file it includes) may never finish.'
		);
		this.file = file;
	}
}

export interface AgendaOptions {
	/** `YYYY-MM-DD`; absent uses Remind's own today (and the result isn't cached). */
	date?: string;
	/** `HH:MM`, Remind's notion of now (needs `date`). */
	time?: string;
	/** IANA zone; Remind's local zone. */
	tz?: string;
}

export interface CalendarOptions {
	/** First month, `YYYY-MM`. */
	month: string;
	/** Number of months (default 1). */
	months?: number;
	mondayFirst?: boolean;
	hideCompletedTodos?: boolean;
	tz?: string;
}

export interface NextDatesOptions {
	/** Vault-relative file. */
	file: string;
	/** Any physical line of the reminder, 1-based. */
	line: number;
	/** How many dates (default 6). */
	count?: number;
	/** `YYYY-MM-DD` to start from; absent uses Remind's today (and isn't cached). */
	from?: string;
	tz?: string;
}

export interface PreviewOptions extends NextDatesOptions {
	/** The edited text of the reminder's logical line (may hold `\` continuations). */
	newText: string;
}

export interface DiagnosticsOptions {
	date?: string;
	tz?: string;
}

/**
 * `YYYY-MM` plus n months. This steps month labels for the calendar's
 * request list; it never decides which day anything falls on. Each month's
 * days and dates come from Remind.
 */
export function addMonths(month: string, n: number): string {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m) throw new Error(`Invalid month ${month}`);
	const index = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
	return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * Calls `fn` once `ms` (default 120) after the last call; for runs while the
 * user types. `flush()` runs a pending call now, `cancel()` drops it.
 */
export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	ms = 120
): ((...args: A) => void) & { cancel(): void; flush(): void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: A | undefined;
	const run = () => {
		timer = undefined;
		const args = pending;
		pending = undefined;
		if (args) fn(...args);
	};
	return Object.assign(
		(...args: A) => {
			pending = args;
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(run, ms);
		},
		{
			cancel() {
				if (timer !== undefined) clearTimeout(timer);
				timer = undefined;
				pending = undefined;
			},
			flush() {
				if (timer !== undefined) clearTimeout(timer);
				run();
			}
		}
	);
}

interface Waiter {
	resolve(value: unknown): void;
	reject(error: unknown): void;
	ticket: Ticket | null;
	settled: boolean;
	job: Job | null;
}

/** One logical call; cancelling it rejects all its waiters (a calendar has one per month). */
interface Ticket {
	view: string | undefined;
	waiters: Set<Waiter>;
	cancelled: boolean;
}

interface Job {
	id: number;
	key: string | null;
	request: EngineOp & { vault: { main: string; files: Readonly<Record<string, string>> } };
	/** Named in a timeout error. */
	file: string;
	priority: number;
	seq: number;
	waiters: Set<Waiter>;
	slot: Slot | null;
}

interface Slot {
	worker: WorkerLike;
	job: Job | null;
	timer: ReturnType<typeof setTimeout> | undefined;
}

function defaultPoolSize(): number {
	const cores =
		typeof navigator !== 'undefined' && navigator.hardwareConcurrency
			? navigator.hardwareConcurrency
			: 2;
	return Math.max(2, Math.min(4, cores - 1));
}

async function defaultSource(): Promise<EngineSource> {
	const paths = await import('$app/paths');
	// static/engine/ is a build output, so it may be missing from the typed asset list.
	const asset = paths.asset as (file: string) => string;
	const absolute = (path: string) => new URL(asset(path), location.href).href;
	return { glue: absolute('engine/remind.mjs'), wasm: absolute('engine/remind.wasm') };
}

function defaultWorker(): WorkerLike {
	return new Worker(new URL('./worker.ts', import.meta.url), {
		type: 'module',
		name: 'fasti-engine'
	}) as unknown as WorkerLike;
}

/** The engine client. Most code uses the functions at the end of this file instead. */
export class EngineClient {
	readonly #createWorker: () => WorkerLike;
	readonly #source: Promise<EngineSource>;
	readonly #poolSize: number;
	readonly #timeoutMs: number;
	readonly #cache: ResultCache | null;
	readonly #slots: Slot[] = [];
	readonly #queue: Job[] = [];
	readonly #jobs = new Map<string, Job>();
	readonly #views = new Map<string, Ticket>();
	#nextId = 1;
	#seq = 0;
	#disposed = false;

	constructor(options: EngineOptions = {}) {
		this.#createWorker = options.createWorker ?? defaultWorker;
		const source = options.source ?? defaultSource;
		this.#source = Promise.resolve(typeof source === 'function' ? source() : source);
		// Report a bad source once, per request, rather than as an unhandled rejection.
		this.#source.catch(() => {});
		this.#poolSize = Math.max(1, options.poolSize ?? defaultPoolSize());
		this.#timeoutMs = options.timeoutMs ?? 3000;
		this.#cache =
			options.cache === undefined ? new ResultCache({ store: indexedDbStore() }) : options.cache;
	}

	/** Workers currently alive (for tests and the About screen). */
	get workers(): number {
		return this.#slots.length;
	}

	/** Remind's agenda for a day. */
	agenda(
		vault: VaultSnapshot,
		options: AgendaOptions = {},
		call: CallOptions = {}
	): Promise<AgendaResult> {
		const op: AgendaOp = { op: 'agenda', ...options };
		return this.#submit(vault, op, vault.main, call) as Promise<AgendaResult>;
	}

	/**
	 * A calendar of `months` months from `month`, one Remind run per month.
	 * The first month is queued first (and at higher priority), so it arrives
	 * first; `onMonth` sees each month as it arrives.
	 */
	async calendar(
		vault: VaultSnapshot,
		options: CalendarOptions,
		call: CallOptions & { onMonth?: (month: CalendarMonth, index: number) => void } = {}
	): Promise<CalendarResult> {
		const count = Math.max(1, Math.min(options.months ?? 1, 24));
		const ticket = this.#ticket(call);
		const parts = Array.from({ length: count }, (_, i) => {
			const op: CalendarMonthOp = {
				op: 'calendarMonth',
				month: addMonths(options.month, i),
				mondayFirst: options.mondayFirst,
				hideCompletedTodos: options.hideCompletedTodos,
				tz: options.tz
			};
			const priority = call.priority ?? (i === 0 ? 2 : 1);
			return (
				this.#enqueue(vault, op, vault.main, priority, ticket) as Promise<
					OpResults['calendarMonth']
				>
			).then((r) => {
				call.onMonth?.(r.month, i);
				return r;
			});
		});
		let results: OpResults['calendarMonth'][];
		try {
			results = await Promise.all(parts);
		} finally {
			this.#release(ticket);
		}
		return {
			months: results.map((r) => r.month),
			diagnostics: dedupeDiagnostics(results.flatMap((r) => r.diagnostics))
		};
	}

	/** The next dates of one line, in its real context (the inspector's next 6 dates). */
	nextDates(
		vault: VaultSnapshot,
		options: NextDatesOptions,
		call: CallOptions = {}
	): Promise<NextDatesResult> {
		const op: NextDatesOp = { op: 'nextDates', ...options };
		return this.#submit(vault, op, options.file, call) as Promise<NextDatesResult>;
	}

	/**
	 * The next dates of an edited line, with `newText` in place of the line in
	 * a scratch copy of its file, so it keeps its real OMIT context. The
	 * diagnostics are the new text's own.
	 */
	preview(
		vault: VaultSnapshot,
		options: PreviewOptions,
		call: CallOptions = {}
	): Promise<PreviewResult> {
		const op: PreviewOp = { op: 'preview', ...options };
		return this.#submit(vault, op, options.file, call) as Promise<PreviewResult>;
	}

	/** Remind's diagnostics for the vault (an agenda-mode run). */
	diagnostics(
		vault: VaultSnapshot,
		options: DiagnosticsOptions = {},
		call: CallOptions = {}
	): Promise<Diagnostic[]> {
		return this.#submit(vault, { op: 'diagnostics', ...options }, vault.main, call) as Promise<
			Diagnostic[]
		>;
	}

	/** Remind's today and current time in `tz` (never cached). */
	now(tz?: string, call: CallOptions = {}): Promise<EngineNow> {
		const empty: VaultSnapshot = { main: '', files: {}, hash: '' };
		return this.#submit(empty, { op: 'now', tz }, '', call) as Promise<EngineNow>;
	}

	/** Terminates every worker and rejects everything pending. */
	dispose(): void {
		this.#disposed = true;
		for (const job of [...this.#queue, ...this.#slots.map((s) => s.job)]) {
			if (job) this.#fail(job, new EngineAbortError('The engine was shut down'));
		}
		this.#queue.length = 0;
		for (const slot of this.#slots) {
			clearTimeout(slot.timer);
			slot.worker.terminate();
		}
		this.#slots.length = 0;
	}

	#submit(vault: VaultSnapshot, op: EngineOp, file: string, call: CallOptions): Promise<unknown> {
		const ticket = this.#ticket(call);
		const promise = this.#enqueue(vault, op, file, call.priority ?? 2, ticket);
		const done = () => this.#release(ticket);
		promise.then(done, done);
		return promise;
	}

	/** Starts a call: supersedes the view's previous call and wires the abort signal. */
	#ticket(call: CallOptions): Ticket {
		const ticket: Ticket = { view: call.view, waiters: new Set(), cancelled: false };
		if (call.view !== undefined) {
			const previous = this.#views.get(call.view);
			if (previous) this.#cancel(previous, new EngineAbortError());
			this.#views.set(call.view, ticket);
		}
		if (call.signal) {
			const abort = () => this.#cancel(ticket, new EngineAbortError('Aborted'));
			if (call.signal.aborted) abort();
			else call.signal.addEventListener('abort', abort, { once: true });
		}
		return ticket;
	}

	#release(ticket: Ticket): void {
		if (ticket.view !== undefined && this.#views.get(ticket.view) === ticket) {
			this.#views.delete(ticket.view);
		}
	}

	#cancel(ticket: Ticket, error: Error): void {
		ticket.cancelled = true;
		for (const waiter of ticket.waiters) this.#drop(waiter, error);
		this.#release(ticket);
	}

	/** Rejects one waiter and drops its job if nobody else waits on it and it hasn't started. */
	#drop(waiter: Waiter, error: Error): void {
		if (waiter.settled) return;
		waiter.settled = true;
		waiter.reject(error);
		const job = waiter.job;
		if (!job) return;
		job.waiters.delete(waiter);
		if (job.waiters.size === 0 && !job.slot) {
			const at = this.#queue.indexOf(job);
			if (at >= 0) this.#queue.splice(at, 1);
			if (job.key) this.#jobs.delete(job.key);
		}
	}

	#enqueue(
		vault: VaultSnapshot,
		op: EngineOp,
		file: string,
		priority: number,
		ticket: Ticket
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const waiter: Waiter = { resolve, reject, ticket, settled: false, job: null };
			if (this.#disposed) return reject(new EngineAbortError('The engine was shut down'));
			if (ticket.cancelled) return reject(new EngineAbortError());
			ticket.waiters.add(waiter);
			const key = this.#cache ? cacheKey(vault, op) : null;
			const start = () => {
				if (waiter.settled) return;
				const existing = key ? this.#jobs.get(key) : undefined;
				if (existing) {
					existing.waiters.add(waiter);
					existing.priority = Math.max(existing.priority, priority);
					waiter.job = existing;
					return;
				}
				const job: Job = {
					id: this.#nextId++,
					key,
					request: { ...op, vault: { main: vault.main, files: vault.files } },
					file,
					priority,
					seq: this.#seq++,
					waiters: new Set([waiter]),
					slot: null
				};
				waiter.job = job;
				if (key) this.#jobs.set(key, job);
				this.#queue.push(job);
				this.#pump();
			};
			if (!key || !this.#cache) return start();
			const hit = this.#cache.peek(key);
			if (hit !== undefined) return this.#settle(waiter, hit);
			this.#cache
				.get(key)
				.then((value) => (value !== undefined ? this.#settle(waiter, value) : start()), start);
		});
	}

	#settle(waiter: Waiter, value: unknown): void {
		if (waiter.settled) return;
		waiter.settled = true;
		waiter.ticket?.waiters.delete(waiter);
		waiter.resolve(value);
	}

	#spawn(): Slot {
		const worker = this.#createWorker();
		const slot: Slot = { worker, job: null, timer: undefined };
		worker.onmessage = ({ data }) => this.#message(slot, data);
		worker.onerror = (event) => {
			const message =
				event && typeof event === 'object' && 'message' in event
					? String((event as { message: unknown }).message)
					: 'The engine worker failed';
			this.#replace(slot);
			if (slot.job) this.#fail(slot.job, new EngineError(message));
			this.#pump();
		};
		this.#source.then(
			(source) => worker.postMessage({ type: 'init', source }),
			(e: unknown) => {
				// No engine to load: fail whatever this worker was given.
				if (slot.job)
					this.#fail(slot.job, new EngineError(`Could not load the engine: ${String(e)}`));
			}
		);
		this.#slots.push(slot);
		return slot;
	}

	/**
	 * Terminates a slot's worker and removes it; #pump spawns a fresh one when
	 * there is work (not here, so a worker that can't load never loops).
	 */
	#replace(slot: Slot): void {
		clearTimeout(slot.timer);
		slot.worker.onmessage = null;
		slot.worker.onerror = null;
		slot.worker.terminate();
		const at = this.#slots.indexOf(slot);
		if (at >= 0) this.#slots.splice(at, 1);
	}

	#pump(): void {
		if (this.#disposed) return;
		while (this.#queue.length) {
			let slot = this.#slots.find((s) => !s.job);
			if (!slot) {
				if (this.#slots.length >= this.#poolSize) return;
				slot = this.#spawn();
			}
			// Highest priority first, then oldest.
			let best = 0;
			for (let i = 1; i < this.#queue.length; i++) {
				const a = this.#queue[i]!;
				const b = this.#queue[best]!;
				if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
			}
			const [job] = this.#queue.splice(best, 1) as [Job];
			job.slot = slot;
			slot.job = job;
			slot.worker.postMessage({ type: 'run', id: job.id, request: job.request });
			slot.timer = setTimeout(() => this.#timeout(slot), this.#timeoutMs);
		}
	}

	#timeout(slot: Slot): void {
		const job = slot.job;
		this.#replace(slot);
		if (job) this.#fail(job, new EngineTimeoutError(job.file, this.#timeoutMs));
		this.#pump();
	}

	#message(slot: Slot, data: FromWorker): void {
		if (data.type !== 'result') return; // init errors surface on each request
		const job = slot.job;
		if (!job || job.id !== data.id) return;
		clearTimeout(slot.timer);
		slot.timer = undefined;
		slot.job = null;
		if (data.ok) {
			if (job.key) {
				this.#jobs.delete(job.key);
				this.#cache?.set(job.key, data.value);
			}
			for (const waiter of job.waiters) this.#settle(waiter, data.value);
		} else {
			this.#fail(job, new EngineError(data.error));
		}
		this.#pump();
	}

	#fail(job: Job, error: Error): void {
		if (job.key && this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
		if (job.slot) job.slot.job = null;
		job.slot = null;
		for (const waiter of job.waiters) {
			if (waiter.settled) continue;
			waiter.settled = true;
			waiter.ticket?.waiters.delete(waiter);
			waiter.reject(error);
		}
		job.waiters.clear();
	}
}

let shared: EngineClient | undefined;

/** The app-wide engine client (created on first use). */
export function engine(): EngineClient {
	return (shared ??= new EngineClient());
}

/** Remind's agenda for a day. */
export const agenda = (vault: VaultSnapshot, options?: AgendaOptions, call?: CallOptions) =>
	engine().agenda(vault, options, call);

/** A calendar, one run per month, the first month first. */
export const calendar = (
	vault: VaultSnapshot,
	options: CalendarOptions,
	call?: CallOptions & { onMonth?: (month: CalendarMonth, index: number) => void }
) => engine().calendar(vault, options, call);

/** The next dates of one line. */
export const nextDates = (vault: VaultSnapshot, options: NextDatesOptions, call?: CallOptions) =>
	engine().nextDates(vault, options, call);

/** A live preview of an edited line. */
export const preview = (vault: VaultSnapshot, options: PreviewOptions, call?: CallOptions) =>
	engine().preview(vault, options, call);

/** Remind's diagnostics for the vault. */
export const diagnostics = (
	vault: VaultSnapshot,
	options?: DiagnosticsOptions,
	call?: CallOptions
) => engine().diagnostics(vault, options, call);

/** Remind's today and current time. */
export const now = (tz?: string, call?: CallOptions) => engine().now(tz, call);
