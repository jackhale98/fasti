// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Quick add: plain words -> a structured model -> one REM line. The REM line
 * is always shown to the user, so nothing is hidden.
 *
 * DATE RULE, AND ITS ONE EXCEPTION. The lens never computes the dates a
 * reminder fires on; every date Fasti shows comes from the engine. The single
 * exception is here: turning the words the user typed ("tomorrow", "next Thu",
 * "in 3 days", "14 Dec") into a date literal to write into the new REM line is
 * input parsing, so this module does that small calendar step (`calendar`
 * below) from a `today` passed in as {y, m, d}. It also writes yesterday's
 * date as COMPLETE-THROUGH for a new recurring TODO. Nothing else in the lens
 * may use these helpers, and nothing computed here is displayed as a date.
 *
 * Two safety rules are kept from the prototype:
 * 1. A new recurring TODO gets COMPLETE-THROUGH <yesterday>, so it does not
 *    count as overdue since 1990.
 * 2. "Last working day" adds OMIT Sat Sun to the REM line itself.
 */

import type { Match } from './types';

export interface Ymd {
	y: number;
	m: number;
	d: number;
}

export type QuickKind =
	| 'once'
	| 'daily'
	| 'weekly'
	| 'interval'
	| 'monthly-day'
	| 'monthly-nth'
	| 'monthly-last'
	| 'monthly-lastwork'
	| 'yearly';

export interface QuickModel {
	msg: string;
	kind: QuickKind;
	/** The first (or only) date, as a literal. */
	date: Ymd;
	/** Weekdays, 0 = Sunday. */
	wds: number[];
	day: number;
	nth: number | 'last';
	nthWd: number;
	month: number;
	interval: number;
	/** Minutes after midnight. */
	time: number | null;
	/** Minutes. */
	duration: number | null;
	warn: number;
	warnAll: boolean;
	omitMode: '' | 'SKIP';
	until: Ymd | null;
	todo: boolean;
	countdown: boolean;
	/** True when something besides the message was understood. */
	recognised?: boolean;
}

/* The calendar step. Day numbers are days since 1970-01-01 (UTC). */
const calendar = {
	num: (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d) / 86400000,
	ymd(n: number): Ymd {
		const t = new Date(n * 86400000);
		return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
	},
	wday: (n: number): number => (((n + 4) % 7) + 7) % 7 // 1970-01-01 was a Thursday
};

const WDN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];
const WDRE =
	'(sun(?:day)?|mon(?:day)?|tue(?:sday|s)?|wed(?:nesday)?|thu(?:rsday|rs|r)?|fri(?:day)?|sat(?:urday)?)';
const MORE =
	'(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const wdOf = (s: string): number => WDN.indexOf(s.slice(0, 3).toLowerCase());
const moOf = (s: string): number =>
	MO_SHORT.map((x) => x.toLowerCase()).indexOf(s.slice(0, 3).toLowerCase()) + 1;
const ORDW: Record<string, number | 'last'> = {
	first: 1,
	'1st': 1,
	second: 2,
	'2nd': 2,
	third: 3,
	'3rd': 3,
	fourth: 4,
	'4th': 4,
	last: 'last'
};

/** True for a real calendar date; used only to refuse impossible input. */
function validYmd(y: number, m: number, d: number): boolean {
	return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const p2 = (v: number): string => String(v).padStart(2, '0');
const iso = (d: Ymd): string => `${d.y}-${p2(d.m)}-${p2(d.d)}`;

/** An empty model dated `today`. */
export function blank(today: Ymd): QuickModel {
	return {
		msg: '',
		kind: 'once',
		date: { ...today },
		wds: [],
		day: 1,
		nth: 1,
		nthWd: 1,
		month: 1,
		interval: 7,
		time: null,
		duration: null,
		warn: 0,
		warnAll: false,
		omitMode: '',
		until: null,
		todo: false,
		countdown: true
	};
}

/** Understand a phrase like "dentist next Thu at 3pm, remind me 2 days before". */
export function parse(input: string, today: Ymd): QuickModel {
	const m = blank(today);
	let s = ' ' + input.trim() + ' ';
	// A callback returning false rejects the match (nothing is consumed).
	const take = (re: RegExp, fn: (r: Match) => void | false): boolean => {
		const r = re.exec(s) as Match | null;
		if (!r) return false;
		if (fn(r) === false) return false;
		s = s.slice(0, r.index) + ' ' + s.slice(r.index + r[0].length);
		return true;
	};
	const T = calendar.num(today.y, today.m, today.d);
	const nextWd = (w: number, strictlyAfter: boolean): Ymd => {
		let n = T + (strictlyAfter ? 1 : 0);
		while (calendar.wday(n) !== w) n++;
		return calendar.ymd(n);
	};
	const offset = (days: number): Ymd => calendar.ymd(T + days);
	// Impossible dates (31 Feb, 2026-13-45) are never recognised, so nothing is rolled over.
	const dateFrom = (d: string | number, mo: number, y?: string): Ymd | null => {
		if (y) return validYmd(+y, mo, +d) ? { y: +y, m: mo, d: +d } : null;
		for (let yy = today.y; yy <= today.y + 8; yy++)
			if (validYmd(yy, mo, +d) && calendar.num(yy, mo, +d) >= T) return { y: yy, m: mo, d: +d };
		return null;
	};
	const fromIso = (txt: string): Ymd | null => {
		const [y, mo, d] = txt.split('-').map(Number) as [number, number, number];
		return validYmd(y, mo, d) ? { y, m: mo, d } : null;
	};
	let found = false;

	take(/^\s*(todo|task)\b[:\s]*/i, () => {
		m.todo = true;
	});
	take(/\b(?:warn|remind)(?: me)? (\d+) (day|week)s? (?:before|ahead|early|in advance)\b/i, (r) => {
		m.warn = +r[1] * (r[2][0]!.toLowerCase() === 'w' ? 7 : 1);
	});
	take(/\s(\+\+?)(\d+)\s/, (r) => {
		m.warn = +r[2];
		m.warnAll = r[1] === '++';
	});
	take(/\bfor (\d+(?:\.\d+)?) ?(h|hrs?|hours?|m|mins?|minutes?)\b/i, (r) => {
		const v = parseFloat(r[1]);
		m.duration = Math.round(r[2][0]!.toLowerCase() === 'h' ? v * 60 : v);
	});
	take(/\b(?:skip|not on) (?:holidays|weekends|days off)\b/i, () => {
		m.omitMode = 'SKIP';
	});
	take(/\b(?:until|till|through) (\d{4}-\d{2}-\d{2})\b/i, (r) => {
		const u = fromIso(r[1]);
		if (!u) return false;
		m.until = u;
	});
	take(new RegExp(`\\b(?:until|till|through) (\\d{1,2})(?:st|nd|rd|th)? ${MORE}\\b`, 'i'), (r) => {
		const u = dateFrom(r[1], moOf(r[2]));
		if (!u) return false;
		m.until = u;
	});
	take(new RegExp(`\\b(?:until|till|through) ${MORE} (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (r) => {
		const u = dateFrom(r[2], moOf(r[1]));
		if (!u) return false;
		m.until = u;
	});
	// time
	take(/\b(?:at |@)?(noon|midday)\b/i, () => {
		m.time = 720;
	});
	if (m.time == null)
		take(/\b(?:at |@)?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)(?=\W)/i, (r) => {
			let h = +r[1] % 12;
			if (r[3][0]!.toLowerCase() === 'p') h += 12;
			if (+r[1] < 1 || +r[1] > 12 || +r[2] > 59) return false;
			m.time = h * 60 + (+r[2] || 0);
		});
	if (m.time == null)
		take(/\b(?:at |@)(\d{1,2})[:.](\d{2})\b/i, (r) => {
			if (+r[1] > 23 || +r[2] > 59) return false;
			m.time = +r[1] * 60 + +r[2];
		});
	if (m.time == null)
		take(/\s(\d{1,2}):(\d{2})\s/, (r) => {
			if (+r[1] > 23 || +r[2] > 59) return false;
			m.time = +r[1] * 60 + +r[2];
		});
	// recurrence
	const rec: [RegExp, (r: Match) => void | false][] = [
		[
			/\bevery (?:other|second) (week)?\s?(?:on )?WD\b/i,
			(r) => {
				m.kind = 'interval';
				m.interval = 14;
				m.date = nextWd(wdOf(r[2]), false);
			}
		],
		[
			/\bevery (\d+) (day|week)s?(?: (?:starting|from) (\d{4}-\d{2}-\d{2}))?\b/i,
			(r) => {
				const start = r[3] ? fromIso(r[3]) : null;
				if (r[3] && !start) return false;
				m.kind = 'interval';
				m.interval = +r[1] * (r[2][0]!.toLowerCase() === 'w' ? 7 : 1);
				if (start) m.date = start;
			}
		],
		[
			/\bevery fortnight\b/i,
			() => {
				m.kind = 'interval';
				m.interval = 14;
			}
		],
		[
			/\b(?:every|on) (?:week ?day|working day|work ?day)s?\b|\bweekdays\b/i,
			() => {
				m.kind = 'weekly';
				m.wds = [1, 2, 3, 4, 5];
			}
		],
		[
			/\b(?:every|on) weekends?\b|\bweekends\b/i,
			() => {
				m.kind = 'weekly';
				m.wds = [0, 6];
			}
		],
		[
			/\bevery (?:day|morning|evening|night)\b|\bdaily\b/i,
			() => {
				m.kind = 'daily';
			}
		],
		[
			/\blast (?:working|work) ?day of (?:every|each|the) month\b/i,
			() => {
				m.kind = 'monthly-lastwork';
			}
		],
		[
			/\blast day of (?:every|each|the) month\b/i,
			() => {
				m.kind = 'monthly-last';
			}
		],
		[
			/\b(first|second|third|fourth|last|1st|2nd|3rd|4th) WD of (?:every|each|the) month\b|\b(?:every|each) (first|second|third|fourth|last|1st|2nd|3rd|4th) WD\b/i,
			(r) => {
				m.kind = 'monthly-nth';
				m.nth = ORDW[(r[1] || r[3]).toLowerCase()]!;
				m.nthWd = wdOf(r[2] || r[4]);
			}
		],
		[
			/\b(?:on the )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?(?:every|each) month\b|\b(?:every month|monthly) on the (\d{1,2})(?:st|nd|rd|th)?\b/i,
			(r) => {
				const day = +(r[1] || r[2]);
				if (day < 1 || day > 31) return false;
				m.kind = 'monthly-day';
				m.day = day;
			}
		],
		[
			/\b(?:every|each|yearly|annually) (?:year )?(?:on )?(\d{1,2})(?:st|nd|rd|th)? MO\b/i,
			(r) => {
				if (!validYmd(2024, moOf(r[2]), +r[1])) return false;
				m.kind = 'yearly';
				m.day = +r[1];
				m.month = moOf(r[2]);
			}
		],
		[
			/\b(?:every|each|yearly|annually) (?:year )?(?:on )?MO (\d{1,2})(?:st|nd|rd|th)?\b/i,
			(r) => {
				if (!validYmd(2024, moOf(r[1]), +r[2])) return false;
				m.kind = 'yearly';
				m.day = +r[2];
				m.month = moOf(r[1]);
			}
		],
		[
			/\b(?:every|on|each) ((?:WD(?:s)?(?:\s*(?:,|and|&)\s*)?)+)/i,
			(r) => {
				m.kind = 'weekly';
				m.wds = [...new Set((r[1].match(new RegExp(WDRE, 'gi')) || []).map(wdOf))];
			}
		],
		[
			/\b(WD)s\b/i,
			(r) => {
				m.kind = 'weekly';
				m.wds = [wdOf(r[1])];
			}
		]
	];
	for (const [re, fn] of rec) {
		const re2 = new RegExp(re.source.replace(/WD/g, WDRE).replace(/MO/g, MORE), 'i');
		if (take(re2, fn)) {
			found = true;
			break;
		}
	}
	// single dates (also used as the start of an interval)
	if (!found || m.kind === 'interval') {
		const singles: [RegExp, (r: Match) => Ymd | null][] = [
			[/\bday after tomorrow\b/i, () => offset(2)],
			[/\btoday\b|\btonight\b|\bthis (?:morning|afternoon|evening)\b/i, () => offset(0)],
			[/\btomorrow\b|\btmrw\b/i, () => offset(1)],
			[
				/\bin (\d+) (day|week)s?\b/i,
				(r) => offset(+r[1] * (r[2][0]!.toLowerCase() === 'w' ? 7 : 1))
			],
			[/\bnext week\b/i, () => nextWd(1, true)],
			[
				/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
				(r) => (validYmd(+r[1], +r[2], +r[3]) ? { y: +r[1], m: +r[2], d: +r[3] } : null)
			],
			[
				/\b(?:on )?(?:the )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?MO(?: (\d{4}))?\b/i,
				(r) => dateFrom(r[1], moOf(r[2]), r[3])
			],
			[
				/\b(?:on )?MO (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/i,
				(r) => dateFrom(r[2], moOf(r[1]), r[3])
			],
			[/\bnext WD\b/i, (r) => nextWd(wdOf(r[1]), true)],
			[/\b(?:this |on )?WD\b/i, (r) => nextWd(wdOf(r[1]), true)]
		];
		for (const [re, fn] of singles) {
			const re2 = new RegExp(re.source.replace(/WD/g, WDRE).replace(/MO/g, MORE), 'i');
			let n: Ymd | null = null;
			if (
				take(re2, (r) => {
					n = fn(r);
					if (!n) return false;
				})
			) {
				m.date = n!;
				if (!found) {
					m.kind = 'once';
					found = true;
				}
				break;
			}
		}
	}
	// a birthday or anniversary on a date with no year repeats yearly
	if (m.kind === 'once' && /\b(birthday|anniversary|bday)\b/i.test(s) && !/\b\d{4}\b/.test(input)) {
		m.kind = 'yearly';
		m.day = m.date.d;
		m.month = m.date.m;
		if (!m.warn) m.warn = 7;
	}
	let msg = s
		.replace(/\s+/g, ' ')
		.replace(/^\s*(on|at|every|from|,|-)\s+/i, '')
		.replace(/\s+(on|at|every|from|by|due|,|-|and)\s*$/i, '')
		.trim();
	msg = msg.replace(/^[,;:\-–\s]+|[,;:\-–\s]+$/g, '');
	m.msg = msg ? msg[0]!.toUpperCase() + msg.slice(1) : '';
	m.recognised = found || m.time != null;
	return m;
}

const ORDS = ['', 'First', 'Second', 'Third', 'Fourth'];
const hm = (min: number): string => `${Math.floor(min / 60)}:${p2(min % 60)}`;

/** The REM line for a model. `today` gives the COMPLETE-THROUGH date of a recurring TODO. */
export function toRem(m: QuickModel, today: Ymd): string {
	const p: string[] = ['REM'];
	if (m.todo) p.push('TODO');
	switch (m.kind) {
		case 'once':
			p.push(iso(m.date));
			break;
		case 'daily':
			break;
		case 'weekly':
			p.push(
				[1, 2, 3, 4, 5, 6, 0]
					.filter((w) => m.wds.includes(w))
					.map((w) => WD_SHORT[w])
					.join(' ') || 'Mon'
			);
			break;
		case 'monthly-day':
			p.push(String(m.day));
			break;
		case 'monthly-nth':
			p.push(m.nth === 'last' ? 'Last' : ORDS[m.nth]!, WD_FULL[m.nthWd]!);
			break;
		case 'monthly-last':
			p.push('Lastday');
			break;
		case 'monthly-lastwork':
			p.push('Lastworkday', 'OMIT', 'Sat', 'Sun');
			break;
		case 'yearly':
			p.push(String(m.day), MO_SHORT[m.month - 1]!);
			break;
		case 'interval':
			p.push(iso(m.date), '*' + m.interval);
			break;
	}
	if (m.warn > 0) p.push((m.warnAll ? '++' : '+') + m.warn);
	if (m.todo && m.kind !== 'once') {
		const yesterday = calendar.ymd(calendar.num(today.y, today.m, today.d) - 1);
		p.push('COMPLETE-THROUGH', iso(yesterday));
	}
	if (m.omitMode) p.push(m.omitMode);
	if (m.time != null) p.push('AT', hm(m.time));
	if (m.duration) p.push('DURATION', hm(m.duration));
	if (m.until != null && m.kind !== 'once') p.push('UNTIL', iso(m.until));
	let body = m.msg || 'Reminder';
	if (m.countdown && (m.warn > 0 || m.todo)) body += ' %b';
	p.push('MSG', body);
	return p.join(' ');
}

/** The prototype's `Q` object. */
export const Q = { parse, toRem, blank };
