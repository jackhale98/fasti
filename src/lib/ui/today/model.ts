// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Sorts the engine's agenda and calendar into the Today view's sections.
 * Only compares ISO date strings Remind printed; it never computes a date.
 */
import type { AgendaResult, CalendarDay, CalendarMonth, ReminderEntry } from '#lib/engine/types.ts';

export interface TodaySections {
	overdue: ReminderEntry[];
	today: ReminderEntry[];
	headsUp: ReminderEntry[];
}

/** Splits agenda entries around `today`: timed items first, in time order, then untimed. */
export function sections(agenda: AgendaResult, today: string): TodaySections {
	const overdue: ReminderEntry[] = [];
	const now: ReminderEntry[] = [];
	const headsUp: ReminderEntry[] = [];
	for (const e of agenda.entries) {
		if (e.date < today) {
			if (e.isTodo && !e.completed) overdue.push(e);
		} else if (e.date === today) {
			now.push(e);
		} else if (!e.completed) {
			headsUp.push(e);
		}
	}
	const rank = (e: ReminderEntry) => e.time ?? Number.POSITIVE_INFINITY;
	// Array.prototype.sort is stable, so Remind's order holds within a time.
	now.sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1));
	overdue.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return { overdue, today: now, headsUp };
}

/** The calendar day for `today`, and the 14 days Remind lists after it. */
export function upcoming(
	months: CalendarMonth[],
	today: string
): { todayDay: CalendarDay | null; days: CalendarDay[] } {
	const all = months.flatMap((m) => m.days);
	const i = all.findIndex((d) => d.date === today);
	if (i < 0) return { todayDay: null, days: [] };
	return { todayDay: all[i] ?? null, days: all.slice(i + 1, i + 15) };
}

/** A day's entries without completed TODOs. */
export function visibleEntries(day: CalendarDay): ReminderEntry[] {
	return day.entries.filter((e) => !(e.isTodo && e.completed));
}
