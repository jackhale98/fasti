<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * The 6-week grid: roving tabindex, arrow keys move the selected day.
	 * Phones show a dot per entry, wide screens up to three labels.
	 */
	import { tick } from 'svelte';
	import type { ReminderEntry } from '#lib/engine/types.ts';
	import { dayOf, monthName, weekday } from '#lib/app/format.ts';
	import { GRID_SIZE, kindOf, type Slot } from './model.ts';

	let {
		slots,
		names,
		today,
		selected,
		isHoliday,
		onselect
	}: {
		slots: Slot[];
		/** Weekday names in column order. */
		names: string[];
		today: string | null;
		selected: string | null;
		isHoliday: (entry: ReminderEntry) => boolean;
		onselect: (date: string) => void;
	} = $props();

	let grid = $state<HTMLElement>();

	const rows = $derived(
		Array.from({ length: GRID_SIZE / 7 }, (_, r) => slots.slice(r * 7, r * 7 + 7))
	);
	/** The one cell in the tab order: the selected day, else the first loaded one. */
	const tabStop = $derived(
		slots.some((s) => s?.date === selected)
			? selected
			: (slots.find((s) => s?.inMonth)?.date ?? null)
	);

	function label(slot: NonNullable<Slot>): string {
		const n = slot.day.entries.length;
		let text = `${weekday(slot.date)} ${dayOf(slot.date)} ${monthName(slot.date)}, ${n} reminder${n === 1 ? '' : 's'}`;
		if (slot.day.omit === 'dated' || slot.day.entries.some((e) => isHoliday(e)))
			text += ', holiday';
		if (slot.day.omit === 'weekly') text += ', day off';
		if (slot.date === today) text += ', today';
		return text;
	}

	async function move(date: string) {
		onselect(date);
		await tick();
		grid?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const date = (event.target as HTMLElement).dataset.date;
		const current = slots.findIndex((s) => s?.date === date);
		if (current < 0) return;
		const row = Math.floor(current / 7);
		const step: Record<string, number> = {
			ArrowLeft: current - 1,
			ArrowRight: current + 1,
			ArrowUp: current - 7,
			ArrowDown: current + 7,
			Home: row * 7,
			End: row * 7 + 6
		};
		const to = step[event.key];
		if (to === undefined) return;
		event.preventDefault();
		const target = slots[to];
		if (target) void move(target.date);
	}
</script>

<!-- Arrow keys are handled on the grid; each cell is a real button. -->
<div class="grid" role="grid" aria-label="Month" tabindex="-1" bind:this={grid} {onkeydown}>
	<div class="row" role="row">
		{#each names as name (name)}
			<div class="wh" role="columnheader" aria-label={name}>{name.slice(0, 3)}</div>
		{/each}
	</div>
	{#each rows as row, r (r)}
		<div class="row" role="row">
			{#each row as slot, c (slot?.date ?? `${r}-${c}`)}
				{#if slot}
					{@const kinds = slot.day.entries.map((e) => kindOf(e, isHoliday))}
					{@const omitted = slot.day.omit}
					<div role="gridcell" class="gc" aria-selected={slot.date === selected}>
						<button
							type="button"
							class="cell"
							class:out={!slot.inMonth}
							class:today={slot.date === today}
							class:sel={slot.date === selected}
							class:offwd={omitted === 'weekly'}
							class:offdate={omitted === 'dated'}
							data-date={slot.date}
							data-testid="day-cell"
							data-off={omitted ?? undefined}
							tabindex={slot.date === tabStop ? 0 : -1}
							aria-current={slot.date === today ? 'date' : undefined}
							aria-label={label(slot)}
							onclick={() => onselect(slot.date)}
						>
							<span class="dn" aria-hidden="true">{slot.day.day}</span>
						</button>
						<!-- Outside the button so its visible text is just the day number, which its name contains. -->
						<div class="extras" aria-hidden="true">
							{#if omitted}<span class="nef" aria-hidden="true">N</span>{/if}
							<span class="dots" aria-hidden="true">
								{#each kinds.slice(0, 4) as kind, i (i)}<i class={kind}></i>{/each}
							</span>
							<span class="lbls" aria-hidden="true">
								{#each slot.day.entries.slice(0, 3) as entry, i (i)}
									<span class={kinds[i]}>{entry.body || '(no message)'}</span>
								{/each}
								{#if slot.day.entries.length > 3}
									<em>+{slot.day.entries.length - 3} more</em>
								{/if}
							</span>
						</div>
					</div>
				{:else}
					<!-- Still loading: an accessible cell, so a row of them still has gridcells. -->
					<div role="gridcell" class="pending"><span class="vh">Loading</span></div>
				{/if}
			{/each}
		</div>
	{/each}
</div>

<style>
	.grid {
		border-top: 1px solid var(--rule);
		border-left: 1px solid var(--rule);
		background: var(--surface);
		border-radius: 12px;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px var(--rule);
	}
	.row {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.row > :global(*) {
		min-width: 0;
		border-right: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
	}
	.wh {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		padding: 8px 2px;
		text-align: center;
	}
	.gc,
	.pending {
		position: relative;
		min-height: 58px;
	}
	.extras {
		position: absolute;
		inset: 0;
		padding: 38px 2px 0;
		pointer-events: none;
	}
	.cell {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		color: var(--ink);
		padding: 6px 2px;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: stretch;
		min-width: 0;
		cursor: pointer;
		font: inherit;
	}
	.cell:focus-visible {
		outline: 2px solid var(--ledger);
		outline-offset: -4px;
	}
	.offwd {
		background: color-mix(in srgb, var(--sunk) 55%, transparent);
	}
	.offdate {
		background-image: repeating-linear-gradient(135deg, var(--hatch) 0 2px, transparent 2px 7px);
	}
	.dn {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		font-size: 13.5px;
		align-self: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: grid;
		place-items: center;
	}
	.out .dn {
		color: var(--ink-3);
		font-weight: 500;
	}
	.today .dn {
		background: var(--mark);
		color: var(--mark-ink);
	}
	.sel {
		box-shadow: inset 0 0 0 2px var(--ledger);
	}
	.nef {
		display: none;
	}
	.dots {
		display: flex;
		justify-content: center;
		gap: 3px;
		flex-wrap: wrap;
	}
	.dots i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ledger);
	}
	.dots i.todo {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--danger);
	}
	.dots i.holiday {
		background: var(--ink-3);
	}
	.dots i.done {
		background: var(--ink-3);
		opacity: 0.45;
	}
	.lbls {
		display: none;
	}
	@media (min-width: 720px) {
		.cell {
			padding: 6px;
		}
		.extras {
			padding: 38px 6px 0;
		}
		.gc,
		.pending {
			min-height: 108px;
		}
		.dn {
			align-self: flex-start;
		}
		.nef {
			display: block;
			position: absolute;
			top: 8px;
			right: 8px;
			font-family: var(--font-mono);
			font-size: 10px;
			font-weight: 700;
			color: var(--ink-3);
		}
		.dots {
			display: none;
		}
		.lbls {
			display: flex;
			flex-direction: column;
			gap: 2px;
			min-width: 0;
		}
		.lbls span {
			font-size: 11.5px;
			line-height: 1.3;
			padding: 1px 5px;
			border-radius: 4px;
			background: var(--ledger-soft);
			color: var(--ink);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.lbls span.todo {
			background: var(--danger-soft);
		}
		.lbls span.holiday {
			background: var(--sunk);
			color: var(--ink-2);
		}
		.lbls span.done {
			background: var(--sunk);
			color: var(--ink-3);
			text-decoration: line-through;
		}
		.lbls em {
			font-style: normal;
			font-size: 11px;
			color: var(--ink-3);
			padding-left: 5px;
		}
	}
</style>
