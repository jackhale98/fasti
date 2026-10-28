// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The month grid's layout. Every day, weekday and omit comes from Remind's
 * calendar result; this only places those days into 6 rows of 7. Nothing here
 * works out a date.
 */
import type { CalendarDay, CalendarMonth, ReminderEntry } from '#lib/engine/types.ts';

export type EntryKind = 'holiday' | 'todo' | 'done' | 'event';

export interface Cell {
	date: string;
	day: CalendarDay;
	/** False for the leading and trailing days of neighbouring months. */
	inMonth: boolean;
}

/** A slot in the grid: a day, or null while its month's calendar is still on the way. */
export type Slot = Cell | null;

export const GRID_SIZE = 42;

/**
 * 42 slots: the visible month's days, the end of the previous month before
 * them and the start of the next month after them. Slots whose neighbouring
 * month hasn't arrived yet are null.
 */
export function buildGrid(
	visible: CalendarMonth,
	prev: CalendarMonth | undefined,
	next: CalendarMonth | undefined,
	mondayFirst: boolean
): Slot[] {
	const lead = (visible.firstWeekday - (mondayFirst ? 1 : 0) + 7) % 7;
	const slots: Slot[] = [];
	for (let i = 0; i < lead; i++) {
		const day = prev?.days[prev.days.length - lead + i];
		slots.push(day ? { date: day.date, day, inMonth: false } : null);
	}
	for (const day of visible.days) slots.push({ date: day.date, day, inMonth: true });
	for (let i = 0; slots.length < GRID_SIZE; i++) {
		const day = next?.days[i];
		slots.push(day ? { date: day.date, day, inMonth: false } : null);
	}
	return slots.slice(0, GRID_SIZE);
}

/** Weekday names in column order (Remind gives them Sunday first). */
export function columnNames(month: CalendarMonth, mondayFirst: boolean): string[] {
	const names = month.dayNames;
	return mondayFirst ? [...names.slice(1), ...names.slice(0, 1)] : names;
}

/** Whether the line an entry came from is an OMIT or ADDOMIT, i.e. a holiday. */
export function holidayChecker(files: Readonly<Record<string, string>>) {
	const lines = new Map<string, string[]>();
	return (entry: ReminderEntry): boolean => {
		let text = lines.get(entry.file);
		if (!text) {
			text = (files[entry.file] ?? '').split('\n');
			lines.set(entry.file, text);
		}
		const line = text[entry.line - 1] ?? '';
		return /^\s*OMIT\b/i.test(line) || /\bADDOMIT\b/i.test(line);
	};
}

export function kindOf(entry: ReminderEntry, isHoliday: (e: ReminderEntry) => boolean): EntryKind {
	if (isHoliday(entry)) return 'holiday';
	if (entry.isTodo) return entry.completed ? 'done' : 'todo';
	return 'event';
}
