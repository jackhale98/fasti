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
		neighbour,
		focusDate = null,
		onmove,
		onfocused,
		onselect
	}: {
		slots: Slot[];
		/** Weekday names in column order. */
		names: string[];
		today: string | null;
		selected: string | null;
		isHoliday: (entry: ReminderEntry) => boolean;
		/** The previous (-1) or next (+1) month's grid, for keys that leave this one. */
		neighbour?: (dir: -1 | 1) => Slot[] | undefined;
		/** A day to move keyboard focus to once its cell exists (set after an arrow key). */
		focusDate?: string | null;
		onfocused?: () => void;
		/** An arrow key chose this day: select it and ask for focus. */
		onmove?: (date: string) => void;
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

	/**
	 * Moving into the next or previous month swaps in a new grid, which may still
	 * be loading, so the page keeps the wanted day (`focusDate`) and whichever
	 * grid has its cell focuses it; keys then keep working.
	 */
	$effect(() => {
		const date = focusDate;
		if (!date || !slots.some((s) => s?.date === date)) return;
		void tick().then(() => {
			const cell = grid?.querySelector<HTMLElement>(`[data-date="${date}"]`);
			if (cell) {
				cell.focus({ preventScroll: true });
				onfocused?.();
			}
		});
	});

	function move(date: string) {
		if (onmove) onmove(date);
		else onselect(date);
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
		if (target) {
			move(target.date);
			return;
		}
		// Off the grid (Up from the top row, Down from the bottom): the
		// neighbouring month's grid contains this day too, so step there.
		if (!date || !neighbour) return;
		const other = neighbour(to < 0 ? -1 : 1);
		const at = other?.findIndex((s) => s?.date === date) ?? -1;
		const beyond = at >= 0 ? other?.[at + (to - current)] : undefined;
		if (beyond) move(beyond.date);
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
								<!-- As many labels as the cell's height allows (container queries below),
								     then "+N more"; fin marks the day's last entry. -->
								{#each slot.day.entries.slice(0, 3) as entry, i (i)}
									<span class="{kinds[i]} s{i + 1}" class:fin={i === slot.day.entries.length - 1}
										>{entry.body || '(no message)'}</span
									>
								{/each}
								{#each [0, 1, 2, 3] as level (level)}
									{#if slot.day.entries.length > (level < 3 ? level + 1 : 3)}
										<em class="e{level}">+{slot.day.entries.length - level} more</em>
									{/if}
								{/each}
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
		/* Phones: fill the stage, the six week rows sharing what the weekday row leaves. */
		height: 100%;
		display: grid;
		grid-template-rows: auto repeat(6, minmax(0, 1fr));
		box-sizing: border-box;
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
		min-height: 0;
	}
	.pending {
		background: color-mix(in srgb, var(--sunk) 40%, transparent);
	}
	.extras {
		position: absolute;
		inset: 0;
		padding: 34px 2px 0;
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
		.gc {
			container-type: size;
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
		@container (max-height: 49.99px) {
			.dots {
				display: flex;
			}
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
			line-height: 16px;
			color: var(--ink-3);
			padding-left: 5px;
		}
		/* A cell never grows its row: labels (19 px each) and the "+N more"
		   line (16 px) show only where the height below the day number fits. */
		.lbls span,
		.lbls em {
			display: none;
		}
		@container (min-height: 69px) {
			.s1 {
				display: block;
			}
		}
		@container (min-height: 53px) {
			.s1.fin {
				display: block;
			}
		}
		@container (min-height: 88px) {
			.s2 {
				display: block;
			}
		}
		@container (min-height: 72px) {
			.s2.fin {
				display: block;
			}
		}
		@container (min-height: 107px) {
			.s3 {
				display: block;
			}
		}
		@container (min-height: 91px) {
			.s3.fin {
				display: block;
			}
		}
		@container (min-height: 50px) and (max-height: 68.99px) {
			.e0 {
				display: block;
			}
		}
		@container (min-height: 69px) and (max-height: 87.99px) {
			.e1 {
				display: block;
			}
		}
		@container (min-height: 88px) and (max-height: 106.99px) {
			.e2 {
				display: block;
			}
		}
		@container (min-height: 107px) {
			.e3 {
				display: block;
			}
		}
	}
</style>
