// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * iCalendar (RFC 5545) export, docs/PLAN.md section 3.6a. Download only.
 *
 * Every date and time comes from the engine's calendar output: this file
 * only formats what Remind printed (it never works out a date).
 *
 * Choices:
 * - One VEVENT per occurrence, no RRULE (OMIT, SKIP, BEFORE, AFTER and
 *   expressions don't map onto RRULE).
 * - Timed events (AT) are written as floating local time (`DTSTART:20261105T143000`,
 *   no TZID, no `Z`): the engine was run in the device zone, so the clock time is
 *   the person's local one, and a VTIMEZONE can't be built without zone data.
 *   `X-WR-TIMEZONE` names the zone for calendars that read it. The length is a
 *   `DURATION` (PT1H15M), not a DTEND, so no time or date arithmetic is needed.
 * - Untimed entries are all-day: `DTSTART;VALUE=DATE:YYYYMMDD` with no DTEND, which
 *   RFC 5545 defines as a one-day event.
 * - A completed TODO is a VEVENT with the categories "Task" and "Done" plus
 *   `X-FASTI-COMPLETED:TRUE` (STATUS:COMPLETED is only valid on a VTODO).
 * - `RUN` reminders never appear in `-r` calendars, so none are exported (and
 *   nothing is ever run). `SPECIAL` reminders (COLOR, WEEK, MOON, …) aren't events
 *   and are left out.
 * - UIDs: SHA-256 (hex, truncated to 32 characters) of file, the reminder's line
 *   text, the date and the time, then `@fasti`. Identical inputs within one export
 *   get a counter, so UIDs stay unique and stable.
 * - DTSTAMP is Remind's own `now()` in UTC (the caller asks the engine for it).
 */
import { calendar, now } from '../engine/client.ts';
import type { CalendarMonth, EngineNow, ReminderEntry, VaultSnapshot } from '../engine/types.ts';

export interface IcsOptions {
	/** Vault files by path, for the line text behind each UID. */
	files: Readonly<Record<string, string>>;
	/** Remind's `now()` in UTC; becomes DTSTAMP. */
	stamp: EngineNow;
	/** Device zone, written as X-WR-TIMEZONE. */
	tz?: string;
	/** Export only reminders from these files (default all). */
	onlyFiles?: ReadonlySet<string> | null;
	/** Include TODOs (default true). */
	todos?: boolean;
	/** Include completed TODOs (default false). */
	completed?: boolean;
}

const encoder = new TextEncoder();

/** Escapes a TEXT value: backslash, comma, semicolon and newlines. */
export function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds one content line at 75 octets, never inside a UTF-8 character. Returns CRLF-joined physical lines. */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let current = '';
	let bytes = 0;
	for (const ch of line) {
		const n = encoder.encode(ch).length;
		// A continuation line starts with a space, which counts toward its 75.
		if (bytes + n > 75) {
			parts.push(current);
			current = ' ';
			bytes = 1;
		}
		current += ch;
		bytes += n;
	}
	parts.push(current);
	return parts.join('\r\n');
}

const compact = (date: string) => date.replaceAll('-', '');
const hhmmss = (minutes: number) =>
	`${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;

/** `PT1H15M` style duration from minutes. */
export function durationValue(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `PT${h ? `${h}H` : ''}${m || !h ? `${m}M` : ''}`;
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function lineText(files: IcsOptions['files'], entry: ReminderEntry): string {
	const text = files[entry.file];
	if (text === undefined) return entry.rawBody ?? entry.body;
	return text
		.split('\n')
		.slice(entry.line - 1, entry.lineEnd)
		.join('\n');
}

/** Every occurrence the options keep, in calendar order. */
function occurrences(months: readonly CalendarMonth[], options: IcsOptions): ReminderEntry[] {
	const out: ReminderEntry[] = [];
	for (const month of months)
		for (const day of month.days)
			for (const entry of day.entries) {
				if (options.onlyFiles && !options.onlyFiles.has(entry.file)) continue;
				if (entry.special) continue;
				if (entry.isTodo && options.todos === false) continue;
				if (entry.isTodo && entry.completed && !options.completed) continue;
				// A +N warning repeats an occurrence on earlier days; the occurrence is on `date`.
				if (entry.date !== day.date) continue;
				out.push(entry);
			}
	return out;
}

/** Builds the .ics text (CRLF line endings, folded). */
export async function buildIcs(
	months: readonly CalendarMonth[],
	options: IcsOptions
): Promise<string> {
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Fasti//Fasti//EN',
		'CALSCALE:GREGORIAN'
	];
	if (options.tz) lines.push(`X-WR-TIMEZONE:${escapeText(options.tz)}`);
	const stamp = `${compact(options.stamp.date)}T${hhmmss(options.stamp.time)}Z`;
	const seen = new Map<string, number>();
	for (const entry of occurrences(months, options)) {
		const start =
			entry.eventStart ?? (entry.time !== null ? { date: entry.date, time: entry.time } : null);
		const date = start?.date ?? entry.date;
		const key = [
			entry.file,
			lineText(options.files, entry),
			date,
			start ? String(start.time) : ''
		].join('\u0000');
		const nth = seen.get(key) ?? 0;
		seen.set(key, nth + 1);
		const uid = (await sha256Hex(nth ? `${key}\u0000${nth}` : key)).slice(0, 32);
		lines.push('BEGIN:VEVENT', `UID:${uid}@fasti`, `DTSTAMP:${stamp}`);
		if (start) {
			lines.push(`DTSTART:${compact(start.date)}T${hhmmss(start.time)}`);
			if (entry.duration) lines.push(`DURATION:${durationValue(entry.duration)}`);
		} else {
			lines.push(`DTSTART;VALUE=DATE:${compact(date)}`);
		}
		lines.push(`SUMMARY:${escapeText(entry.body)}`);
		lines.push(`DESCRIPTION:${escapeText(`${entry.file}:${entry.line}`)}`);
		const location = entry.info.location;
		if (location) lines.push(`LOCATION:${escapeText(location)}`);
		const categories = [...entry.tags];
		if (entry.isTodo) categories.push('Task');
		if (entry.isTodo && entry.completed) categories.push('Done');
		if (categories.length) lines.push(`CATEGORIES:${categories.map(escapeText).join(',')}`);
		if (entry.isTodo && entry.completed) lines.push('X-FASTI-COMPLETED:TRUE');
		lines.push('END:VEVENT');
	}
	lines.push('END:VCALENDAR');
	return lines.map(foldLine).join('\r\n') + '\r\n';
}

export interface ExportRequest extends Omit<IcsOptions, 'stamp' | 'files'> {
	vault: VaultSnapshot;
	/** First month, `YYYY-MM` (Remind's current month). */
	month: string;
	months: number;
	/** Called as each month arrives, with the count so far. */
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
}

/** Runs the months through the engine and builds the file. */
export async function exportIcs(request: ExportRequest): Promise<string> {
	let done = 0;
	const [result, stamp] = await Promise.all([
		calendar(
			request.vault,
			{
				month: request.month,
				months: request.months,
				tz: request.tz,
				hideCompletedTodos: !request.completed
			},
			{ signal: request.signal, onMonth: () => request.onProgress?.(++done, request.months) }
		),
		now('UTC')
	]);
	return buildIcs(result.months, { ...request, files: request.vault.files, stamp });
}
