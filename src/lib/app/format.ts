// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Display formatting for dates and times the engine returned. Formatting
 * only: these functions never work out when a reminder fires. The weekday of
 * a date Remind printed is read with Intl, in UTC so the date can't shift.
 */
import type { IsoDate, Minutes } from '#lib/engine/types.ts';
import type { Clock } from '#lib/store/db.ts';

function utc(date: IsoDate): Date {
	return new Date(`${date}T00:00:00Z`);
}

const fmt = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });

const WEEKDAY = fmt({ weekday: 'long' });
const WEEKDAY_SHORT = fmt({ weekday: 'short' });
const DAY_MONTH = fmt({ day: 'numeric', month: 'short' });
const LONG = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const MONTH_NAME = fmt({ month: 'long' });

/** "Thursday" */
export const weekday = (date: IsoDate) => WEEKDAY.format(utc(date));
/** "Thu" */
export const weekdayShort = (date: IsoDate) => WEEKDAY_SHORT.format(utc(date));
/** "5 Nov" */
export const dayMonth = (date: IsoDate) => DAY_MONTH.format(utc(date));
/** "Thu 5 Nov 2026" */
export const longDate = (date: IsoDate) => LONG.format(utc(date)).replace(/,/g, '');
/** "November" for '2026-11' or '2026-11-05'. */
export const monthName = (date: string) => MONTH_NAME.format(utc(`${date.slice(0, 7)}-01`));
/** Day of the month of an ISO date. */
export const dayOf = (date: IsoDate) => Number(date.slice(8, 10));

/** "9:30am" / "09:30", or "9am" short form. */
export function time(minutes: Minutes, clock: Clock, short = false): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (clock === '24h') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	const h12 = h % 12 || 12;
	const ap = h < 12 ? 'am' : 'pm';
	return short && m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

/** "1h 30m", "45m" */
export function duration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** The device's IANA time zone, which Remind is run in. */
export function deviceZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
