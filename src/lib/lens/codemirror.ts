// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A CodeMirror 6 language for Remind scripts, driven by the lens tokenizer.
 * Highlight classes match the prototype's .sx-* tokens. Completions cover
 * commands, keywords, weekday and month names, `%` sequences and INFO headers.
 */
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Tag } from '@lezer/highlight';
import { tagHighlighter } from '@lezer/highlight';
import { BODY_KW, CTX_CMDS, MONTHS, WEEKDAYS, analyze, segments, tokenize } from './tokenize';
import type { Segment } from './types';

type StyleName = Segment['role'];

/** One CodeMirror tag per role. `plain` and `body` get none. */
export const sxTags: Record<Exclude<StyleName, 'plain' | 'body'>, Tag> = {
	cmd: Tag.define('sxCmd'),
	kw: Tag.define('sxKw'),
	date: Tag.define('sxDate'),
	wday: Tag.define('sxWday'),
	num: Tag.define('sxNum'),
	time: Tag.define('sxTime'),
	str: Tag.define('sxStr'),
	expr: Tag.define('sxExpr'),
	name: Tag.define('sxName'),
	err: Tag.define('sxErr'),
	comment: Tag.define('sxCom'),
	pct: Tag.define('sxPct')
};

/** The CSS class for a role, as in the prototype (`sx-kw`, `sx-com`, ...). */
export function roleClass(role: StyleName): string {
	if (role === 'plain' || role === 'body') return '';
	return role === 'comment' ? 'sx-com' : `sx-${role}`;
}

/** Maps the lens tags to the prototype's .sx-* classes. */
export const remindHighlighter = tagHighlighter(
	Object.entries(sxTags).map(([role, tag]) => ({ tag, class: roleClass(role as StyleName) }))
);

interface State {
	/** Raw text of earlier physical lines of the current logical line, or null. */
	prefix: string | null;
	queue: { len: number; name: string }[];
}

/** Segments of one physical line, given the earlier lines of its logical line. */
export function lineSegments(prefix: string | null, line: string): Segment[] {
	const raw = prefix == null ? line : prefix + '\n' + line;
	const L = analyze(raw)[0]!;
	// Whether more lines follow is unknown here, so a trailing backslash is not an error.
	const from = prefix == null ? 0 : prefix.length + 1;
	const out: Segment[] = [];
	for (const s of segments(L)) {
		if (s.to <= from) continue;
		const a = Math.max(s.from, from) - from;
		out.push({ from: a, to: s.to - from, role: s.role });
	}
	return out;
}

const continues = (s: string): boolean => (/(\\+)$/.exec(s)?.[1]?.length ?? 0) % 2 === 1;

const language = StreamLanguage.define<State>({
	name: 'remind',
	startState: () => ({ prefix: null, queue: [] }),
	copyState: (s) => ({ prefix: s.prefix, queue: s.queue.slice() }),
	blankLine: (s) => {
		s.prefix = null;
	},
	token(stream, state) {
		if (stream.sol()) {
			const line = stream.string;
			const segs = lineSegments(state.prefix, line);
			const more = continues(line);
			state.queue = [];
			let pos = 0;
			for (const sg of segs) {
				// Errors on a line that goes on are not final yet.
				const role = more && sg.role === 'err' ? 'plain' : sg.role;
				state.queue.push({ len: sg.to - pos, name: role });
				pos = sg.to;
			}
			if (pos < line.length) state.queue.push({ len: line.length - pos, name: 'plain' });
			state.prefix = more ? (state.prefix == null ? line : state.prefix + '\n' + line) : null;
		}
		const next = state.queue.shift();
		if (!next) {
			stream.skipToEnd();
			return null;
		}
		stream.pos += Math.max(1, next.len);
		return next.name === 'plain' || next.name === 'body' ? null : next.name;
	},
	tokenTable: Object.fromEntries(Object.entries(sxTags).map(([role, tag]) => [role, tag])),
	languageData: { commentTokens: { line: '#' } }
});

/* ------------------------------ completions ------------------------------ */

const REM_KEYWORDS = [
	'AT',
	'DURATION',
	'SKIP',
	'BEFORE',
	'AFTER',
	'UNTIL',
	'THROUGH',
	'FROM',
	'SCANFROM',
	'TODO',
	'COMPLETE-THROUGH',
	'MAX-OVERDUE',
	'PRIORITY',
	'INFO',
	'TAG',
	'TZ',
	'OMIT',
	'ADDOMIT',
	'NOQUEUE',
	'ONCE',
	'FIRST',
	'SECOND',
	'THIRD',
	'FOURTH',
	'LAST',
	'LASTDAY',
	'LASTWORKDAY',
	...BODY_KW
];

export const INFO_HEADERS = ['Location', 'Description', 'Url', 'Uid', 'Status'];

/** `%` sequences with a short description of what each shows. */
export const PCT_SEQUENCES: [string, string][] = [
	['a', 'weekday, day month, year'],
	['b', 'relative: today, tomorrow, in N days'],
	['c', 'weekday'],
	['d', 'day of the month'],
	['e', 'dd-mm-yyyy'],
	['f', 'mm-dd-yyyy'],
	['g', 'weekday, day month'],
	['h', 'dd-mm'],
	['i', 'mm-dd'],
	['j', 'weekday, month day-ordinal, year'],
	['k', 'weekday, month day-ordinal'],
	['l', 'yyyy-mm-dd'],
	['m', 'month name'],
	['n', 'month number'],
	['o', '" (today)" when it is today'],
	['p', 'plural "s" for the day count'],
	['q', "possessive: 's or s'"],
	['r', 'two-digit day'],
	['s', 'ordinal suffix: st, nd, rd, th'],
	['t', 'two-digit month'],
	['u', 'weekday, day-ordinal month, year'],
	['v', 'weekday, day-ordinal month'],
	['w', 'weekday name'],
	['x', 'days until'],
	['y', 'year'],
	['z', 'two-digit year'],
	['1', 'time until the event'],
	['2', 'time of day, 12-hour'],
	['3', 'time of day, 24-hour'],
	['_', 'new line'],
	['"', 'calendar-only text marker'],
	['%', 'a literal percent sign']
];

export interface CompletionSet {
	/** Offset in the line's text where the completed word starts. */
	from: number;
	options: Completion[];
}

/**
 * Completions for the text of a line before the cursor. Pure: no editor needed.
 * `explicit` is true when the user asked (Ctrl-Space); otherwise a word is needed.
 */
export function completionsFor(before: string, explicit = false): CompletionSet | null {
	const pct = /%\*?[A-Za-z0-9]?$/.exec(before);
	if (pct) {
		const star = pct[0][1] === '*' ? 1 : 0;
		return {
			from: pct.index + 1 + star,
			options: PCT_SEQUENCES.map(([c, info]) => ({
				label: c,
				displayLabel: '%' + c,
				detail: info,
				type: 'variable'
			}))
		};
	}
	const info = /\bINFO\s+"([^":]*)$/i.exec(before);
	if (info)
		return {
			from: before.length - (info[1] ?? '').length,
			options: INFO_HEADERS.map((h) => ({ label: h + ': ', displayLabel: h, type: 'property' }))
		};
	const word = /[A-Za-z][A-Za-z-]*$/.exec(before);
	if (!word && !explicit) return null;
	const from = word ? word.index : before.length;
	const head = before.slice(0, from);
	const toks = tokenize(head);
	if (toks.some((t) => t.text[0] === '"' && !t.text.endsWith('"'))) return null;
	if (!toks.length) {
		const cmds = ['REM', 'OMIT', 'DO', 'INCLUDE', ...CTX_CMDS, 'SET', 'IF', 'ELSE', 'ENDIF'];
		return { from, options: cmds.map((label) => ({ label, type: 'keyword' })) };
	}
	const first = toks[0]!.text.toUpperCase();
	if (toks.some((t) => BODY_KW.has(t.text.toUpperCase()))) return null;
	if (first !== 'REM' && first !== 'OMIT') return null;
	const options: Completion[] = [
		...(first === 'REM' ? REM_KEYWORDS : ['THROUGH', ...BODY_KW]).map((label) => ({
			label,
			type: 'keyword'
		})),
		...WEEKDAYS.map((label) => ({ label, type: 'constant', detail: 'weekday' })),
		...MONTHS.map((label) => ({ label, type: 'constant', detail: 'month' }))
	];
	return { from, options };
}

/** Completion source for CodeMirror. */
export function remindCompletions(context: CompletionContext) {
	const line = context.state.doc.lineAt(context.pos);
	const set = completionsFor(line.text.slice(0, context.pos - line.from), context.explicit);
	if (!set) return null;
	return { from: line.from + set.from, options: set.options, validFor: /^[\w-]*$/ };
}

/** The language, with completion data attached. */
export function remindLanguage(): LanguageSupport {
	return new LanguageSupport(language, [language.data.of({ autocomplete: remindCompletions })]);
}

/** Everything an editor needs: language, highlighting and completion. */
export function remind(): Extension[] {
	return [remindLanguage(), syntaxHighlighting(remindHighlighter), autocompletion()];
}
