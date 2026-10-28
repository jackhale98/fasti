// SPDX-License-Identifier: GPL-2.0-or-later
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { highlightTree } from '@lezer/highlight';
import { ensureSyntaxTree } from '@codemirror/language';
import {
	completionsFor,
	lineSegments,
	remindHighlighter,
	remindLanguage,
	roleClass
} from '../../src/lib/lens/codemirror';

function classes(doc: string): [string, string][] {
	const state = EditorState.create({ doc, extensions: [remindLanguage()] });
	const tree = ensureSyntaxTree(state, doc.length, 5000)!;
	const out: [string, string][] = [];
	highlightTree(tree, remindHighlighter, (from, to, cls) => out.push([doc.slice(from, to), cls]));
	return out;
}

describe('highlight classes', () => {
	it('match the prototype .sx-* names', () => {
		expect(roleClass('kw')).toBe('sx-kw');
		expect(roleClass('comment')).toBe('sx-com');
		expect(roleClass('pct')).toBe('sx-pct');
		expect(roleClass('plain')).toBe('');
	});

	it('styles a REM line through the CodeMirror language', () => {
		const got = classes('REM 2026-10-28 AT 9:30 +2 MSG Hi %b');
		expect(got).toContainEqual(['REM', 'sx-cmd']);
		expect(got).toContainEqual(['2026-10-28', 'sx-date']);
		expect(got).toContainEqual(['AT', 'sx-kw']);
		expect(got).toContainEqual(['9:30', 'sx-time']);
		expect(got).toContainEqual(['+2', 'sx-num']);
		expect(got).toContainEqual(['%b', 'sx-pct']);
	});

	it('styles comments and continuation lines', () => {
		expect(classes('# note')).toEqual([['# note', 'sx-com']]);
		const got = classes('REM 2026-10-28 \\\n  INFO "Location: X" \\\n  MSG hi');
		expect(got).toContainEqual(['INFO', 'sx-kw']);
		expect(got.some(([t, c]) => c === 'sx-str' && t.includes('Location'))).toBe(true);
		expect(got).toContainEqual(['MSG', 'sx-kw']);
	});

	it('lineSegments clips a continued line to its own text', () => {
		const segs = lineSegments('REM Mon \\', '  MSG hi');
		expect(segs[segs.length - 1]!.to).toBe('  MSG hi'.length);
		expect(segs.some((s) => s.role === 'kw' && s.from === 2 && s.to === 5)).toBe(true);
	});
});

describe('completions', () => {
	const labels = (before: string, explicit = false) =>
		completionsFor(before, explicit)?.options.map((o) => o.label) ?? [];

	it('offers commands at the start of a line', () => {
		expect(labels('RE')).toContain('REM');
		expect(labels('', true)).toContain('OMIT');
	});

	it('offers keywords, weekdays and months inside a REM', () => {
		const l = labels('REM Mon DUR');
		expect(l).toContain('DURATION');
		expect(l).toContain('Wednesday');
		expect(l).toContain('September');
		expect(completionsFor('REM Mon DUR')!.from).toBe(8);
	});

	it('offers % sequences, with the offset after the %', () => {
		const set = completionsFor('REM Mon MSG Hi %')!;
		expect(set.options.map((o) => o.label)).toContain('b');
		expect(set.from).toBe('REM Mon MSG Hi %'.length);
		expect(completionsFor('MSG %*')!.from).toBe(6);
	});

	it('offers INFO headers inside the quote', () => {
		const set = completionsFor('REM Mon INFO "Loc')!;
		expect(set.options.map((o) => o.displayLabel)).toContain('Location');
		expect(set.from).toBe('REM Mon INFO "'.length);
	});

	it('stays quiet in message text and on other commands', () => {
		expect(completionsFor('REM Mon MSG Hello wor')).toBeNull();
		expect(completionsFor('DO hol')).toBeNull();
		expect(completionsFor('REM Mon ')).toBeNull();
	});
});
