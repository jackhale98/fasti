// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Typed parsing of Remind's output (docs/engine.md has the shapes):
 * agenda JSON (`--json`), monthly calendar JSON (`-ppp`), the lines Fasti's
 * own probes print, and diagnostics on stderr. Dates stay the strings Remind
 * printed; nothing here computes a date.
 */
import type {
	AgendaResult,
	CalendarDay,
	CalendarMonth,
	Diagnostic,
	OmitKind,
	ReminderEntry,
	VaultPath
} from './types.ts';

/** Where the worker writes the vault, and Remind's working directory. */
export const VAULT_DIR = '/vault';

/** SPECIAL type of the per-day entry the calendar wrapper adds (probes.ts). */
export const DAY_PROBE = 'FASTI-DAY';

/**
 * Turns a path Remind printed into a vault-relative path, or null for a file
 * outside the vault. Remind prints the path it opened: the main file and `DO`
 * targets are absolute (`/vault/sub/a.rem`), a relative `INCLUDE` stays
 * relative to the working directory, /vault (`sub/c.rem`).
 */
export function normalisePath(path: string): VaultPath | null {
	let rest: string;
	if (path.startsWith('/')) {
		if (path !== VAULT_DIR && !path.startsWith(`${VAULT_DIR}/`)) return null;
		rest = path.slice(VAULT_DIR.length);
	} else {
		rest = path;
	}
	const out: string[] = [];
	for (const part of rest.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (!out.length) return null;
			out.pop();
		} else out.push(part);
	}
	return out.join('/');
}

const DIAG = /^(.+?)\((\d+)\): (.*)$/;

/**
 * Parses stderr into diagnostics, deduplicated (calendar mode repeats each
 * one once per day). A line indented with whitespace continues the message
 * before it (Remind's call-frame notes). Lines matching `skip` are dropped.
 */
export function parseDiagnostics(stderr: string, skip?: RegExp): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const text of stderr.split('\n')) {
		if (!text.trim()) continue;
		if (skip?.test(text)) continue;
		const last = out[out.length - 1];
		if (/^\s/.test(text) && last) {
			last.message += `\n${text.trim()}`;
			continue;
		}
		const m = DIAG.exec(text);
		const file = m ? normalisePath(m[1]!) : null;
		const message = m ? m[3]! : text;
		out.push({
			file,
			line: m && file !== null ? Number(m[2]) : null,
			message: m && file === null ? text : message,
			warning: /^Warning:/.test(message)
		});
	}
	return dedupeDiagnostics(out);
}

/** Drops repeats of the same file, line and message, keeping the first. */
export function dedupeDiagnostics(list: readonly Diagnostic[]): Diagnostic[] {
	const seen = new Set<string>();
	return list.filter((d) => {
		const key = `${d.file ?? ''}\u0000${d.line ?? ''}\u0000${d.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `YYYY-MM-DDTHH:MM` into its date and minutes. */
function parseDateTime(v: unknown): { date: string; time: number } | null {
	const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(v) : null;
	return m ? { date: m[1]!, time: Number(m[2]) * 60 + Number(m[3]) } : null;
}

/**
 * One entry (rem2ps(1), CALENDAR ENTRIES; remind(1), AGENDA MODE JSON
 * OUTPUT) into a ReminderEntry, or null if it isn't one or lies outside the
 * vault (Fasti's probes).
 */
export function parseEntry(e: unknown): ReminderEntry | null {
	if (!isObject(e)) return null;
	const date = str(e.date);
	const filename = str(e.filename);
	const lineEnd = num(e.lineno);
	if (date === null || filename === null || lineEnd === null) return null;
	const file = normalisePath(filename);
	if (file === null) return null;
	const info: Record<string, string> = {};
	if (isObject(e.info)) {
		for (const [k, v] of Object.entries(e.info)) if (typeof v === 'string') info[k] = v;
	}
	const tags = str(e.tags);
	const r = num(e.r);
	const g = num(e.g);
	const b = num(e.b);
	const isTodo = e.is_todo === 1;
	const completeThrough = str(e.complete_through);
	const time = num(e.time);
	return {
		date,
		file,
		line: num(e.lineno_start) ?? lineEnd,
		lineEnd,
		body: str(e.body) ?? '',
		rawBody: str(e.rawbody),
		time,
		duration: num(e.duration) ?? num(e.eventduration),
		eventStart: parseDateTime(e.eventstart),
		priority: num(e.priority) ?? 5000,
		isTodo,
		completeThrough,
		completed: isTodo && completeThrough !== null && date <= completeThrough,
		tags: tags ? tags.split(',').filter(Boolean) : [],
		info,
		special: str(e.passthru),
		color: r !== null && g !== null && b !== null ? { r, g, b } : null,
		delta: num(e.delta),
		tz: str(e.tz),
		raw: e
	};
}

function parseJson(stdout: string, what: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new Error(`Remind's ${what} output is not JSON: ${stdout.slice(0, 120)}`);
	}
}

/** Agenda JSON: an array with an optional banner first and optional `noreminders` last. */
export function parseAgenda(stdout: string, stderr: string): AgendaResult {
	const diagnostics = parseDiagnostics(stderr);
	if (!stdout.trim()) return { banner: null, entries: [], diagnostics };
	const data = parseJson(stdout, 'agenda');
	if (!Array.isArray(data)) throw new Error("Remind's agenda output is not an array");
	let banner: string | null = null;
	const entries: ReminderEntry[] = [];
	for (const item of data) {
		if (isObject(item) && typeof item.banner === 'string') banner = item.banner;
		const entry = parseEntry(item);
		if (entry) entries.push(entry);
	}
	return { banner, entries, diagnostics };
}

/**
 * Monthly `-ppp` JSON from the calendar wrapper (probes.ts) into months.
 * Days come from the wrapper's per-day entries, which carry Remind's own
 * weekday number and omit flag; other entries outside the vault are dropped.
 */
export function parseCalendar(stdout: string): CalendarMonth[] {
	if (!stdout.trim()) return [];
	const data = parseJson(stdout, 'calendar');
	if (!Array.isArray(data)) throw new Error("Remind's calendar output is not an array");
	return data.filter(isObject).map(parseMonth);
}

function parseMonth(d: Json): CalendarMonth {
	const year = num(d.year) ?? 0;
	const days: CalendarDay[] = [];
	const byDate = new Map<string, CalendarDay>();
	const pending: ReminderEntry[] = [];
	for (const e of Array.isArray(d.entries) ? d.entries : []) {
		if (!isObject(e)) continue;
		if (
			e.passthru === DAY_PROBE &&
			typeof e.filename === 'string' &&
			e.filename.startsWith('/fasti/')
		) {
			const date = str(e.date);
			const m = /^(\d) (weekly|dated|-)$/.exec(str(e.body) ?? '');
			if (date === null || !m) continue;
			const day: CalendarDay = {
				date,
				day: Number(date.slice(8, 10)),
				weekday: Number(m[1]),
				omit: m[2] === '-' ? null : (m[2] as OmitKind),
				entries: []
			};
			days.push(day);
			byDate.set(date, day);
			continue;
		}
		const entry = parseEntry(e);
		if (entry) pending.push(entry);
	}
	for (const entry of pending) byDate.get(entry.date)?.entries.push(entry);
	const name = (k: string) => str(d[k]) ?? '';
	// Every day has a probe entry, so the first one names the month.
	const month = days[0]?.date.slice(0, 7) ?? '';
	return {
		month,
		year,
		monthNumber: Number(month.slice(5, 7)) || 0,
		monthName: name('monthname'),
		daysInMonth: num(d.daysinmonth) ?? days.length,
		firstWeekday: num(d.firstwkday) ?? 0,
		mondayFirst: d.mondayfirst === 1,
		dayNames: Array.isArray(d.daynames) ? d.daynames.map(String) : [],
		prev: {
			name: name('prevmonthname'),
			year: num(d.prevmonthyear) ?? year,
			days: num(d.daysinprevmonth) ?? 0
		},
		next: {
			name: name('nextmonthname'),
			year: num(d.nextmonthyear) ?? year,
			days: num(d.daysinnextmonth) ?? 0
		},
		days
	};
}
