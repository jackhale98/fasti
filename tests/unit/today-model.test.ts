// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { AgendaResult, ReminderEntry } from '#lib/engine/types.ts';
import { sections } from '#lib/ui/today/model.ts';

const entry = (date: string, body: string, time: number | null = null): ReminderEntry => ({
	date,
	file: 'r.rem',
	line: 1,
	lineEnd: 1,
	body,
	rawBody: null,
	time,
	duration: null,
	eventStart: null,
	priority: 5000,
	isTodo: false,
	completeThrough: null,
	completed: false,
	tags: [],
	info: {},
	special: null,
	color: null,
	delta: null,
	tz: null,
	raw: {}
});

describe('Today sections', () => {
	it('orders Heads-up by date, then time, whatever order Remind printed', () => {
		const agenda: AgendaResult = {
			banner: null,
			diagnostics: [],
			entries: [
				entry('2026-11-02', 'Birthday'),
				entry('2026-10-30', 'Timesheet'),
				entry('2026-11-02', 'Rent at 9', 540),
				entry('2026-10-28', 'Stand-up', 570)
			]
		};
		const s = sections(agenda, '2026-10-28');
		expect(s.today.map((e) => e.body)).toEqual(['Stand-up']);
		expect(s.headsUp.map((e) => e.body)).toEqual(['Timesheet', 'Rent at 9', 'Birthday']);
	});
});
