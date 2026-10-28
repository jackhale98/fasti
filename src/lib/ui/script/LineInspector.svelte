<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { app } from '#lib/app/app.svelte.ts';
	import { debounce, nextDates } from '#lib/engine/client.ts';
	import type { NextDatesResult, VaultPath } from '#lib/engine/types.ts';
	import { longDate, time } from '#lib/app/format.ts';
	import { explainLine, lineLabel } from '#lib/lens/explain.ts';
	import { analyze, lineAt } from '#lib/lens/tokenize.ts';

	/** Explains the line under the cursor and shows its next dates, from the engine. */
	let { path, line }: { path: VaultPath; line: number } = $props();

	const logical = $derived.by(() => {
		void app.version;
		const text = app.text(path);
		return text === null ? undefined : lineAt(analyze(text), line - 1);
	});
	const sentences = $derived(logical ? explainLine(logical) : []);
	/** Whether the line is one Remind can give dates for. */
	const hasDates = $derived(
		!!logical &&
			(logical.kind === 'rem' ||
				logical.kind === 'engine' ||
				(logical.kind === 'omit' && !!logical.rem))
	);

	let result = $state<NextDatesResult | null>(null);
	let status = $state<'idle' | 'computing' | 'done' | 'failed'>('idle');
	let ticket = 0;
	/** Each inspector asks under its own name, so two on one page don't supersede each other. */
	const id = Math.random().toString(36).slice(2);

	const ask = debounce((file: VaultPath, physical: number) => {
		const mine = ++ticket;
		const snapshot = $state.snapshot(app.snapshot);
		if (!snapshot) return;
		nextDates(
			snapshot,
			{ file, line: physical, count: 6, tz: app.tz },
			{ view: `script-line-${id}` }
		)
			.then((r) => {
				if (mine !== ticket) return;
				result = r;
				status = 'done';
			})
			.catch(() => {
				if (mine !== ticket) return;
				status = 'failed';
			});
	}, 150);

	$effect(() => {
		void app.version;
		const file = path;
		// Any physical line of the reminder works; use the logical line's first.
		const physical = logical ? logical.start + 1 : line;
		const wanted = hasDates;
		untrack(() => {
			ticket++;
			ask.cancel();
			result = null;
			if (!wanted) {
				status = 'idle';
				return;
			}
			status = 'computing';
			ask(file, physical);
		});
	});
	$effect(() => () => ask.cancel());
</script>

<section class="insp" aria-label="Line inspector">
	<p class="eyebrow">{logical ? lineLabel(logical) : `Line ${line}`} · {path}</p>
	{#if sentences.length}
		<ul class="explain">
			{#each sentences as s, i (i)}<li>{s}</li>{/each}
		</ul>
	{:else}
		<p class="hint">Put the cursor on a line to see how Remind reads it.</p>
	{/if}
	{#if hasDates}
		<div class="dates" aria-live="polite" aria-busy={status === 'computing'}>
			<h3 class="eyebrow">Next dates</h3>
			{#if status === 'computing'}
				<p class="hint">computing…</p>
			{:else if status === 'failed'}
				<p class="hint">Remind did not answer. The dates will appear when it does.</p>
			{:else if status === 'done' && result}
				{#if !result.reached}
					<p class="hint">Remind never reaches this line, so it has no dates.</p>
				{:else if result.dates.length === 0}
					<p class="hint">None coming up.</p>
				{:else}
					<ul class="nextdates">
						{#each result.dates as d, i (i)}
							<li class:first={i === 0}>
								<time datetime={d.date}>{longDate(d.date)}</time>{#if d.time !== null}
									<span class="at"> {time(d.time, app.settings.clock, true)}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#each result.diagnostics as dg, i (i)}
					<p class="problem-note">{dg.message}</p>
				{/each}
			{/if}
		</div>
	{/if}
</section>

<style>
	.insp {
		display: grid;
		gap: 10px;
	}
	.eyebrow {
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		font-weight: 700;
		margin: 0;
	}
	h3.eyebrow {
		margin-bottom: 6px;
	}
	.hint {
		color: var(--ink-2);
		margin: 0;
	}
	.explain {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 6px;
	}
	.explain li {
		padding-left: 16px;
		position: relative;
		color: var(--ink);
	}
	.explain li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.62em;
		width: 6px;
		height: 6px;
		border-radius: 2px;
		background: var(--ledger);
	}
	.nextdates {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.nextdates li {
		font-size: 13px;
		border-radius: 999px;
		padding: 4px 10px;
		background: var(--sunk);
		color: var(--ink-2);
	}
	.nextdates li.first {
		background: var(--mark);
		color: var(--mark-ink);
		font-weight: 600;
	}
	.problem-note {
		margin: 6px 0 0;
		font-size: 13px;
		color: var(--danger);
	}
</style>
