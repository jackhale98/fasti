<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts" module>
	/** A problem to mark in the editor: 1-based line and message. */
	export interface Problem {
		line: number;
		message: string;
		warning: boolean;
	}
</script>

<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Annotation, EditorState, Transaction } from '@codemirror/state';
	import {
		EditorView,
		drawSelection,
		highlightActiveLine,
		keymap,
		lineNumbers
	} from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { completionKeymap } from '@codemirror/autocomplete';
	import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
	import { remind } from '#lib/lens/codemirror.ts';
	import { debounce } from '#lib/engine/client.ts';
	import { app } from '#lib/app/app.svelte.ts';
	import type { VaultPath } from '#lib/engine/types.ts';
	import { diffEdit, separatorFor } from './edit.ts';

	/**
	 * The CodeMirror editor for one file. The document is the stored text with
	 * the file's own line ending, so saving is a byte-exact edit (see edit.ts).
	 *
	 * Saving: typing is gathered for SAVE_DELAY ms (and flushed on blur, file
	 * switch, page hide and destroy), then stored as ONE vault.applyEdit, so a
	 * pause in typing is one undo step. The CodeMirror history (Ctrl-Z) stays
	 * live inside a file; each undo is just another saved edit. Changes that
	 * come from elsewhere (the toast's Undo, a sync) replace the document
	 * without entering the CodeMirror history.
	 */
	let {
		path,
		problems = [],
		oncaret,
		label
	}: {
		path: VaultPath;
		problems?: Problem[];
		/** Called with the 1-based line under the cursor. */
		oncaret?: (line: number) => void;
		label: string;
	} = $props();

	const SAVE_DELAY = 600;

	let host: HTMLDivElement;
	let view: EditorView | undefined;
	/** The file the view's document belongs to. */
	let docPath: VaultPath | null = null;
	let dirty = false;
	let saving = 0;
	let chain: Promise<void> = Promise.resolve();
	/** True when the file mixes line endings: shown, not editable. */
	let mixed = $state(false);

	const theme = EditorView.theme({
		'&': { backgroundColor: 'var(--surface)', color: 'var(--ink)', fontSize: 'var(--ed-size)' },
		'&.cm-focused': { outline: '2px solid var(--ledger)', outlineOffset: '-2px' },
		'.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
		'.cm-content': { caretColor: 'var(--ink)', padding: '12px 0 14px' },
		'.cm-line': { padding: '0 12px 0 6px' },
		'.cm-gutters': {
			backgroundColor: 'var(--surface)',
			color: 'var(--ink-3)',
			border: 'none',
			fontSize: '0.78em'
		},
		'.cm-activeLine': {
			backgroundColor: 'color-mix(in srgb, var(--ledger-soft) 70%, transparent)'
		},
		// --ink-3 on the active line's tint is under 4.5:1 in dark mode (WCAG AA).
		'.cm-activeLine .sx-com': { color: 'var(--ink-2)' },
		'.cm-activeLineGutter': {
			backgroundColor: 'color-mix(in srgb, var(--ledger-soft) 70%, transparent)',
			color: 'var(--ink-2)'
		},
		'.cm-cursor': { borderLeftColor: 'var(--ink)' },
		'.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
			{ background: 'color-mix(in srgb, var(--ledger) 28%, transparent)' },
		'.cm-tooltip': {
			backgroundColor: 'var(--surface)',
			color: 'var(--ink)',
			border: '1px solid var(--rule)',
			borderRadius: '8px',
			boxShadow: 'var(--shadow)'
		},
		'.cm-tooltip-autocomplete ul li[aria-selected]': {
			backgroundColor: 'var(--ledger)',
			color: 'var(--ledger-ink)'
		},
		'.cm-completionDetail': { color: 'inherit', opacity: '0.8' },
		'.cm-diagnostic': { padding: '4px 8px', fontFamily: 'var(--font-ui)' },
		'.cm-diagnostic-error': { borderLeft: '4px solid var(--danger)' },
		'.cm-diagnostic-warning': { borderLeft: '4px solid var(--sx-num)' },
		'.cm-lintRange-error': {
			backgroundImage: 'none',
			textDecoration: 'wavy underline var(--danger)',
			textUnderlineOffset: '3px'
		},
		'.cm-lintRange-warning': {
			backgroundImage: 'none',
			textDecoration: 'wavy underline var(--sx-num)',
			textUnderlineOffset: '3px'
		},
		'.cm-lint-marker-error': { content: '"●"', color: 'var(--danger)' },
		'.cm-gutter-lint': { width: '1em' }
	});

	/** The stored file's line ending: CodeMirror's document always uses \n. */
	let sep: '\n' | '\r\n' | null = '\n';
	const toDoc = (text: string) => (sep === '\r\n' ? text.replaceAll('\r\n', '\n') : text);
	/** The stored form of the document: its \n become the file's own line ending again. */
	const toStored = (doc: string) => (sep === '\r\n' ? doc.replaceAll('\n', '\r\n') : doc);

	function makeState(file: VaultPath, text: string): EditorState {
		sep = separatorFor(text);
		mixed = sep === null;
		return EditorState.create({
			doc: toDoc(text),
			extensions: [
				EditorState.readOnly.of(sep === null),
				lineNumbers(),
				lintGutter(),
				highlightActiveLine(),
				drawSelection(),
				history(),
				keymap.of([...completionKeymap, ...lintKeymap, ...historyKeymap, ...defaultKeymap]),
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({
					'aria-label': label,
					spellcheck: 'false',
					autocapitalize: 'off',
					autocorrect: 'off',
					autocomplete: 'off'
				}),
				remind(),
				theme,
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !u.transactions.every((t) => t.annotation(external) === true)) {
						dirty = true;
						scheduleSave();
					}
					if (u.selectionSet || u.docChanged || u.startState.doc.length === 0) {
						oncaret?.(u.state.doc.lineAt(u.state.selection.main.head).number);
					}
				})
			]
		});
	}
	/** Marks changes that came from the vault, not from typing. */
	const external = Annotation.define<boolean>();

	const scheduleSave = debounce(() => void flush(), SAVE_DELAY);

	/** Stores pending typing now. Resolves when the vault has it. */
	export function flush(): Promise<void> {
		scheduleSave.cancel();
		if (!dirty || !view || !docPath || !app.vault) return chain;
		const file = docPath;
		const text = toStored(view.state.doc.toString());
		dirty = false;
		saving++;
		chain = chain
			.then(async () => {
				const stored = app.text(file);
				if (stored === null) return;
				const edit = diffEdit(stored, text);
				if (!edit) return;
				await app.vault?.applyEdit(file, edit, `Edited ${file}`);
				await app.refresh();
			})
			.catch((e) => console.error('Saving the edit failed', e))
			.finally(() => {
				saving--;
			});
		return chain;
	}

	/** Moves the cursor to the start of a 1-based line and focuses the editor. */
	export function jump(line: number) {
		if (!view) return;
		const n = Math.min(Math.max(1, line), view.state.doc.lines);
		const at = view.state.doc.line(n).from;
		view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
		view.focus();
	}

	/** Inserts a token at the cursor, with a space before and after where needed. */
	export function insert(token: string) {
		if (!view || mixed) return;
		const { from, to } = view.state.selection.main;
		const doc = view.state.doc;
		const before = from > 0 ? doc.sliceString(from - 1, from) : '';
		const after = to < doc.length ? doc.sliceString(to, to + 1) : '';
		const lead = before && !/\s/.test(before) ? ' ' : '';
		const text = lead + token + (after && /\s/.test(after) ? '' : ' ');
		view.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + text.length },
			scrollIntoView: true,
			userEvent: 'input'
		});
		view.focus();
	}

	onMount(() => {
		view = new EditorView({ parent: host });
		const hide = () => void flush();
		window.addEventListener('pagehide', hide);
		return () => window.removeEventListener('pagehide', hide);
	});

	onDestroy(() => {
		void flush();
		view?.destroy();
	});

	// Open the file (and, after a switch, give the new one its own state and history).
	$effect(() => {
		const file = path;
		void app.ready;
		const stored = untrack(() => app.text(file));
		if (!view || stored === null || docPath === file) return;
		void flush();
		view.setState(makeState(file, stored));
		docPath = file;
		dirty = false;
		oncaret?.(1);
	});

	// A change from elsewhere (the toast's Undo, a sync): show it, keep the cursor near.
	$effect(() => {
		void app.version;
		const stored = app.text(path);
		untrack(() => {
			if (!view || stored === null || docPath !== path || dirty || saving > 0) return;
			if (sep === null || separatorFor(stored) !== sep) {
				view.setState(makeState(path, stored));
				return;
			}
			const edit = diffEdit(view.state.doc.toString(), toDoc(stored));
			if (!edit) return;
			view.dispatch({
				changes: edit,
				annotations: [external.of(true), Transaction.addToHistory.of(false)]
			});
		});
	});

	// Mark the engine's problems in the document.
	$effect(() => {
		const list = problems;
		void path;
		untrack(() => {
			if (!view || docPath !== path || dirty) return;
			const doc = view.state.doc;
			view.dispatch(
				setDiagnostics(
					view.state,
					list
						.filter((p) => p.line >= 1 && p.line <= doc.lines)
						.map((p) => {
							const line = doc.line(p.line);
							return {
								from: line.from,
								to: Math.max(line.to, line.from),
								severity: p.warning ? ('warning' as const) : ('error' as const),
								message: p.message
							};
						})
				)
			);
		});
	});
</script>

<div class="editor" bind:this={host}></div>
{#if mixed}
	<p class="note" role="status">
		This file mixes LF and CRLF line endings. It is shown but not editable here, so no line ending
		changes by accident.
	</p>
{/if}

<style>
	.editor {
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 12px;
		overflow: hidden;
		min-height: 320px;
	}
	.editor :global(.cm-editor) {
		min-height: 320px;
	}
	.note {
		margin: 8px 2px 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	:global(.sx-cmd) {
		color: var(--ink);
	}
	:global(.sx-kw) {
		color: var(--sx-kw);
	}
	:global(.sx-date),
	:global(.sx-wday) {
		color: var(--sx-date);
	}
	:global(.sx-num) {
		color: var(--sx-num);
	}
	:global(.sx-time) {
		color: var(--sx-time);
	}
	:global(.sx-str) {
		color: var(--sx-str);
	}
	:global(.sx-name) {
		color: var(--ink-2);
	}
	:global(.sx-expr) {
		color: var(--sx-expr);
	}
	:global(.sx-pct) {
		color: var(--sx-kw);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--sx-kw) 45%, transparent);
		text-underline-offset: 3px;
	}
	:global(.sx-com) {
		color: var(--ink-3);
	}
	:global(.sx-err) {
		text-decoration: wavy underline var(--danger);
		text-decoration-skip-ink: none;
		text-underline-offset: 3px;
	}
</style>
