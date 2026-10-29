// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The notification schedule: today's and the next 30 days' queued `AT`
 * reminders, with the moments to notify, all from Remind (docs/PLAN.md 3.6).
 *
 * Where each piece comes from:
 *
 * - **The days.** Remind's today (`now()`), then a generated script on a tiny
 *   scratch vault prints `today()+1` … `today()+30` (see `dayScript`).
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
 * - **SCHED.** A reminder with `SCHED fn` (remind(1) PRECISE SCHEDULING) is
 *   issued at the times fn(1), fn(2), … give. Remind evaluates them after
 *   the whole script is read, so a generated script runs after the vault
 *   (`schedScript`, DOne after the main entry) and prints fn(1) … fn(30) for
 *   each name with its type. The times then follow
 *   `CalculateNextDtimeUsingSched()` in `queue.c` (see `schedTimes`): a TIME
 *   is that time of the trigger day; a positive INT n is the previous
 *   trigger plus n minutes (the AT time plus n for the first); zero or a
 *   negative n is the AT time minus |n|. The sequence ends at an error,
 *   another type, a value not after the previous one, or fn(31); then the
 *   normal AT processing takes over from the last time issued, so the AT
 *   time still fires if it hasn't passed. (Remind drops tdelta when a
 *   reminder has SCHED, in `dorem.c`, and leaves it out of the JSON, so
 *   that is the AT time alone.) A value past the end of the
 *   trigger day issues nothing and leaves the rest to the AT time too.
 *   Values before now are skipped (they still have to increase).
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
 * - **Renewal.** `renewalAt` is 12:00 on the day before `through`, by
 *   Remind's `localtoutc()` like the rest, so a device re-plans before its
 *   schedule runs out.
 *
 * `ONCE`: Remind honours ONCE only when the run's date is its real today
 * (`init.c` sets IgnoreOnce otherwise), and then compares today with the
 * script's access date (`GetOnceDate()` in `main.c`; no `$OnceFile` here).
 * The engine writes the vault to a fresh MEMFS for every run, so the access
 * date is always today: on day 0 a ONCE reminder counts as already issued,
 * so it is neither in the agenda nor queued (`ShouldQueueReminder()` checks
 * ONCE too) and gets no notification; on later days, run with a date other
 * than the real today, ONCE is ignored and it is queued as usual. That is
 * Remind's own answer for these runs, so nothing here special-cases ONCE.
 *
 * Limits: a SCHED function is evaluated once, in a run at Remind's today,
 * so one that depends on `today()`, `now()` or trigger state may give other
 * values in Remind's own queue; at most 30 values are read. A reminder
 * dated after the window whose tdelta reaches back into it is missed.
 */
import type { AgendaOptions, CallOptions } from '../engine/client.ts';
import { mainPath } from '../engine/probes.ts';
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
export const DAYS_AHEAD = 30;
/** The most notifications planned (Fasti's worker keeps at most 512 per subscription). */
export const MAX_NOTIFICATIONS = 512;
/** How many values of each SCHED function are read: fn(1) … fn(SCHED_VALUES). */
export const SCHED_VALUES = 30;
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
	/** Remind's today and the next DAYS_AHEAD (30) days. */
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
	/**
	 * True when the MAX_NOTIFICATIONS cap left notifications out. Notifications past
	 * `horizon` only move `through` earlier; they don't set this.
	 */
	truncated: boolean;
	/** Epoch ms of the start of tomorrow (Remind's next today), for re-planning. */
	nextDay: number | null;
	/**
	 * Epoch ms (from Remind's `localtoutc()`) of 12:00 on the day before
	 * `through`: when to send the "open Fasti to keep reminders coming" push.
	 * Null when `through` is today or the moment is after `horizon`. May be
	 * in the past.
	 */
	renewalAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Minute arithmetic (pure)                                            */
/* ------------------------------------------------------------------ */

/**
 * The minutes at which Remind's queue issues a timed reminder, relative to
 * the midnight of its trigger day (may be negative: the day before). As
 * remind(1): `AT 12:00 +75 *30` gives 10:45, 11:15, 11:45 and 12:00, and
 * `AT 12:00 +45` gives 11:15 and 12:00. A reminder with SCHED uses
 * `schedTimes` instead.
 */
export function queueTimes(time: Minutes, tdelta = 0, trep = 0): Minutes[] {
	if (!(tdelta > 0)) return [time];
	const rep = trep > 0 ? trep : tdelta;
	const out: Minutes[] = [];
	for (let t = time - tdelta; t < time; t += rep) out.push(t);
	out.push(time);
	return out;
}

/**
 * One value of a SCHED function as Remind returned it: a TIME (minutes past
 * midnight), an INT, or null for an error or any other type.
 */
export type SchedValue = { time: Minutes } | { int: number } | null;

/**
 * The minutes at which Remind's queue issues a timed reminder with a SCHED
 * function, relative to the midnight of its trigger day (may be negative),
 * given the function's values fn(1), fn(2), … (`values[0]` is fn(1)).
 *
 * Follows `CalculateNextDtime()` and `CalculateNextDtimeUsingSched()` in
 * Remind's `queue.c`, call by call, with every value accepted (dropping the
 * ones before now afterwards, as `planTimes` does, gives the same times as
 * Remind skipping them). A value past the end of `values` ends the
 * sequence like an error. Once the sequence ends, the `AT` time, tdelta and
 * trep take over from the last time issued (remind(1) PRECISE SCHEDULING,
 * notes 1 to 3). Remind sets tdelta to 0 for a reminder with SCHED, so in
 * practice that is the AT time alone; tdelta and trep are kept here to
 * mirror `queue.c`.
 */
export function schedTimes(
	time: Minutes,
	values: readonly SchedValue[],
	tdelta = 0,
	trep = 0
): Minutes[] {
	const out: Minutes[] = [];
	let next: Minutes | null = null; // q->tt.nextdtime: the last time issued
	let ntrig = 0;
	let active = true;
	// fn(ntrig): the next time, or null to fall back (ending the SCHED for good
	// unless the value only ran past the end of the day, as Remind does).
	const fromSched = (): Minutes | null => {
		const v = values[ntrig - 1];
		if (!v) {
			active = false;
			return null;
		}
		let t: Minutes;
		if ('time' in v) t = v.time;
		else if (v.int > 0) t = (next ?? time) + v.int;
		else t = time + v.int;
		// It may run past the AT time, but not past the end of the trigger day.
		if (t >= MINUTES_PER_DAY) return null;
		if (next === null || t > next) return t;
		// Not strictly increasing: Remind stops calling it.
		active = false;
		return null;
	};
	// The AT time with tdelta and trep, from the minute after the last issued.
	const fallback = (): Minutes | null => {
		const from = next === null ? time - tdelta : next + 1;
		if (!(tdelta > 0)) return time >= from ? time : null;
		const rep = trep > 0 ? trep : tdelta;
		let t = time - tdelta;
		if (t < from) t += Math.floor((from - t) / rep) * rep;
		if (t < from) t += rep;
		if (t > time) t = time;
		return t < from ? null : t;
	};
	// Each time is later than the last, within one day: this ends.
	for (;;) {
		ntrig++;
		const t = (active ? fromSched() : null) ?? fallback();
		if (t === null) break;
		out.push(t);
		next = t;
	}
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

/** The SCHED function an entry names, if any. */
export function schedName(entry: ReminderEntry): string | null {
	const s = entry.raw.sched;
	return typeof s === 'string' && s !== '' ? s : null;
}

/**
 * The notifications of a window of days, from each day's agenda (index =
 * position in `days`). `nowMinute` drops what's already past on day 0.
 * `scheds` holds each SCHED function's values (see `schedValues`); a name
 * missing from it is treated as a function that doesn't exist (Remind then
 * uses the AT time, tdelta and trep). Sorted by day, minute, file and line.
 */
export function planTimes(
	days: readonly IsoDate[],
	agendas: readonly AgendaResult[],
	nowMinute: Minutes,
	scheds: ReadonlyMap<string, readonly SchedValue[]> = new Map()
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
			const sched = schedName(entry);
			const tdelta = num(entry.raw.tdelta);
			const trep = num(entry.raw.trep);
			const times = sched
				? schedTimes(entry.time!, scheds.get(sched) ?? [], tdelta, trep)
				: queueTimes(entry.time!, tdelta, trep);
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

/** The SCHED probe's file, in a directory a whole-directory main entry doesn't read. */
export const SCHED_SCRATCH = '.fasti-notify/sched.rem';
/** Names Remind accepts for a user function (and nothing that could break the script). */
const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The probe's helper: a value as `T<minutes>` (TIME), `I<n>` (INT) or `X` (other). */
const SCHED_HELPER = '__fasti_sched_value';

/**
 * DOes the vault's main entry, then prints fn(1) … fn(count) of each SCHED
 * function as `FASTI-SCHED|<k*count + i-1>|<value>|`: `T<minutes>` for a
 * TIME, `I<n>` for an INT, `X` for another type and `E` for an error. It
 * runs after the whole script, where Remind's queue evaluates them too
 * (remind(1) PRECISE SCHEDULING, note 5).
 */
export function schedScript(main: string, names: readonly string[], count = SCHED_VALUES): string {
	const lines = [
		`DO ${mainPath(main)}`,
		`FSET ${SCHED_HELPER}(v) iif(typeof(v) == "TIME", "T" + coerce("INT", v), typeof(v) == "INT", "I" + v, "X")`
	];
	names.forEach((name, k) => {
		if (!FUNCTION_NAME.test(name)) throw new Error(`Invalid SCHED name ${name}`);
		for (let i = 1; i <= count; i++) {
			lines.push(
				`REM MSG FASTI-SCHED|${k * count + i - 1}|[catch(${SCHED_HELPER}(${name}(${i})), "E")]|`
			);
		}
	});
	return lines.join('\n') + '\n';
}

/** One printed SCHED value. */
function schedValue(text: string | undefined): SchedValue {
	const m = text === undefined ? null : /^([TI])(-?\d+)$/.exec(text);
	if (!m) return null;
	return m[1] === 'T' ? { time: Number(m[2]) } : { int: Number(m[2]) };
}

/**
 * The values of each SCHED function `names` lists, evaluated by Remind
 * after `vault`'s whole script, at Remind's today `today`. A name Remind
 * can't call gets values that end at once.
 */
export async function schedValues(
	engine: ScheduleEngine,
	vault: VaultSnapshot,
	names: readonly string[],
	today: IsoDate,
	tz: string | undefined,
	count = SCHED_VALUES
): Promise<Map<string, SchedValue[]>> {
	const out = new Map<string, SchedValue[]>();
	const valid = names.filter((n) => FUNCTION_NAME.test(n));
	for (const n of names) out.set(n, []);
	if (!valid.length) return out;
	const text = schedScript(vault.main, valid, count);
	const probe: VaultSnapshot = {
		main: SCHED_SCRATCH,
		files: { ...vault.files, [SCHED_SCRATCH]: text },
		hash: `notify-sched-${hashText(`${vault.hash}\n${text}`)}`
	};
	const result = await engine.agenda(probe, { date: today, tz }, { priority: 0 });
	const found = reports(result, 'SCHED', /FASTI-SCHED\|(\d+)\|([^|]*)\|/);
	valid.forEach((name, k) => {
		const values: SchedValue[] = [];
		for (let i = 0; i < count; i++) {
			const v = schedValue(found.get(k * count + i));
			values.push(v);
			// Remind stops at the first value it can't use.
			if (v === null) break;
		}
		out.set(name, values);
	});
	return out;
}

/**
 * `FASTI-<kind>|n|value` bodies of a scratch run, by n. `re` overrides the
 * pattern (the SCHED probe's isn't anchored: it runs after the vault, whose
 * msgprefix() or msgsuffix() may wrap the body).
 */
function reports(
	result: AgendaResult,
	kind: string,
	re = new RegExp(`^FASTI-${kind}\\|(\\d+)\\|(.*)$`)
): Map<number, string> {
	const out = new Map<number, string>();
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
	/** Leave out notifications after this epoch ms (the worker's horizon). */
	horizon?: number;
	/** Fetch bodies at each notification's time (default true). */
	bodiesAtTime?: boolean;
}

/** Plans today's and the next DAYS_AHEAD (30) days' notifications for `vault`. */
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
	// SCHED functions, evaluated by Remind after the whole script.
	const names = new Set<string>();
	for (const agenda of agendas) {
		for (const e of agenda.entries) {
			const name = queueable(e) ? schedName(e) : null;
			if (name) names.add(name);
		}
	}
	const scheds = names.size
		? await schedValues(engine, vault, [...names].sort(), now.date, tz)
		: new Map<string, SchedValue[]>();
	const planned = planTimes(days, agendas, now.time, scheds);

	// One run for the clock times: the first `max`, the start of tomorrow, and
	// 12:00 of every day but the last (renewalAt, once `through` is known).
	const head = planned.slice(0, max);
	const moments = head.map((p) => ({ date: days[p.day]!, minute: p.minute }));
	moments.push({ date: days[1]!, minute: 0 });
	for (const date of days.slice(0, -1)) moments.push({ date, minute: 12 * 60 });
	const clock = await epochs(engine, moments, now.date, tz);
	const noons = clock.splice(head.length + 1);
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

	const kept: { p: PlannedTime; at: number }[] = [];
	const capped = planned.length > max ? max : null;
	let horizonCut: number | null = null;
	for (let i = 0; i < head.length; i++) {
		const p = head[i]!;
		const at = clock[i];
		if (at === null || at === undefined) continue;
		if (options.horizon !== undefined && at > options.horizon) {
			horizonCut = i;
			break;
		}
		kept.push({ p, at });
	}
	// Up to MAX_NOTIFICATIONS body runs: ask for them all at once.
	const notifications: ScheduledNotification[] = await Promise.all(
		kept.map(async ({ p, at }) => {
			const date = days[p.day]!;
			return {
				id: `${date}T${hhmm(p.minute)}|${p.entry.file}:${p.entry.line}`,
				date,
				minute: p.minute,
				at,
				eventDate: p.entry.date,
				eventTime: p.entry.time!,
				body: await bodyAt(p),
				file: p.entry.file,
				line: p.entry.line
			};
		})
	);
	// The first notification left out, by the horizon or by the cap.
	const firstDropped = horizonCut ?? capped;
	let throughDay = days.length - 1;
	if (firstDropped !== null) throughDay = Math.max(0, planned[firstDropped]!.day - 1);
	// 12:00 the day before `through` (index arithmetic on Remind's days).
	let renewalAt = throughDay > 0 ? (noons[throughDay - 1] ?? null) : null;
	if (renewalAt !== null && options.horizon !== undefined && renewalAt > options.horizon) {
		renewalAt = null;
	}
	return {
		days,
		now,
		notifications,
		through: days[throughDay]!,
		truncated: horizonCut === null && capped !== null,
		nextDay,
		renewalAt
	};
}
