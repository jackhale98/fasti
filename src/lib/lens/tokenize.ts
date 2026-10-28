// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Logical lines, tokens with roles, `%` spans and line classification.
 *
 * Ported from the prototype's tokenizer and parseRem/parseOmitCmd. The lens
 * never computes dates: a parsed line keeps the literals as written. The one
 * calendar fact used here is `daysInMonth`, to reject `31 Feb` the way the
 * prototype did (validation of what was typed, not a derived date).
 */
import type {
	Match,
	DateClause,
	Diagnostic,
	LogicalLine,
	OmitSpec,
	PartialDate,
	RemSpec,
	Segment,
	Span,
	Sugar,
	Token
} from './types';

export const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];
export const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** Keywords that start a reminder's body; everything after them is text. */
export const BODY_KW = new Set([
	'MSG',
	'MSF',
	'FMT',
	'RUN',
	'CAL',
	'PS',
	'PSFILE',
	'SPECIAL',
	'SATISFY'
]);

/** Commands Remind evaluates itself; the lens only recognises them. */
export const ENGINE_CMDS = new Set([
	'SET',
	'FSET',
	'UNSET',
	'FUNSET',
	'IF',
	'IFTRIG',
	'ELSE',
	'ENDIF',
	'BANNER',
	'RUN',
	'EXPR',
	'DEBUG',
	'ERRMSG',
	'PRESERVE',
	'EXIT',
	'FLUSH',
	'TRANSLATE',
	'PUSH-VARS',
	'POP-VARS',
	'PUSH-FUNCS',
	'POP-FUNCS',
	'INCLUDECMD',
	'DUMPVARS',
	'MSG',
	'MSF',
	'FRENAME'
]);

export const CTX_CMDS = new Set([
	'PUSH-OMIT-CONTEXT',
	'POP-OMIT-CONTEXT',
	'CLEAR-OMIT-CONTEXT',
	'RETURN'
]);

/** Validation only: how many days a month written in a line can have. */
export function daysInMonth(y: number | null, m: number): number {
	if (m === 2) {
		const yy = y ?? 2024;
		return (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 29 : 28;
	}
	return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function nameIndex(tok: string, list: string[]): number {
	const t = tok.toLowerCase();
	if (t.length < 3) return -1;
	return list.findIndex((x) => x.toLowerCase().startsWith(t));
}
/** Weekday index (0 = Sunday) for a name or 3+ letter prefix, or -1. */
export const wdIndex = (t: string): number => nameIndex(t, WEEKDAYS);
/** Month index (0 = January) for a name or 3+ letter prefix, or -1. */
export const moIndex = (t: string): number => nameIndex(t, MONTHS);

/* ------------------------------ logical lines ------------------------------ */

interface Physical {
	start: number;
	end: number;
	eol: string;
}

/** Physical lines of a text: content range and line ending. A text always has at least one. */
export function physicalLines(text: string): Physical[] {
	const out: Physical[] = [];
	let pos = 0;
	for (;;) {
		const nl = text.indexOf('\n', pos);
		if (nl < 0) {
			out.push({ start: pos, end: text.length, eol: '' });
			return out;
		}
		const cr = nl > pos && text[nl - 1] === '\r';
		out.push({ start: pos, end: cr ? nl - 1 : nl, eol: cr ? '\r\n' : '\n' });
		pos = nl + 1;
	}
}

/** `RegExp.exec` typed so numbered groups are strings (a group that did not match is undefined at run time). */
const rx = (re: RegExp, s: string): Match | null => re.exec(s) as Match | null;

const endsWithContinuation = (s: string): boolean => {
	const m = rx(/(\\+)$/, s);
	return !!m && m[1].length % 2 === 1;
};

/** Split a file into logical lines, joining backslash continuations (LF or CRLF). */
export function logicalLines(text: string): LogicalLine[] {
	const phys = physicalLines(text);
	const out: LogicalLine[] = [];
	for (let i = 0; i < phys.length; i++) {
		const start = i;
		while (endsWithContinuation(text.slice(phys[i]!.start, phys[i]!.end)) && i + 1 < phys.length)
			i++;
		const offset = phys[start]!.start;
		const raw = text.slice(offset, phys[i]!.end);
		let joined = '';
		const map: number[] = [];
		for (let k = 0; k < raw.length; k++) {
			if (raw[k] === '\\') {
				if (raw[k + 1] === '\n') {
					k++;
					continue;
				}
				if (raw[k + 1] === '\r' && raw[k + 2] === '\n') {
					k += 2;
					continue;
				}
			}
			joined += raw[k];
			map.push(k);
		}
		map.push(raw.length);
		out.push({
			start,
			end: i,
			offset,
			raw,
			eol: phys[i]!.eol,
			joined,
			map,
			kind: 'blank',
			tokens: [],
			pct: []
		});
	}
	return out;
}

/* -------------------------------- tokenizer -------------------------------- */

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/** Whitespace-separated tokens, "strings" and [expressions]. Offsets are in `line`. */
export function tokenize(line: string): Omit<Token, 'rawStart' | 'rawEnd'>[] {
	const toks: Omit<Token, 'rawStart' | 'rawEnd'>[] = [];
	let i = 0;
	const L = line.length;
	const skipString = () => {
		i++;
		while (i < L && line[i] !== '"') {
			if (line[i] === '\\') i++;
			i++;
		}
	};
	while (i < L) {
		while (i < L && isSpace(line[i])) i++;
		if (i >= L) break;
		const s = i;
		if (line[i] === '"') {
			skipString();
			i++;
		} else if (line[i] === '[') {
			let depth = 0;
			while (i < L) {
				const c = line[i];
				if (c === '[') depth++;
				else if (c === ']') {
					depth--;
					if (depth === 0) {
						i++;
						break;
					}
				} else if (c === '"') skipString();
				i++;
			}
			while (i < L && !isSpace(line[i])) i++;
		} else {
			while (i < L && !isSpace(line[i])) i++;
		}
		const e = Math.min(i, L);
		toks.push({ text: line.slice(s, e), s, e, role: 'plain' });
	}
	return toks;
}

const ISO_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:@(\d{1,2})[:.](\d{2})(am?|pm?)?)?$/i;

/** A time of day as minutes after midnight, or null. Not a date. */
export function parseTime(s: string): number | null {
	const m = rx(/^(\d{1,2})[:.](\d{2})\s*(am?|pm?)?$/i, s);
	if (!m) return null;
	let h = +m[1];
	const mi = +m[2];
	const ap = m[3] && m[3][0]!.toLowerCase();
	if (mi > 59) return null;
	if (ap) {
		if (h < 1 || h > 12) return null;
		h = ap === 'a' ? h % 12 : (h % 12) + 12;
	} else if (h > 23) return null;
	return h * 60 + mi;
}

function parseDuration(s: string): number | null {
	let m = rx(/^(\d+)[:.](\d{2})$/, s);
	if (m) return +m[1] * 60 + +m[2];
	m = rx(/^\d+$/, s);
	return m ? +s : null;
}

export class ParseError extends Error {
	tok: Token | undefined;
	constructor(msg: string, tok?: Token) {
		super(msg);
		this.tok = tok;
	}
}

function newRem(): RemSpec {
	return {
		spec: { d: null, m: null, y: null, wd: null },
		back: 0,
		backDouble: false,
		delta: 0,
		deltaDouble: false,
		rep: 0,
		todo: false,
		maxOverdue: null,
		complete: null,
		prio: 5000,
		omitMode: null,
		localWd: null,
		addomit: false,
		noqueue: false,
		once: false,
		at: null,
		tdelta: 0,
		trep: 0,
		until: null,
		through: null,
		from: null,
		duration: null,
		tags: [],
		info: {},
		tz: null,
		type: null,
		special: null,
		body: '',
		bodyStart: 0,
		sugar: null,
		engine: [],
		engineWhen: false
	};
}

const sortedSet = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);

/** Parse a full date from tokens at `i`: ISO, or day/month/year in any order. */
function parseDateClause(
	toks: Token[],
	i: number,
	what: string
): { lit: DateClause; next: number; expr?: boolean } {
	const t = toks[i];
	if (!t) throw new ParseError(`${what} needs a date after it`, toks[i - 1]);
	if (t.text[0] === '[') {
		t.role = 'expr';
		return { lit: 'expr', next: i + 1, expr: true };
	}
	const iso = rx(ISO_RE, t.text);
	if (iso) {
		const y = +iso[1],
			m = +iso[2],
			d = +iso[3];
		if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m))
			throw new ParseError(`${t.text} is not a real date`, t);
		t.role = 'date';
		return { lit: { y, m, d }, next: i + 1 };
	}
	let d: number | null = null,
		m: number | null = null,
		y: number | null = null,
		j = i;
	while (j < toks.length && (d == null || m == null || y == null)) {
		const tk = toks[j] as Token;
		let used = false;
		if (/^\d+$/.test(tk.text)) {
			const v = +tk.text;
			if (d == null && v >= 1 && v <= 31) {
				d = v;
				used = true;
			} else if (y == null && v >= 1990 && v <= 2075) {
				y = v;
				used = true;
			}
		} else if (m == null && moIndex(tk.text) >= 0) {
			m = moIndex(tk.text) + 1;
			used = true;
		}
		if (!used) break;
		tk.role = 'date';
		j++;
	}
	if (d == null || m == null || y == null)
		throw new ParseError(`${what} needs a complete date, like 2026-12-11 or 11 Dec 2026`, toks[i]);
	if (d > daysInMonth(y, m))
		throw new ParseError(`${d} ${MONTHS[m - 1]} ${y} is not a real date`, toks[i]);
	return { lit: { y, m, d }, next: j };
}

/* ----------------------------------- REM ----------------------------------- */

/** Parse a REM line. `text` is the joined line; sets token roles. Throws ParseError. */
export function parseRem(text: string, toks: Token[]): RemSpec {
	const rem = newRem();
	rem.bodyStart = text.length;
	toks[0]!.role = 'cmd';
	let i = 1;
	let ordinal: number | 'last' | null = null;
	let tilde: { n: number; double: boolean } | null = null;
	let lastday: 'day' | 'work' | null = null;
	const wd = new Set<number>();
	const localWd = new Set<number>();
	const sp = rem.spec;
	const setPart = (k: 'y' | 'm' | 'd', v: number, tk: Token, label: string) => {
		if (sp[k] != null) throw new ParseError(`The ${label} is given twice`, tk);
		sp[k] = v;
	};
	const expr = (tk: Token, when = false) => {
		tk.role = 'expr';
		rem.engine.push('an expression');
		if (when) rem.engineWhen = true;
	};
	const clauseExpr = (r: { expr?: boolean }) => {
		if (r.expr) rem.engine.push('an expression');
	};
	while (i < toks.length) {
		const tk = toks[i] as Token;
		const t = tk.text;
		const U = t.toUpperCase();
		if (BODY_KW.has(U)) {
			tk.role = 'kw';
			rem.type = U;
			if (U === 'SATISFY') {
				rem.engine.push('SATISFY');
				rem.engineWhen = true;
			}
			let bs = tk.e;
			if (U === 'SPECIAL') {
				const nx = toks[i + 1];
				if (!nx) throw new ParseError('SPECIAL needs a type, like COLOR', tk);
				nx.role = 'name';
				rem.special = nx.text;
				bs = nx.e;
			}
			while (bs < text.length && isSpace(text[bs])) bs++;
			rem.bodyStart = bs;
			rem.body = text.slice(bs);
			break;
		}
		if (t[0] === '[') {
			expr(tk, true);
			i++;
			continue;
		}
		const iso = rx(ISO_RE, t);
		if (iso) {
			const y = +iso[1],
				m = +iso[2],
				d = +iso[3];
			if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m))
				throw new ParseError(`${t} is not a real date`, tk);
			if (y < 1990 || y > 2075) throw new ParseError('Remind handles years from 1990 to 2075', tk);
			setPart('y', y, tk, 'year');
			setPart('m', m, tk, 'month');
			setPart('d', d, tk, 'day');
			if (iso[4] != null) {
				const at = parseTime(`${iso[4]}:${iso[5]}${iso[6] || ''}`);
				if (at == null) throw new ParseError('That time is not valid', tk);
				rem.at = at;
			}
			tk.role = 'date';
			i++;
			continue;
		}
		let m: Match | null;
		if ((m = rx(/^(\+\+|\+|--|-|\*|~~|~)(\d+)$/, t))) {
			const v = +m[2];
			tk.role = 'num';
			if (m[1][0] === '+') {
				if (rem.delta || rem.deltaDouble)
					throw new ParseError('Only one advance warning (+N) is allowed', tk);
				rem.delta = v;
				rem.deltaDouble = m[1] === '++';
			} else if (m[1][0] === '-') {
				if (rem.back) throw new ParseError('Only one back (-N) is allowed', tk);
				rem.back = v;
				rem.backDouble = m[1] === '--';
			} else if (m[1] === '*') {
				if (rem.rep) throw new ParseError('Only one repeat (*N) is allowed', tk);
				if (v < 1) throw new ParseError('A repeat must be at least *1', tk);
				rem.rep = v;
			} else {
				if (tilde) throw new ParseError('Only one ~N is allowed', tk);
				tilde = { n: v, double: m[1] === '~~' };
			}
			i++;
			continue;
		}
		if (/^\d+$/.test(t)) {
			const v = +t;
			if (v >= 1 && v <= 31 && sp.d == null) sp.d = v;
			else if (v >= 1990 && v <= 2075 && sp.y == null) sp.y = v;
			else throw new ParseError(`${t} isn't a day (1–31) or a year (1990–2075) here`, tk);
			tk.role = 'date';
			i++;
			continue;
		}
		switch (U) {
			case 'IN':
				tk.role = 'kw';
				i++;
				continue;
			case 'ONCE':
				tk.role = 'kw';
				rem.once = true;
				i++;
				continue;
			case 'TODO':
				tk.role = 'kw';
				rem.todo = true;
				i++;
				continue;
			case 'ADDOMIT':
				tk.role = 'kw';
				rem.addomit = true;
				i++;
				continue;
			case 'NOQUEUE':
				tk.role = 'kw';
				rem.noqueue = true;
				i++;
				continue;
			case 'SKIP':
			case 'BEFORE':
			case 'AFTER':
				tk.role = 'kw';
				if (rem.omitMode) throw new ParseError('Use only one of SKIP, BEFORE or AFTER', tk);
				rem.omitMode = U;
				i++;
				continue;
			case 'LASTDAY':
			case 'LASTWORKDAY':
				tk.role = 'date';
				if (lastday) throw new ParseError(`${t} is given twice`, tk);
				lastday = U === 'LASTDAY' ? 'day' : 'work';
				i++;
				continue;
			case 'FIRST':
			case 'SECOND':
			case 'THIRD':
			case 'FOURTH':
			case 'LAST':
				tk.role = 'date';
				if (ordinal)
					throw new ParseError('Only one of First/Second/Third/Fourth/Last is allowed', tk);
				ordinal = U === 'LAST' ? 'last' : ['FIRST', 'SECOND', 'THIRD', 'FOURTH'].indexOf(U) + 1;
				i++;
				continue;
			case 'PRIORITY': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (!nx || !/^\d+$/.test(nx.text) || +nx.text > 9999)
					throw new ParseError('PRIORITY needs a number from 0 to 9999', tk);
				nx.role = 'num';
				rem.prio = +nx.text;
				i += 2;
				continue;
			}
			case 'MAX-OVERDUE': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (!nx || !/^\d+$/.test(nx.text))
					throw new ParseError('MAX-OVERDUE needs a number of days', tk);
				nx.role = 'num';
				rem.maxOverdue = +nx.text;
				i += 2;
				continue;
			}
			case 'COMPLETE-THROUGH':
			case 'COMPLETED-THROUGH': {
				tk.role = 'kw';
				const r = parseDateClause(toks, i + 1, U);
				rem.complete = r.lit;
				clauseExpr(r);
				i = r.next;
				continue;
			}
			case 'UNTIL':
			case 'THROUGH': {
				tk.role = 'kw';
				const r = parseDateClause(toks, i + 1, U);
				if (rem.until != null || rem.through != null)
					throw new ParseError('Use only one UNTIL or THROUGH', tk);
				clauseExpr(r);
				if (U === 'UNTIL') rem.until = r.lit;
				else rem.through = r.lit;
				i = r.next;
				continue;
			}
			case 'FROM': {
				tk.role = 'kw';
				const r = parseDateClause(toks, i + 1, U);
				rem.from = r.lit;
				clauseExpr(r);
				i = r.next;
				continue;
			}
			case 'SCANFROM': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (nx && /^-?\d+$/.test(nx.text)) {
					nx.role = 'num';
					i += 2;
					continue;
				}
				const r = parseDateClause(toks, i + 1, U);
				clauseExpr(r);
				i = r.next;
				continue;
			}
			case 'AT': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (!nx) throw new ParseError('AT needs a time, like 9:30 or 2:15pm', tk);
				if (nx.text[0] === '[') {
					expr(nx);
					i += 2;
					continue;
				}
				const at = parseTime(nx.text);
				if (at == null) throw new ParseError(`${nx.text} isn't a time Remind understands`, nx);
				nx.role = 'time';
				rem.at = at;
				i += 2;
				for (let k = 0; k < 2; k++) {
					const q = toks[i];
					if (!q) break;
					let mm = rx(/^\+\+?(\d+)$/, q.text);
					if (mm) {
						q.role = 'num';
						rem.tdelta = +mm[1];
						i++;
						continue;
					}
					mm = rx(/^\*(\d+)$/, q.text);
					if (mm) {
						q.role = 'num';
						rem.trep = +mm[1];
						i++;
						continue;
					}
					break;
				}
				continue;
			}
			case 'DURATION': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (!nx) throw new ParseError('DURATION needs a length, like 1:30 or 90', tk);
				if (nx.text[0] === '[') {
					expr(nx);
					i += 2;
					continue;
				}
				const du = parseDuration(nx.text);
				if (du == null)
					throw new ParseError(`${nx.text} isn't a duration (use h:mm or minutes)`, nx);
				nx.role = 'time';
				rem.duration = du || null;
				i += 2;
				continue;
			}
			case 'TAG': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (!nx) throw new ParseError('TAG needs a word after it', tk);
				nx.role = 'name';
				rem.tags.push(nx.text);
				i += 2;
				continue;
			}
			case 'TZ': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (!nx) throw new ParseError('TZ needs a time zone name', tk);
				nx.role = 'name';
				rem.tz = nx.text;
				i += 2;
				continue;
			}
			case 'INFO': {
				tk.role = 'kw';
				let j = i + 1;
				let s = '';
				const first = toks[j];
				if (!first || first.text[0] !== '"')
					throw new ParseError('INFO needs a quoted "Header: Value" string', tk);
				while (toks[j] && toks[j]!.text[0] === '"') {
					toks[j]!.role = 'str';
					const tx = toks[j]!.text;
					s += tx
						.slice(1, tx.endsWith('"') && tx.length > 1 ? -1 : undefined)
						.replace(/\\n/g, '\n')
						.replace(/\\(.)/g, '$1');
					j++;
					if (toks[j] && toks[j]!.text === '+' && toks[j + 1] && toks[j + 1]!.text[0] === '"') {
						toks[j]!.role = 'kw';
						j++;
					} else break;
				}
				const c = s.indexOf(':');
				if (c < 1 || /\s/.test(s.slice(0, c)))
					throw new ParseError('INFO strings look like "Header: Value"', first);
				const key = s.slice(0, c);
				if (Object.keys(rem.info).some((k) => k.toLowerCase() === key.toLowerCase()))
					throw new ParseError(`INFO "${key}" is given twice`, first);
				rem.info[key] = s.slice(c + 1).trim();
				i = j;
				continue;
			}
			case 'OMIT': {
				tk.role = 'kw';
				let j = i + 1;
				let n = 0;
				while (toks[j] && wdIndex(toks[j]!.text) >= 0) {
					localWd.add(wdIndex(toks[j]!.text));
					toks[j]!.role = 'wday';
					j++;
					n++;
				}
				if (!n) throw new ParseError('OMIT inside REM takes weekday names, like OMIT Sat Sun', tk);
				i = j;
				continue;
			}
			case 'OMITFUNC':
			case 'WARN':
			case 'SCHED': {
				tk.role = 'kw';
				const nx = toks[i + 1];
				if (nx) nx.role = 'name';
				rem.engine.push(U);
				if (U === 'OMITFUNC') rem.engineWhen = true;
				i += 2;
				continue;
			}
		}
		const w = wdIndex(t);
		if (w >= 0) {
			tk.role = 'wday';
			wd.add(w);
			i++;
			continue;
		}
		const mo = moIndex(t);
		if (mo >= 0) {
			setPart('m', mo + 1, tk, 'month');
			tk.role = 'date';
			i++;
			continue;
		}
		throw new ParseError(`I don't recognise “${t}”`, tk);
	}
	if (!rem.type)
		throw new ParseError('Add MSG (or CAL, RUN…) before the reminder text', toks[toks.length - 1]);
	if (wd.size) sp.wd = sortedSet(wd);
	if (localWd.size) rem.localWd = sortedSet(localWd);

	// The sugar forms the man page defines; the spec keeps exactly what was written.
	let hasDay = sp.d != null;
	if (ordinal != null || tilde || lastday) {
		if (sp.d != null)
			throw new ParseError(
				'First/Last/~N already imply the day of the month, so drop the day number',
				toks[0]
			);
		if (ordinal != null && !sp.wd)
			throw new ParseError(
				`${ordinal === 'last' ? 'Last' : 'First/Second/Third/Fourth'} needs a weekday, like Last Friday`,
				toks[0]
			);
		const sugar: Sugar =
			ordinal != null ? { ord: ordinal } : tilde ? { tilde } : { lastday: lastday! };
		rem.sugar = sugar;
		hasDay = true;
		if (ordinal == null || ordinal === 'last') {
			if (rem.back)
				throw new ParseError('This form already sets the back (-N); remove the extra one', toks[0]);
		}
	}
	if (
		sp.d != null &&
		sp.m != null &&
		sp.wd == null &&
		sp.d > (sp.y ? daysInMonth(sp.y, sp.m) : daysInMonth(2024, sp.m))
	)
		throw new ParseError(`${MONTHS[sp.m - 1]} has no day ${sp.d}`, toks[0]);
	const complete = hasDay && sp.m != null && sp.y != null;
	if (rem.rep && !complete)
		throw new ParseError('A repeat (*N) needs a complete start date, like 2026-10-30 *14', toks[0]);
	if (rem.through != null) {
		if (rem.rep)
			throw new ParseError('THROUGH already repeats daily; drop the *N or use UNTIL', toks[0]);
		if (!complete) throw new ParseError('THROUGH needs a complete start date', toks[0]);
	}
	if (rem.complete != null && !rem.todo)
		throw new ParseError('COMPLETE-THROUGH only works on a TODO', toks[0]);
	if (rem.tz && rem.at == null) throw new ParseError('TZ needs an AT time too', toks[0]);
	return rem;
}

/* ------------------------------- OMIT command ------------------------------- */

/** Parse an OMIT line. Sets token roles. Throws ParseError. */
export function parseOmitCmd(text: string, toks: Token[]): OmitSpec {
	toks[0]!.role = 'cmd';
	const out: OmitSpec = {
		dump: false,
		weekdays: null,
		from: null,
		through: null,
		delta: 0,
		deltaDouble: false,
		rem: null
	};
	if (toks[1] && toks[1]!.text.toUpperCase() === 'DUMP') {
		toks[1]!.role = 'kw';
		out.dump = true;
		return out;
	}
	let i = 1;
	if (toks[i] && wdIndex(toks[i]!.text) >= 0) {
		const set = new Set<number>();
		while (toks[i] && wdIndex(toks[i]!.text) >= 0) {
			set.add(wdIndex(toks[i]!.text));
			toks[i]!.role = 'wday';
			i++;
		}
		out.weekdays = sortedSet(set);
		if (toks[i])
			throw new ParseError(`I don't recognise “${toks[i]!.text}” after the weekdays`, toks[i]);
		return out;
	}
	const readPart = (): PartialDate | null => {
		const tk = toks[i];
		if (!tk) return null;
		const iso = rx(ISO_RE, tk.text);
		if (iso) {
			tk.role = 'date';
			i++;
			return { d: +iso[3], m: +iso[2], y: +iso[1] };
		}
		const p: PartialDate = { d: null, m: null, y: null };
		while (toks[i]) {
			const t = toks[i]!.text;
			if (/^\d+$/.test(t)) {
				const v = +t;
				if (p.d == null && v >= 1 && v <= 31) p.d = v;
				else if (p.y == null && v >= 1990 && v <= 2075) p.y = v;
				else break;
			} else if (p.m == null && moIndex(t) >= 0) p.m = moIndex(t) + 1;
			else break;
			toks[i]!.role = 'date';
			i++;
		}
		return p.m == null && p.d == null && p.y == null ? null : p;
	};
	const a = readPart();
	if (!a || a.m == null)
		throw new ParseError(
			'OMIT needs weekdays or a date with a month, like OMIT 25 Dec',
			toks[1] || toks[0]
		);
	out.from = a;
	let b: PartialDate | null = null;
	if (toks[i] && toks[i]!.text.toUpperCase() === 'THROUGH') {
		toks[i]!.role = 'kw';
		i++;
		b = readPart();
		if (!b || b.m == null) throw new ParseError('THROUGH needs an end date', toks[i - 1]);
		if ((a.y == null) !== (b.y == null))
			throw new ParseError('Give the year on both sides of THROUGH, or on neither', toks[0]);
		out.through = b;
	}
	while (toks[i]) {
		const tk = toks[i]!;
		const U = tk.text.toUpperCase();
		let mm: Match | null;
		if ((mm = rx(/^(\+\+?)(\d+)$/, tk.text))) {
			tk.role = 'num';
			out.delta = +mm[2];
			out.deltaDouble = mm[1] === '++';
			i++;
			continue;
		}
		if (BODY_KW.has(U)) {
			tk.role = 'kw';
			if (!(a.y != null && a.d != null) && b)
				throw new ParseError(
					'A THROUGH OMIT can only carry a message when both dates are complete',
					tk
				);
			let bs = tk.e;
			while (bs < text.length && isSpace(text[bs])) bs++;
			const rem = newRem();
			rem.spec = { d: a.d, m: a.m, y: a.y, wd: null };
			rem.delta = out.delta;
			rem.deltaDouble = out.deltaDouble;
			rem.rep = b ? 1 : 0;
			if (b) rem.until = { y: b.y!, m: b.m!, d: b.d };
			rem.type = U;
			rem.body = text.slice(bs);
			rem.bodyStart = bs;
			rem.fromOmit = true;
			out.rem = rem;
			if (a.d == null) throw new ParseError('Give a day for an OMIT that carries a message', tk);
			break;
		}
		throw new ParseError(`I don't recognise “${tk.text}” here`, tk);
	}
	if (b && a.y != null) {
		// Compared as written, not converted to day numbers.
		const s = [a.y, a.m, a.d ?? 1];
		const e = [b.y!, b.m!, b.d ?? 31];
		for (let k = 0; k < 3; k++) {
			if (e[k]! < s[k]!) throw new ParseError('The end of the range is before its start', toks[0]);
			if (e[k]! > s[k]!) break;
		}
	}
	return out;
}

/* ------------------------------ classification ------------------------------ */

const PCT_RE = /%(\*?)([A-Za-z0-9_!?@#:"%]|<[^>]*>|\([^)]*\))/g;

/** `%` sequences in the body of a line, as raw offsets. */
function pctSpans(L: LogicalLine, bodyStart: number): Span[] {
	const spans: Span[] = [];
	const body = L.joined.slice(bodyStart);
	PCT_RE.lastIndex = 0;
	let m: Match | null;
	while ((m = rx(PCT_RE, body))) {
		const s = bodyStart + m.index;
		const e = s + m[0].length;
		spans.push({ from: L.map[s]!, to: L.map[e - 1]! + 1 });
	}
	return spans;
}

/** Fill in kind, tokens, parsed REM/OMIT and diagnostics for one logical line. */
export function analyzeLine(L: LogicalLine): LogicalLine {
	const tr = L.joined.trim();
	L.tokens = [];
	L.pct = [];
	delete L.rem;
	delete L.omit;
	delete L.error;
	delete L.errorToken;
	delete L.target;
	delete L.cmd;
	if (!tr) {
		L.kind = 'blank';
		return L;
	}
	if (tr[0] === '#' || tr[0] === ';') {
		L.kind = 'comment';
		return L;
	}
	if (tr === '__EOF__') {
		L.kind = 'eof';
		return L;
	}
	L.tokens = tokenize(L.joined).map((t) => ({
		...t,
		rawStart: L.map[t.s]!,
		rawEnd: L.map[t.e - 1]! + 1
	}));
	const toks = L.tokens;
	const U = toks[0]!.text.toUpperCase();
	L.cmd = U;
	try {
		if (U === 'REM') {
			L.kind = 'rem';
			L.rem = parseRem(L.joined, toks);
		} else if (U === 'OMIT') {
			L.kind = 'omit';
			L.omit = parseOmitCmd(L.joined, toks);
			if (L.omit.rem) L.rem = L.omit.rem;
		} else if (U === 'DO' || U === 'INCLUDE' || U === 'SYSINCLUDE') {
			L.kind = 'include';
			toks[0]!.role = 'cmd';
			if (toks[1]) {
				toks[1]!.role = 'name';
				L.target = toks[1]!.text.replace(/^"|"$/g, '');
			} else throw new ParseError(`${U} needs a file name`, toks[0]);
		} else if (CTX_CMDS.has(U)) {
			L.kind = 'ctx';
			toks[0]!.role = 'cmd';
		} else if (ENGINE_CMDS.has(U)) {
			L.kind = 'engine';
			toks[0]!.role = 'cmd';
			toks.slice(1).forEach((t) => {
				if (t.text[0] === '[') t.role = 'expr';
			});
		} else throw new ParseError('Start each reminder with REM', toks[0]);
	} catch (e) {
		if (!(e instanceof ParseError)) throw e;
		L.kind = 'error';
		L.error = e.message;
		L.rem = null;
		delete L.omit;
		if (e.tok) {
			e.tok.role = 'err';
			L.errorToken = toks.indexOf(e.tok);
		}
	}
	if (L.rem) L.pct = pctSpans(L, L.rem.bodyStart);
	return L;
}

/** Split a file into analysed logical lines. */
export function analyze(text: string): LogicalLine[] {
	return logicalLines(text).map(analyzeLine);
}

/** The logical line containing a physical line, or undefined. */
export function lineAt(lines: LogicalLine[], physical: number): LogicalLine | undefined {
	return lines.find((l) => physical >= l.start && physical <= l.end);
}

/** Highlighted runs covering a logical line's raw text, without gaps. */
export function segments(L: LogicalLine): Segment[] {
	const raw = L.raw;
	if (L.kind === 'blank') return raw ? [{ from: 0, to: raw.length, role: 'plain' }] : [];
	if (L.kind === 'comment') return [{ from: 0, to: raw.length, role: 'comment' }];
	const out: Segment[] = [];
	let pos = 0;
	const push = (from: number, to: number, role: Segment['role']) => {
		if (to > from) out.push({ from, to, role });
	};
	const bodyStart = L.rem ? L.rem.bodyStart : null;
	for (const tk of L.tokens) {
		if (bodyStart != null && tk.s >= bodyStart) break;
		push(pos, tk.rawStart, 'plain');
		push(tk.rawStart, tk.rawEnd, tk.role);
		pos = tk.rawEnd;
	}
	if (bodyStart != null) {
		const a = L.map[Math.min(bodyStart, L.map.length - 1)]!;
		push(pos, a, 'plain');
		let p = a;
		for (const sp of L.pct) {
			push(p, sp.from, 'body');
			push(sp.from, sp.to, 'pct');
			p = sp.to;
		}
		push(p, raw.length, 'body');
		pos = raw.length;
	}
	push(pos, raw.length, 'plain');
	return out;
}

/** Problems in a file, as file offsets. A whole-line range is used when no token is at fault. */
export function diagnostics(lines: LogicalLine[]): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const L of lines) {
		if (L.kind !== 'error' || !L.error) continue;
		const tk = L.errorToken != null && L.errorToken >= 0 ? L.tokens[L.errorToken] : undefined;
		out.push({
			line: L.start,
			from: L.offset + (tk ? tk.rawStart : 0),
			to: L.offset + (tk ? tk.rawEnd : L.raw.length),
			message: L.error
		});
	}
	return out;
}
