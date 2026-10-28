// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The notification schedule: today's and the next 8 days' queued `AT`
 * reminders, with the moments to notify, all from Remind (docs/PLAN.md 3.6).
 *
 * Where each piece comes from:
 *
 * - **The days.** Remind's today (`now()`), then a generated script on a tiny
 *   scratch vault prints `today()+1` … `today()+8` (see `dayScript`).
 * - **What is queued.** One agenda run per day, with that day as Remind's
 *   today. Each entry carries Remind's `time`, `tdelta`, `trep`, `noqueue`
 *   and `sched` keys (remind(1) TIMED REMINDERS; `dorem.c` prints them).
 * - **When to notify.** Remind can't list its queue in a run like ours: the
 *   queue exists only while Remind stays resident (`-z` daemon mode, or the
 *   background process it forks), and the engine always runs with `-q`. So
 *   the warning times are derived here from the `time`, `tdelta` and `trep`
 *   Remind returned, following `CalculateNextDtime()` in Remind's `queue.c`:
 *   the first warning at time − tdelta, then every trep minutes (trep
 *   defaults to tdelta) while before the time, then the time itself. This is
 *   minute arithmetic on Remind's own minutes of one day; it never works out
 *   a date. A warning before midnight belongs to an earlier day of the window
 *   by its index in Remind's list of days (Remind itself counts a day as 1440
 *   minutes here).
 * - **Which reminders.** As `ShouldQueueReminder()` in `dorem.c`: timed,
 *   not `NOQUEUE`, not `CAL` or `RUN` (Remind leaves those out of the agenda
 *   with `-r`), not before now, and only on the day the warning falls on.
 * - **The text.** The body Remind substituted. A body whose source line has
 *   `%` or `[` can change with the time (`%1`, `now()`), so it is fetched
 *   again from an agenda run at the notification's own date and time.
 * - **The clock.** Each notification's moment as epoch milliseconds comes
 *   from Remind too: `localtoutc()` of the local date and time, minus a
 *   fixed UTC instant (see `utcScript`).
 *
 * Limits: a `SCHED` function isn't evaluated (Remind ignores tdelta and trep
 * with SCHED; Fasti notifies at the `AT` time only). `ONCE` is not tracked.
 * A reminder dated after the window whose tdelta reaches back into it is
 * missed.
 */
import type { AgendaOptions, CallOptions } from '../engine/client.ts';
import type {
	AgendaResult,
	EngineNow,
	IsoDate,
	Minutes,
	ReminderEntry,
	VaultSnapshot
} from '../engine/types.ts';

/** The engine calls the schedule needs (src/lib/engine/client.ts provides them). */
export interface ScheduleEngine {
	agenda(vault: VaultSnapshot, options?: AgendaOptions, call?: CallOptions): Promise<AgendaResult>;
	now(tz?: string, call?: CallOptions): Promise<EngineNow>;
}

/** Today plus this many days. */
export const DAYS_AHEAD = 8;
/** Fasti's worker keeps at most 64 per subscription. */
export const MAX_NOTIFICATIONS = 64;
const MINUTES_PER_DAY = 1440;

export interface ScheduledNotification {
	/** Stable per notification: `<date>T<hh:mm>|<file>:<line>`. Also the notification's tag. */
	id: string;
	/** Day the notification is shown on (Remind's date). */
	date: IsoDate;
	/** Minute of that day to show it. */
	minute: Minutes;
	/** Epoch ms of that moment (from Remind's `localtoutc()`). */
	at: number;
	/** The reminder's own date and `AT` time. */
	eventDate: IsoDate;
	eventTime: Minutes;
	/** The body Remind substituted. */
	body: string;
	file: string;
	/** First line of the reminder (1-based). */
	line: number;
}

export interface Schedule {
	/** Remind's today and the next 8 days. */
	days: IsoDate[];
	/** Remind's now when planned. */
	now: EngineNow;
	/** Sorted by time, at most MAX_NOTIFICATIONS. */
	notifications: ScheduledNotification[];
	/**
	 * The last day whose notifications are all in `notifications`: the last day
	 * of the window, or earlier when the cap or `horizon` cut it short.
	 */
	through: IsoDate;
	/** True when some notifications in the window were left out. */
	truncated: boolean;
	/** Epoch ms of the start of tomorrow (Remind's next today), for re-planning. */
	nextDay: number | null;
}

/* ------------------------------------------------------------------ */
/* Minute arithmetic (pure)                                            */
/* ------------------------------------------------------------------ */

/**
 * The minutes at which Remind's queue issues a timed reminder, relative to
 * the midnight of its trigger day (may be negative: the day before). As
 * remind(1): `AT 12:00 +75 *30` gives 10:45, 11:15, 11:45 and 12:00, and
 * `AT 12:00 +45` gives 11:15 and 12:00. With SCHED, tdelta and trep are
 * ignored.
 */
export function queueTimes(time: Minutes, tdelta = 0, trep = 0, sched = false): Minutes[] {
	if (sched || !(tdelta > 0)) return [time];
	const rep = trep > 0 ? trep : tdelta;
	const out: Minutes[] = [];
	for (let t = time - tdelta; t < time; t += rep) out.push(t);
	out.push(time);
	return out;
}

/** Whether Remind would queue this agenda entry (ShouldQueueReminder, less the time checks). */
export function queueable(entry: ReminderEntry): boolean {
	if (entry.time === null) return false;
	if (entry.raw.noqueue === 1) return false;
	if (entry.completed) return false;
	// MSG, MSF and COLOR bodies are messages; other SPECIALs aren't.
	if (entry.special && !/^colou?r$/i.test(entry.special)) return false;
	return entry.body.trim() !== '';
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** One planned notification before it has a body and a clock time. */
export interface PlannedTime {
	day: number;
	minute: Minutes;
	entry: ReminderEntry;
}

/**
 * The notifications of a window of days, from each day's agenda (index =
 * position in `days`). `nowMinute` drops what's already past on day 0.
 * Sorted by day, minute, file and line.
 */
export function planTimes(
	days: readonly IsoDate[],
	agendas: readonly AgendaResult[],
	nowMinute: Minutes
): PlannedTime[] {
	// Each reminder's occurrences in the window: the day its trigger date is.
	const occurrences = new Map<string, { day: number; entry: ReminderEntry }[]>();
	agendas.forEach((agenda, day) => {
		for (const entry of agenda.entries) {
			// A string comparison of two dates Remind printed.
			if (entry.date !== days[day] || !queueable(entry)) continue;
			const key = `${entry.file}:${entry.line}`;
			const list = occurrences.get(key) ?? [];
			list.push({ day, entry });
			occurrences.set(key, list);
		}
	});
	const out: PlannedTime[] = [];
	for (const list of occurrences.values()) {
		list.sort((a, b) => a.day - b.day);
		for (let i = 0; i < list.length; i++) {
			const { day, entry } = list[i]!;
			// Remind computes one trigger per REM per run: on a given day the
			// earliest occurrence from that day on. So this occurrence owns the
			// days after the previous occurrence, up to its own.
			const owns = i === 0 ? 0 : list[i - 1]!.day + 1;
			const times = queueTimes(
				entry.time!,
				num(entry.raw.tdelta),
				num(entry.raw.trep),
				typeof entry.raw.sched === 'string' && entry.raw.sched !== ''
			);
			for (const t of times) {
				const back = Math.floor(t / MINUTES_PER_DAY);
				const d = day + back;
				const minute = t - back * MINUTES_PER_DAY;
				if (d < owns || d < 0) continue;
				if (d === 0 && minute < nowMinute) continue;
				out.push({ day: d, minute, entry });
			}
		}
	}
	out.sort(
		(a, b) =>
			a.day - b.day ||
			a.minute - b.minute ||
			a.entry.file.localeCompare(b.entry.file) ||
			a.entry.line - b.entry.line
	);
	return out;
}

/* ------------------------------------------------------------------ */
/* Generated scripts                                                   */
/* ------------------------------------------------------------------ */

/** The scratch vault's file. Never part of the user's vault. */
export const SCRATCH = 'fasti-notify.rem';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Seconds from the Unix epoch to 1990-01-01T00:00Z, Remind's earliest date. */
const EPOCH_1990 = 631_152_000;

/** A small stable hex digest (FNV-1a, two 32-bit lanes), for scratch vault cache keys. */
export function hashText(text: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193 ^ text.length;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193) >>> 0;
		b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
	}
	return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function scratch(text: string): VaultSnapshot {
	return { main: SCRATCH, files: { [SCRATCH]: text }, hash: `notify-${hashText(text)}` };
}

/** Prints Remind's today and the next `count` days: `FASTI-DAY|k|YYYY-MM-DD`. */
export function dayScript(count = DAYS_AHEAD): string {
	const lines = ['SET $DateSep "-"'];
	for (let k = 0; k <= count; k++) lines.push(`REM MSG FASTI-DAY|${k}|[today()+${k}]`);
	return lines.join('\n') + '\n';
}

/**
 * Prints, for each local date and minute, the minutes from 1990-01-01 00:00
 * UTC: `FASTI-UTC|n|<minutes>`, using `localtoutc()` in the run's zone.
 */
export function utcScript(moments: readonly { date: IsoDate; minute: Minutes }[]): string {
	const lines = moments.map(({ date, minute }, n) => {
		if (!DATE.test(date) || !Number.isInteger(minute)) throw new Error(`Invalid moment ${date}`);
		return `REM MSG FASTI-UTC|${n}|[localtoutc(datetime('${date}', 0, 0) + ${minute}) - '1990-01-01@00:00']`;
	});
	return lines.join('\n') + '\n';
}

/** `FASTI-<kind>|n|value` bodies of a scratch run, by n. */
function reports(result: AgendaResult, kind: string): Map<number, string> {
	const out = new Map<number, string>();
	const re = new RegExp(`^FASTI-${kind}\\|(\\d+)\\|(.*)$`);
	for (const e of result.entries) {
		const m = re.exec(e.body);
		if (m) out.set(Number(m[1]), m[2]!);
	}
	return out;
}

/** Remind's today and the next `count` days. */
export async function windowDays(
	engine: ScheduleEngine,
	today: IsoDate,
	tz: string | undefined,
	count = DAYS_AHEAD
): Promise<IsoDate[]> {
	const result = await engine.agenda(
		scratch(dayScript(count)),
		{ date: today, tz },
		{ priority: 0 }
	);
	const found = reports(result, 'DAY');
	const days: IsoDate[] = [];
	for (let k = 0; k <= count; k++) {
		const d = found.get(k);
		if (!d || !DATE.test(d)) throw new Error('Remind did not list the days ahead');
		days.push(d);
	}
	return days;
}

/** Epoch ms of each local date and minute, in the zone `tz`, from Remind. */
export async function epochs(
	engine: ScheduleEngine,
	moments: readonly { date: IsoDate; minute: Minutes }[],
	today: IsoDate,
	tz: string | undefined
): Promise<(number | null)[]> {
	if (!moments.length) return [];
	const result = await engine.agenda(
		scratch(utcScript(moments)),
		{ date: today, tz },
		{ priority: 0 }
	);
	const found = reports(result, 'UTC');
	return moments.map((_, n) => {
		const v = found.get(n);
		return v !== undefined && /^-?\d+$/.test(v) ? (EPOCH_1990 + Number(v) * 60) * 1000 : null;
	});
}

/* ------------------------------------------------------------------ */
/* The schedule                                                        */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (minute: Minutes) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Whether a reminder's source lines could give a different body at another time. */
function timeDependent(vault: VaultSnapshot, entry: ReminderEntry): boolean {
	const text = vault.files[entry.file];
	if (text === undefined) return true;
	const lines = text.split('\n').slice(entry.line - 1, entry.lineEnd);
	return lines.some((l) => l.includes('%') || l.includes('['));
}

export interface ScheduleOptions {
	tz?: string;
	/** Remind's now; asked from the engine when absent. */
	now?: EngineNow;
	max?: number;
	/** Leave out notifications after this epoch ms (the worker's 8-day horizon). */
	horizon?: number;
	/** Fetch bodies at each notification's time (default true). */
	bodiesAtTime?: boolean;
}

/** Plans today's and the next 8 days' notifications for `vault`. */
export async function buildSchedule(
	engine: ScheduleEngine,
	vault: VaultSnapshot,
	options: ScheduleOptions = {}
): Promise<Schedule> {
	const { tz } = options;
	const max = options.max ?? MAX_NOTIFICATIONS;
	const now = options.now ?? (await engine.now(tz, { priority: 0 }));
	const days = await windowDays(engine, now.date, tz);
	const agendas = await Promise.all(
		days.map((date) => engine.agenda(vault, { date, tz }, { priority: 0 }))
	);
	const planned = planTimes(days, agendas, now.time);

	// Clock times for the first `max` and for the start of tomorrow.
	const head = planned.slice(0, max);
	const moments = head.map((p) => ({ date: days[p.day]!, minute: p.minute }));
	moments.push({ date: days[1]!, minute: 0 });
	const clock = await epochs(engine, moments, now.date, tz);
	const nextDay = clock.pop() ?? null;

	// Bodies at the notification's own time where the text can vary.
	const bodies = new Map<string, Promise<AgendaResult>>();
	const bodyAt = async (p: PlannedTime): Promise<string> => {
		if (options.bodiesAtTime === false || !timeDependent(vault, p.entry)) return p.entry.body;
		const key = `${p.day}@${p.minute}`;
		let run = bodies.get(key);
		if (!run) {
			run = engine.agenda(vault, { date: days[p.day]!, time: hhmm(p.minute), tz }, { priority: 0 });
			bodies.set(key, run);
		}
		try {
			const found = (await run).entries.find(
				(e) => e.file === p.entry.file && e.line === p.entry.line && e.date === p.entry.date
			);
			return found?.body || p.entry.body;
		} catch {
			return p.entry.body;
		}
	};

	const notifications: ScheduledNotification[] = [];
	let firstDropped: number | null = planned.length > max ? max : null;
	for (let i = 0; i < head.length; i++) {
		const p = head[i]!;
		const at = clock[i];
		if (at === null || at === undefined) continue;
		if (options.horizon !== undefined && at > options.horizon) {
			firstDropped ??= i;
			break;
		}
		const date = days[p.day]!;
		notifications.push({
			id: `${date}T${hhmm(p.minute)}|${p.entry.file}:${p.entry.line}`,
			date,
			minute: p.minute,
			at,
			eventDate: p.entry.date,
			eventTime: p.entry.time!,
			body: await bodyAt(p),
			file: p.entry.file,
			line: p.entry.line
		});
	}
	let through = days[days.length - 1]!;
	if (firstDropped !== null) {
		const day = planned[firstDropped]!.day;
		through = days[Math.max(0, day - 1)]!;
	}
	return {
		days,
		now,
		notifications,
		through,
		truncated: firstDropped !== null,
		nextDay
	};
}
