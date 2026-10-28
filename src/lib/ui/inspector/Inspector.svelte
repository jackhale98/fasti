<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * The Inspector (docs/PLAN.md section 4): everything about one reminder.
	 * Dates, titles and previews all come from the engine; the explanation is
	 * the lens's reading of the line. No date is computed here.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { app } from '#lib/app/app.svelte.ts';
	import { duration, longDate, dayMonth, time } from '#lib/app/format.ts';
	import { agenda, debounce, nextDates, preview } from '#lib/engine/client.ts';
	import type {
		Diagnostic,
		NextDatesResult,
		Occurrence,
		ReminderEntry
	} from '#lib/engine/types.ts';
	import { explainLine, lineLabel } from '#lib/lens/explain.ts';
	import { analyze, lineAt } from '#lib/lens/tokenize.ts';
	import { shell, type Selection } from '../shell.svelte.ts';

	let { selection }: { selection: Selection } = $props();

	const uid = $props.id();
	const clock = $derived(app.settings.clock);

	// --- The source and what the lens makes of it.
	const fileText = $derived(app.text(selection.file));
	const physical = $derived(fileText === null ? [] : fileText.split(/\r\n|\n/));
	const source = $derived(physical.slice(selection.line - 1, selection.lineEnd).join('\n'));
	const logical = $derived.by(() => {
		if (fileText === null) return undefined;
		return lineAt(analyze(fileText), selection.line - 1);
	});
	const explanation = $derived(logical ? explainLine(logical) : []);
	const label = $derived(logical ? lineLabel(logical) : `Line ${selection.line}`);

	// --- The occurrence from the engine.
	let entry = $state<ReminderEntry | null>(null);
	let entryDone = $state(false);
	let next = $state<NextDatesResult | null>(null);
	let loadError = $state<string | null>(null);

	$effect(() => {
		const { file, line, date } = selection;
		const snapshot = app.snapshot;
		const tz = app.tz;
		void app.version;
		if (!snapshot) return;
		let live = true;
		entryDone = false;
		next = null;
		loadError = null;
		const findIn = (entries: ReminderEntry[]) =>
			entries.find((e) => e.file === file && e.line <= line && line <= e.lineEnd) ?? null;
		(async () => {
			try {
				const dates = await nextDates(snapshot, { file, line, count: 6, tz });
				if (!live) return;
				next = dates;
				// Today's agenda first, so % substitutions read as Remind prints them
				// today ("8 days ago", not "today"); a later occurrence that today's
				// agenda doesn't list falls back to the agenda of its own date.
				let found = findIn((await agenda(snapshot, { tz })).entries);
				const day = date ?? dates.dates[0]?.date;
				if (!found && day) found = findIn((await agenda(snapshot, { date: day, tz })).entries);
				if (live) entry = found;
			} catch (e) {
				if (live) loadError = e instanceof Error ? e.message : String(e);
			} finally {
				if (live) entryDone = true;
			}
		})();
		return () => {
			live = false;
		};
	});

	const title = $derived(
		entry?.body ||
			(logical?.rem?.body ?? '').replace(/%./g, '').replace(/\s+/g, ' ').trim() ||
			'(no message)'
	);
	const isTodo = $derived(entry?.isTodo ?? logical?.rem?.todo ?? false);
	const kindLabel = $derived(isTodo ? 'Task' : logical?.kind === 'omit' ? 'Holiday' : 'Reminder');
	// A string comparison of two dates Remind printed; no arithmetic.
	const overdue = $derived(
		!!entry && isTodo && !entry.completed && !!app.today && entry.date < app.today.date
	);
	const info = $derived(Object.entries(entry?.info ?? {}));
	const hasChips = $derived(
		!!entry &&
			(entry.time !== null ||
				!!entry.duration ||
				info.length > 0 ||
				entry.tags.length > 0 ||
				overdue)
	);

	// --- Actions.
	let busy = $state(false);

	async function markDone() {
		if (!entry) return;
		busy = true;
		await app.markDone(selection.file, selection.line, entry.date);
		busy = false;
	}

	async function remove() {
		busy = true;
		const ok = await app.remove(selection.file, selection.line, selection.lineEnd);
		busy = false;
		if (ok) shell.select(null);
	}

	function showInScript() {
		const query = new URLSearchParams({ file: selection.file, line: String(selection.line) });
		shell.select(null);
		const href = `${resolve('/script')}?${query}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- href is resolve() plus a query string
		void goto(href);
	}

	// --- The editable line with a live preview.
	let draft = $state<string | null>(null);
	const text = $derived(draft ?? source);
	const changed = $derived(text !== source);
	let result = $state<NextDatesResult | null>(null);
	let previewError = $state<string | null>(null);
	let previewing = $state(false);
	let seq = 0;

	const run = debounce(async (newText: string) => {
		const snapshot = app.snapshot;
		if (!snapshot) return;
		const mine = ++seq;
		try {
			const r = await preview(snapshot, {
				file: selection.file,
				line: selection.line,
				newText,
				count: 4,
				tz: app.tz
			});
			if (mine !== seq) return;
			result = r;
			previewError = null;
		} catch (e) {
			if (mine !== seq) return;
			result = null;
			previewError = e instanceof Error ? e.message : String(e);
		} finally {
			if (mine === seq) previewing = false;
		}
	}, 120);

	function onInput(event: Event) {
		draft = (event.currentTarget as HTMLTextAreaElement).value;
		seq++;
		if (draft === source) {
			run.cancel();
			previewing = false;
			result = null;
			previewError = null;
			return;
		}
		previewing = true;
		run(draft);
	}

	$effect(() => () => run.cancel());

	const problems = $derived((result?.diagnostics ?? []).filter((d: Diagnostic) => !d.warning));
	const warnings = $derived((result?.diagnostics ?? []).filter((d: Diagnostic) => d.warning));
	const accepted = $derived(
		changed &&
			!previewing &&
			text.trim() !== '' &&
			!previewError &&
			result !== null &&
			problems.length === 0
	);

	async function save() {
		if (!accepted) return;
		busy = true;
		const ok = await app.replace(selection.file, selection.line, selection.lineEnd, text);
		busy = false;
		if (ok) shell.select(null);
	}

	const thisYear = $derived(app.today?.date.slice(0, 4));
	const dateText = (o: Occurrence) =>
		(o.date.slice(0, 4) !== thisYear ? longDate(o.date).replace(/^\w+ /, '') : dayMonth(o.date)) +
		(o.time !== null ? ' ' + time(o.time, clock, true) : '');
</script>

<div class="detail">
	<header>
		<p class="eyebrow">{kindLabel} · {selection.file} · {label}</p>
		<h2 class="title">{title}</h2>
		{#if entry}
			<p class="due">{isTodo ? 'Due' : 'Next'} {longDate(entry.date)}</p>
		{:else if entryDone && next && next.dates.length === 0 && !loadError}
			<p class="due">{isTodo ? 'Nothing due.' : 'No upcoming dates.'}</p>
		{/if}
	</header>

	{#if loadError}
		<p class="err" role="alert">{loadError}</p>
	{/if}

	{#if hasChips && entry}
		<ul class="chips" aria-label="Details">
			{#if overdue}<li class="chip warn">overdue</li>{/if}
			{#if entry.time !== null}
				<li class="chip">
					{time(entry.time, clock, true)}{entry.duration ? ' · ' + duration(entry.duration) : ''}
				</li>
			{:else if entry.duration}
				<li class="chip">{duration(entry.duration)}</li>
			{/if}
			{#each info as [key, value] (key)}<li class="chip">{key}: {value}</li>{/each}
			{#each entry.tags as tag (tag)}<li class="chip mono">TAG {tag}</li>{/each}
		</ul>
	{/if}

	{#if isTodo && entry && !entry.completed}
		<div class="btns">
			<button type="button" class="btn primary" disabled={busy} onclick={markDone}>
				Mark done through {dayMonth(entry.date)}
			</button>
		</div>
	{/if}

	<section aria-labelledby="{uid}-how">
		<h3 id="{uid}-how">How Remind reads it</h3>
		<ul class="explain">
			{#each explanation as sentence (sentence)}<li>{sentence}</li>{/each}
		</ul>
	</section>

	<section aria-labelledby="{uid}-next">
		<h3 id="{uid}-next">{isTodo ? 'Due dates' : 'Next dates'}</h3>
		{#if next === null && !loadError}
			<p class="note">computing…</p>
		{:else if next && next.dates.length > 0}
			<ul class="nextdates">
				{#each next.dates as occurrence, i (occurrence.date + ':' + occurrence.time)}
					<li class:first={i === 0}>
						<time datetime={occurrence.date}>{dateText(occurrence)}</time>
					</li>
				{/each}
			</ul>
		{:else if next}
			<p class="note">{next.reached ? 'None.' : 'Remind never reaches this line.'}</p>
		{/if}
	</section>

	<section aria-labelledby="{uid}-src">
		<h3 id="{uid}-src">Source · {selection.file} {label.toLowerCase()}</h3>
		<label class="vh" for="{uid}-edit">Edit this line</label>
		<textarea
			id="{uid}-edit"
			class="lineedit"
			spellcheck="false"
			autocapitalize="off"
			aria-describedby="{uid}-prev"
			value={text}
			oninput={onInput}></textarea>
		<div id="{uid}-prev" class="prev" role="status" aria-live="polite">
			{#if !changed}
				<p class="ok">Edit the line to see the new dates before you save.</p>
			{:else if previewing || (result === null && !previewError)}
				<p class="ok">Checking with Remind…</p>
			{:else if previewError}
				<p class="bad">{previewError}</p>
			{:else if text.trim() === ''}
				<p class="bad">The line is empty. Use Delete to remove it.</p>
			{:else}
				{#each problems as problem (problem.message)}
					<p class="bad">{problem.message}</p>
				{/each}
				{#each warnings as warning (warning.message)}
					<p class="ok">{warning.message}</p>
				{/each}
				{#if problems.length === 0 && result}
					<p class="ok">
						{#if result.dates.length > 0}
							Next: {result.dates.map(dateText).join(', ')}.
						{:else if !result.reached}
							Remind never reaches this line.
						{:else}
							Remind accepts this line; it has no upcoming dates.
						{/if}
					</p>
				{/if}
			{/if}
		</div>
	</section>

	<div class="btns">
		<button type="button" class="btn primary" disabled={!accepted || busy} onclick={save}>
			Save line
		</button>
		<button type="button" class="btn" onclick={showInScript}>Show in script</button>
		<button type="button" class="btn danger" disabled={busy} onclick={remove}>Delete</button>
		<button type="button" class="btn" onclick={() => shell.select(null)}>Close</button>
	</div>
</div>

<style>
	.detail {
		display: grid;
		gap: 18px;
		min-width: 0;
	}
	.eyebrow {
		margin: 0;
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.title {
		font-size: 22px;
		font-weight: 600;
		line-height: 1.25;
		margin: 4px 0 0;
		overflow-wrap: anywhere;
		text-wrap: balance;
	}
	.due {
		color: var(--ink-2);
		margin: 6px 0 0;
	}
	h3 {
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		font-weight: 700;
		margin: 0 0 8px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		font-size: 12.5px;
		border-radius: 999px;
		padding: 4px 10px;
		background: var(--sunk);
		color: var(--ink-2);
		overflow-wrap: anywhere;
	}
	.chip.warn {
		background: var(--danger-soft);
		color: var(--danger);
		font-weight: 600;
	}
	.chip.mono {
		font-family: var(--font-mono);
	}
	.explain {
		display: grid;
		gap: 4px;
	}
	.explain li {
		color: var(--ink-2);
		overflow-wrap: anywhere;
	}
	.nextdates {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		gap: 6px;
	}
	.nextdates li {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: 8px;
		padding: 6px 9px;
	}
	.nextdates li.first {
		border-color: var(--ledger);
		color: var(--ledger);
		font-weight: 600;
	}
	.note {
		margin: 0;
		color: var(--ink-3);
		font-size: 13.5px;
	}
	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.lineedit {
		box-sizing: border-box;
		width: 100%;
		min-height: 84px;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink);
		padding: 10px 12px;
		font-family: var(--font-mono);
		font-size: 16px;
		line-height: 1.55;
		resize: vertical;
	}
	@media (min-width: 720px) {
		.lineedit {
			font-size: 13.5px;
		}
	}
	.prev p {
		margin: 6px 0 0;
		font-size: 13.5px;
		overflow-wrap: anywhere;
	}
	.ok {
		color: var(--ink-2);
	}
	.bad,
	.err {
		color: var(--danger);
	}
	.err {
		margin: 0;
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.btn {
		min-height: 44px;
		padding: 0 16px;
		border-radius: 10px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--ledger);
		color: var(--ledger-ink);
		border-color: var(--ledger);
	}
	.btn.danger {
		color: var(--danger);
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	:is(.btn, .lineedit):focus-visible {
		outline: 2px solid var(--ledger);
		outline-offset: 2px;
	}
</style>
