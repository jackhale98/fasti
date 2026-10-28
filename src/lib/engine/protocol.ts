// SPDX-License-Identifier: GPL-2.0-or-later
/** Messages between the engine client (client.ts) and its workers (worker.ts). */
import type {
	AgendaResult,
	CalendarMonth,
	Diagnostic,
	EngineNow,
	NextDatesResult,
	PreviewResult
} from './types.ts';

/** The part of a VaultSnapshot a run needs. */
export interface VaultFiles {
	main: string;
	files: Readonly<Record<string, string>>;
}

export interface AgendaOp {
	op: 'agenda';
	/** `YYYY-MM-DD`; absent means Remind's own today. */
	date?: string;
	/** `HH:MM`; with a date, gives Remind's notion of now (and implies -q). */
	time?: string;
	tz?: string;
}

export interface CalendarMonthOp {
	op: 'calendarMonth';
	/** `YYYY-MM`. */
	month: string;
	mondayFirst?: boolean;
	hideCompletedTodos?: boolean;
	tz?: string;
}

export interface NextDatesOp {
	op: 'nextDates';
	file: string;
	line: number;
	count?: number;
	/** `YYYY-MM-DD`; absent means Remind's own today. */
	from?: string;
	tz?: string;
}

export interface PreviewOp extends Omit<NextDatesOp, 'op'> {
	op: 'preview';
	/** Replaces the logical line containing `line` (may hold `\` continuations). */
	newText: string;
}

export interface DiagnosticsOp {
	op: 'diagnostics';
	date?: string;
	tz?: string;
}

export interface NowOp {
	op: 'now';
	tz?: string;
}

export type EngineOp = AgendaOp | CalendarMonthOp | NextDatesOp | PreviewOp | DiagnosticsOp | NowOp;

/** What each operation resolves to. */
export interface OpResults {
	agenda: AgendaResult;
	calendarMonth: { month: CalendarMonth; diagnostics: Diagnostic[] };
	nextDates: NextDatesResult;
	preview: PreviewResult;
	diagnostics: Diagnostic[];
	now: EngineNow;
}

export type EngineRequest = EngineOp & { vault: VaultFiles };

/** Where the worker finds the engine: URLs, or (tests) the bytes or compiled module. */
export interface EngineSource {
	glue: string;
	wasm: string | ArrayBuffer | Uint8Array | WebAssembly.Module;
}

export type ToWorker =
	{ type: 'init'; source: EngineSource } | { type: 'run'; id: number; request: EngineRequest };

export type FromWorker =
	| { type: 'result'; id: number; ok: true; value: unknown; ms: number }
	| { type: 'result'; id: number; ok: false; error: string }
	| { type: 'init-error'; error: string };
