// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Plain-language sentences for lines. Wording follows the prototype's
 * explain, explainOmit and lineInspector. Date literals written in the line are
 * restated as written ("28 October 2026"), never with a weekday and never
 * derived: when a reminder fires comes from the engine.
 */
import type { DateClause, DateLit, LogicalLine, OmitSpec, PartialDate, RemSpec } from './types';
import { MONTHS, WEEKDAYS } from './tokenize';

const WDS = WEEKDAYS.map((x) => x.slice(0, 3));
const MOS = MONTHS.map((x) => x.slice(0, 3));
const ORD = ['', 'first', 'second', 'third', 'fourth'];
const BY_REMIND = 'evaluated by Remind';

const ordSuffix = (d: number): string =>
	d % 100 >= 11 && d % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][d % 10] ?? 'th');
const nth = (d: number): string => d + ordSuffix(d);
const p2 = (v: number): string => String(v).padStart(2, '0');

/** `9:30am`-style text for a time of day in minutes after midnight. */
export function fmtTime(min: number): string {
	let h = Math.floor(min / 60);
	const m = min % 60;
	const ap = h >= 12 ? 'pm' : 'am';
	h = h % 12 || 12;
	return `${h}:${p2(m)}${ap}`;
}

/** A date literal as written: `28 October 2026`. No weekday. */
export function fmtLiteral(d: DateLit): string {
	return d.d == null ? `the end of ${MONTHS[d.m - 1]} ${d.y}` : `${d.d} ${MONTHS[d.m - 1]} ${d.y}`;
}
const fmtClause = (c: DateClause): string =>
	c === 'expr' ? `a date ${BY_REMIND}` : c ? fmtLiteral(c) : '';

/** `Mon–Fri`, `Sat & Sun`, or names; `long` gives the sentence forms. */
export function listWeekdays(list: number[], long: boolean): string {
	const set = new Set(list);
	const a = [1, 2, 3, 4, 5, 6, 0].filter((x) => set.has(x));
	if (a.length === 5 && [1, 2, 3, 4, 5].every((x) => set.has(x)))
		return long ? 'weekday' : 'Mon–Fri';
	if (a.length === 2 && set.has(0) && set.has(6)) return long ? 'weekend day' : 'Sat & Sun';
	if (a.length === 7) return 'day';
	const names = a.map((x) => (long ? WEEKDAYS[x] : WDS[x]));
	return names.length > 1
		? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
		: (names[0] ?? '');
}

function durText(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

function explainWhen(rem: RemSpec): string {
	const sp = rem.spec;
	const s = rem.sugar;
	const { d, m, y, wd } = sp;
	const month = (n: number) => MONTHS[n - 1];
	const lit = (): DateLit => ({ y: y!, m: m!, d: d! });
	const each =
		m != null ? month(m) + (y ? ' ' + y : ' each year') : 'every month' + (y ? ' in ' + y : '');
	if (rem.fromOmit) {
		if (rem.rep && rem.until && rem.until !== 'expr')
			return `Every day from ${fmtLiteral(lit())} through ${fmtLiteral(rem.until)}`;
		return y != null ? `On ${fmtLiteral(lit())}` : `Every year on ${d} ${month(m!)}`;
	}
	if (rem.through != null || rem.rep) {
		const start = fmtLiteral(lit());
		const end = rem.through ?? (rem.rep === 1 ? rem.until : null);
		if (end === 'expr') return `Every day from ${start} through a date ${BY_REMIND}`;
		if (end) return `Every day from ${start} through ${fmtLiteral(end)}`;
		const r = rem.rep;
		const every =
			r === 1
				? 'Every day'
				: r % 7 === 0
					? `Every ${r / 7 === 1 ? '' : r / 7 + ' '}week${r / 7 === 1 ? '' : 's'}`
					: `Every ${r} days`;
		return `${every}, counting from ${start}`;
	}
	if (s && 'ord' in s) {
		const wds = listWeekdays(wd!, true);
		return `The ${s.ord === 'last' ? 'last' : ORD[s.ord]} ${wds} of ${each}`;
	}
	if (s) {
		const where = m != null ? month(m) + (y ? ' ' + y : ' each year') : 'every month';
		const n = 'tilde' in s ? s.tilde.n : 1;
		const work = 'tilde' in s ? !s.tilde.double : s.lastday === 'work';
		const which = n === 1 ? 'last' : `${nth(n)}-to-last`;
		return `The ${which} ${work ? 'working day' : 'day'} of ${where}`;
	}
	let base: string;
	if (d == null && m == null && y == null && !wd) base = 'Every day';
	else if (wd && d == null)
		base = `Every ${listWeekdays(wd, true)}${m != null ? ' in ' + month(m) : ''}${y != null ? (m != null ? ' ' : ' in ') + y : ''}`;
	else if (wd && d != null) {
		const ordi = [1, 8, 15, 22].indexOf(d);
		const wds = listWeekdays(wd, true);
		if (ordi >= 0) base = `The ${ORD[ordi + 1]} ${wds} of ${each}`;
		else
			base = `The first ${wds} on or after ${m != null ? d + ' ' + month(m) + (y ? ' ' + y : ' each year') : 'the ' + nth(d) + ' of every month'}`;
	} else if (d != null && m != null && y != null) base = `On ${fmtLiteral(lit())}`;
	else if (d != null && m != null) base = `Every year on ${d} ${month(m)}`;
	else if (d != null)
		base = `On the ${nth(d)} of every month${y != null ? ' in ' + y : ''}${d > 28 ? ' that has one' : ''}`;
	else if (m != null) base = `Every day in ${month(m)}${y != null ? ' ' + y : ''}`;
	else base = `Every day in ${y}`;
	if (rem.back)
		base += `, moved back ${rem.back} ${rem.backDouble ? 'day' : 'working day'}${rem.back > 1 ? 's' : ''}`;
	return base;
}

/** Sentences describing a parsed REM (or the reminder of an OMIT ... MSG). */
export function explainRem(rem: RemSpec): string[] {
	const lines: string[] = [];
	let when = rem.engineWhen ? `When this fires is ${BY_REMIND}` : explainWhen(rem);
	if (rem.at != null) when += ` at ${fmtTime(rem.at)}`;
	if (rem.duration) when += ` for ${durText(rem.duration)}`;
	lines.push(when + '.');
	if (rem.localWd)
		lines.push(`Treats ${listWeekdays(rem.localWd, false)} as days off for this reminder.`);
	if (rem.omitMode === 'SKIP') lines.push('Skipped when it lands on a day off or holiday.');
	if (rem.omitMode === 'BEFORE')
		lines.push('Moves to the working day before when it lands on a day off or holiday.');
	if (rem.omitMode === 'AFTER')
		lines.push('Moves to the next working day when it lands on a day off or holiday.');
	if (rem.delta)
		lines.push(
			`Starts reminding you ${rem.delta} ${rem.deltaDouble ? 'day' : 'working day'}${rem.delta > 1 ? 's' : ''} ahead.`
		);
	if (rem.from) lines.push(`Starts on ${fmtClause(rem.from)}.`);
	if (rem.until && !rem.fromOmit && rem.rep !== 1)
		lines.push(`Ends after ${fmtClause(rem.until)}.`);
	if (rem.todo) {
		lines.push('A task: it keeps reminding you after it is due until you mark it done.');
		if (rem.complete) lines.push(`Done through ${fmtClause(rem.complete)}.`);
		if (rem.maxOverdue != null)
			lines.push(
				`Stops nagging ${rem.maxOverdue} day${rem.maxOverdue === 1 ? '' : 's'} after it is due.`
			);
	}
	if (rem.addomit) lines.push('Also marks its date as a holiday for the reminders below it.');
	if (rem.fromOmit)
		lines.push('This OMIT line is also a reminder, and the day counts as a holiday.');
	if (rem.type === 'CAL') lines.push('Shows on the calendar only, with no agenda reminder.');
	if (rem.type === 'RUN')
		lines.push(
			'Runs a command instead of showing a message. The web app lists it but never runs it.'
		);
	if (rem.noqueue) lines.push('No timed alert; the time is for the calendar only.');
	if (rem.prio !== 5000) lines.push(`Priority ${rem.prio} (default is 5000).`);
	if (rem.engine.length)
		lines.push(`Uses ${[...new Set(rem.engine)].join(', ')}, which is ${BY_REMIND}.`);
	return lines;
}

const partial = (p: PartialDate): string => {
	const m = p.m != null ? MONTHS[p.m - 1] : '';
	return [p.d, m, p.y].filter((x) => x != null && x !== '').join(' ');
};

/** Sentences describing a parsed OMIT command. */
export function explainOmit(o: OmitSpec): string[] {
	if (o.dump) return ['Prints the current holidays. Ignored by the app.'];
	if (o.weekdays)
		return [
			`Treats every ${listWeekdays(o.weekdays, true)} as a day off. Reminders using -N, +N, SKIP, BEFORE or AFTER work around it.`
		];
	const out: string[] = [];
	const a = o.from;
	const b = o.through;
	if (a && !b) {
		if (a.d == null)
			out.push(
				a.y == null
					? `Marks all of ${MONTHS[a.m! - 1]} as holidays every year.`
					: `Marks all of ${MONTHS[a.m! - 1]} ${a.y} as holidays.`
			);
		else if (a.y == null) out.push(`Marks ${a.d} ${MONTHS[a.m! - 1]} as a holiday every year.`);
		else out.push(`Marks ${partial(a)} as a holiday.`);
	} else if (a && b) {
		const end =
			b.d == null ? `the end of ${MOS[b.m! - 1]}${b.y != null ? ' ' + b.y : ''}` : partial(b);
		if (a.y == null)
			out.push(
				`Marks ${a.d ?? 1} ${MOS[a.m! - 1]} through ${b.d == null ? end : `${b.d} ${MOS[b.m! - 1]}`} as holidays every year.`
			);
		else out.push(`Marks ${partial({ ...a, d: a.d ?? 1 })} through ${end} as holidays.`);
	}
	if (o.rem)
		out.push(
			'Also shows as a reminder' + (o.rem.delta ? `, starting ${o.rem.delta} days ahead.` : '.')
		);
	return out;
}

const CTX_TEXT: Record<string, string> = {
	'PUSH-OMIT-CONTEXT': 'Saves the current holidays so they can be restored later.',
	'POP-OMIT-CONTEXT': 'Restores the holidays saved by the last PUSH-OMIT-CONTEXT.',
	'CLEAR-OMIT-CONTEXT': 'Clears every holiday and day off for the lines below.',
	RETURN: 'Stops reading this file here.'
};

/** The label above an inspector: `Line 3` or `Line 3–4`. */
export function lineLabel(L: LogicalLine): string {
	return `Line ${L.start + 1}${L.end > L.start ? '–' + (L.end + 1) : ''}`;
}

/** What a line says, in sentences (the prototype's line inspector, without markup). */
export function explainLine(L: LogicalLine): string[] {
	switch (L.kind) {
		case 'error':
			return [
				L.error ?? 'Remind would stop on this line.',
				'Remind would stop on this line with an error. Everything else in the file still works.'
			];
		case 'comment':
			return ['A comment. Remind ignores lines that start with # or ;.'];
		case 'blank':
			return ['Put the cursor on a line to see how Remind reads it.'];
		case 'eof':
			return ['Remind stops reading this file here.'];
		case 'include':
			return [
				`Reads every reminder and holiday in ${L.target} at this point, so its OMITs apply to the lines below.`
			];
		case 'ctx':
			return [CTX_TEXT[L.cmd ?? ''] ?? `${L.cmd} is ${BY_REMIND}.`];
		case 'engine':
			return [`${L.cmd} is ${BY_REMIND}.`];
		case 'omit':
			return [...(L.omit ? explainOmit(L.omit) : []), ...(L.rem ? explainRem(L.rem) : [])];
		case 'rem':
			return L.rem ? explainRem(L.rem) : [];
	}
}
