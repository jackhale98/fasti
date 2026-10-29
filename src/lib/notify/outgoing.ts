// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What Fasti sends and keeps for notifications, worked out from Remind's
 * schedule (schedule.ts): the payloads, the renewal nudge, what to record
 * when the upload left some out, and which planned notifications passed
 * unseen while Fasti was closed.
 *
 * Every date and moment here comes from Remind: the epoch ms in the schedule
 * and the dates it printed. This module only formats them and compares epoch
 * ms; it never works out a date.
 */
import { dayMonth, longDate, time as formatTime, weekdayShort } from '#lib/app/format.ts';
import type { IsoDate } from '#lib/engine/types.ts';
import type { Clock, PlannedPush } from '#lib/store/db.ts';
import type { NotificationPayload } from './payload.ts';
import type { Schedule, ScheduledNotification } from './schedule.ts';

/** The renewal nudge's id (also its tag: a newer one replaces an older one). */
export const RENEWAL_ID = 'fasti-renewal';
/** Test notifications' ids start with this. */
export const TEST_PREFIX = 'test-';
/** The renewal nudge's title. */
export const RENEWAL_TITLE = 'Open Fasti to keep reminders coming';

/** "Today at 9:30am", "Thu 5 Nov at 9:30am": when the reminder itself is. */
export function whenText(n: ScheduledNotification, clock: Clock): string {
	const at = formatTime(n.eventTime, clock);
	// A string comparison of two dates Remind printed.
	return n.eventDate === n.date
		? `Today at ${at}`
		: `${weekdayShort(n.eventDate)} ${dayMonth(n.eventDate)} at ${at}`;
}

/**
 * The payload of one notification. `at` and `due` (its own moment, in the
 * 12/24-hour setting) let the service worker label it when it arrives late.
 */
export function toPayload(n: ScheduledNotification, clock: Clock): NotificationPayload {
	return {
		id: n.id,
		title: n.body,
		body: `${whenText(n, clock)} · ${n.file}`,
		url: '',
		at: n.at,
		due: formatTime(n.minute, clock)
	};
}

/** The body of the renewal nudge, naming the last covered day (Remind's date). */
export const renewalBody = (through: IsoDate) =>
	`Notifications are scheduled through ${longDate(through)}. Open Fasti to schedule the days after.`;

/**
 * The renewal nudge, at Remind's `renewalAt` (noon the day before `through`),
 * or null. Every upload replaces the worker's list, so it fires only when
 * Fasti hasn't been opened since.
 */
export function renewalPush(schedule: Schedule): PlannedPush | null {
	if (schedule.renewalAt === null || schedule.renewalAt === undefined) return null;
	return {
		at: schedule.renewalAt,
		payload: { id: RENEWAL_ID, title: RENEWAL_TITLE, body: renewalBody(schedule.through), url: '' }
	};
}

/** Everything to upload for a schedule: its notifications, plus the renewal nudge. */
export function planFor(schedule: Schedule, clock: Clock): PlannedPush[] {
	const list: PlannedPush[] = schedule.notifications.map((n) => ({
		at: n.at,
		date: n.date,
		payload: toPayload(n, clock)
	}));
	const renewal = renewalPush(schedule);
	if (renewal) list.push(renewal);
	return list.sort((a, b) => a.at - b.at);
}

/**
 * The summary to record after an upload that left out the messages due at
 * `droppedAt`: `through` moves to the day (in Remind's list of days) before
 * the first real notification left out, and `truncated` is set.
 */
export function afterDrops(
	schedule: Schedule,
	plan: readonly PlannedPush[],
	droppedAt: readonly number[]
): { through: IsoDate; truncated: boolean; count: number } {
	const dropped = new Set(droppedAt);
	const real = plan.filter((p) => p.date !== undefined);
	const lost = real.filter((p) => dropped.has(p.at));
	if (!lost.length) {
		return {
			through: schedule.through,
			truncated: schedule.truncated,
			count: schedule.notifications.length
		};
	}
	const first = lost.reduce((a, b) => (b.at < a.at ? b : a));
	const index = schedule.days.indexOf(first.date!);
	const cut = schedule.days[Math.max(0, index - 1)] ?? schedule.through;
	// A string comparison of two dates Remind printed.
	const through = cut < schedule.through ? cut : schedule.through;
	return { through, truncated: true, count: real.length - lost.length };
}

/** Whether a planned entry is a real reminder (not the renewal nudge or a test). */
export const isReminder = (p: PlannedPush) =>
	p.payload.id !== RENEWAL_ID && !p.payload.id.startsWith(TEST_PREFIX);

/**
 * The planned notifications due after `from` and up to `to` (epoch ms) that
 * this device never showed: missed while Fasti was closed (the device off,
 * a push dropped after its TTL, a revoked subscription).
 */
export async function findMissed(
	planned: readonly PlannedPush[],
	from: number,
	to: number,
	wasShown: (id: string) => Promise<boolean>
): Promise<PlannedPush[]> {
	const due = planned.filter((p) => isReminder(p) && p.at > from && p.at <= to);
	const shown = await Promise.all(due.map((p) => wasShown(p.payload.id).catch(() => false)));
	return due.filter((_, i) => !shown[i]).sort((a, b) => a.at - b.at);
}
