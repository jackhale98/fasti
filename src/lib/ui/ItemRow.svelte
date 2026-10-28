<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * One reminder occurrence in a list (Today, Month's selected day): when,
	 * what, where it comes from, and a done circle for TODOs. Everything shown
	 * comes from the engine's entry; `when` is the view's own label.
	 */
	import type { ReminderEntry } from '#lib/engine/types.ts';
	import { app } from '#lib/app/app.svelte.ts';
	import { duration, time } from '#lib/app/format.ts';
	import Icon from './Icon.svelte';
	import { shell } from './shell.svelte.ts';

	let {
		entry,
		when,
		whenSub,
		late = false
	}: {
		entry: ReminderEntry;
		/** Overrides the time column (e.g. "2 days" for overdue, "Thu 5" for heads-up). */
		when?: string;
		whenSub?: string;
		late?: boolean;
	} = $props();

	const clock = $derived(app.settings.clock);
	const selected = $derived(
		shell.selected?.file === entry.file &&
			shell.selected.line === entry.line &&
			(shell.selected.date === null || shell.selected.date === entry.date)
	);
	const location = $derived(entry.info['location']);
	let done = $state(false);

	function open() {
		shell.select({ file: entry.file, line: entry.line, lineEnd: entry.lineEnd, date: entry.date });
	}

	async function markDone() {
		done = true;
		await app.markDone(entry.file, entry.line, entry.date);
		done = false;
	}
</script>

<li class="item" class:sel={selected}>
	<button type="button" class="main" onclick={open} aria-current={selected ? 'true' : undefined}>
		<span class="when" class:late>
			{#if when}
				{when}{#if whenSub}<small>{whenSub}</small>{/if}
			{:else if entry.time !== null}
				{time(entry.time, clock, true)}{#if entry.duration}<small>{duration(entry.duration)}</small
					>{/if}
			{:else}
				<span class="allday">All day</span>
			{/if}
		</span>
		<span class="what">
			<span class="msg" class:struck={entry.completed}>{entry.body || '(no message)'}</span>
			<span class="meta">
				<span class="src">{entry.file.replace(/\.rem$/, '')}:{entry.line}</span>
				{#if location}<span>{location}</span>{/if}
				{#each entry.tags as tag (tag)}<span>#{tag}</span>{/each}
			</span>
		</span>
	</button>
	{#if entry.isTodo && !entry.completed}
		<button
			type="button"
			class="check"
			class:done
			aria-label="Mark {entry.body || 'this task'} done through {entry.date}"
			onclick={markDone}
		>
			<span><Icon name="check" size={13} stroke={3} /></span>
		</button>
	{/if}
</li>

<style>
	.item {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--rule);
		list-style: none;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		gap: 12px;
		align-items: start;
		text-align: left;
		border: 0;
		background: none;
		padding: 12px 4px;
		border-radius: 8px;
		cursor: pointer;
	}
	.main:hover {
		background: color-mix(in srgb, var(--sunk) 60%, transparent);
	}
	.sel .main {
		background: var(--ledger-soft);
	}
	.when {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		font-size: 14px;
		line-height: 1.35;
		padding-top: 1px;
	}
	.when small {
		display: block;
		font-weight: 500;
		color: var(--ink-3);
		font-size: 12px;
	}
	.when.late {
		color: var(--danger);
	}
	.allday {
		color: var(--ink-3);
	}
	.what {
		min-width: 0;
	}
	.msg {
		display: block;
		font-size: 16px;
		font-weight: 500;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}
	.msg.struck {
		text-decoration: line-through;
		color: var(--ink-3);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin-top: 3px;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.src {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.check {
		flex: none;
		width: 52px;
		border: 0;
		background: none;
		display: grid;
		place-items: center;
		cursor: pointer;
		color: var(--ledger-ink);
	}
	.check span {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 2px solid var(--ink-3);
		display: grid;
		place-items: center;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.check :global(svg) {
		opacity: 0;
	}
	.check:hover span {
		border-color: var(--ledger);
	}
	.check.done span {
		background: var(--ledger);
		border-color: var(--ledger);
	}
	.check.done :global(svg) {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.check span {
			transition: none;
		}
	}
</style>
