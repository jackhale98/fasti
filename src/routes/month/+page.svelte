<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import View from '#lib/ui/View.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import ItemRow from '#lib/ui/ItemRow.svelte';
	import MonthGrid from '#lib/ui/month/MonthGrid.svelte';
	import { buildGrid, columnNames, holidayChecker, type Slot } from '#lib/ui/month/model.ts';
	import { app } from '#lib/app/app.svelte.ts';
	import { dayOf, monthName, weekday } from '#lib/app/format.ts';
	import { addMonths, calendar } from '#lib/engine/client.ts';
	import type { CalendarMonth } from '#lib/engine/types.ts';

	/** The visible month, 'YYYY-MM'; starts at Remind's current month. */
	let month = $state<string | null>(null);
	let picked = $state<string | null>(null);
	let loaded = $state<Record<string, CalendarMonth>>({});
	let error = $state<string | null>(null);

	const mondayFirst = $derived(app.settings.weekStart === 'monday');
	const hide = $derived(app.settings.hideCompletedTodos);
	const today = $derived(app.today?.date ?? null);
	/** Results are kept per month and per setting that changes them. */
	const keyOf = (m: string, mf: boolean, h: boolean) => `${m}|${mf}|${h}`;

	$effect(() => {
		if (month === null && today) month = today.slice(0, 7);
	});

	// The visible month is requested first (at higher priority); the
	// neighbours fill in behind it. A newer request for a view supersedes its
	// predecessor, so each of the three has its own view name.
	$effect(() => {
		// The engine posts the snapshot to a worker, which can't clone a state proxy.
		const snapshot = $state.snapshot(app.snapshot);
		const m = month;
		void app.version;
		if (!snapshot || !m) return;
		const mf = mondayFirst;
		const h = hide;
		const abort = new AbortController();
		const fetchMonth = async (target: string, view: string, priority: number) => {
			try {
				await calendar(
					snapshot,
					{ month: target, mondayFirst: mf, hideCompletedTodos: h, tz: app.tz },
					{
						view,
						signal: abort.signal,
						priority,
						onMonth: (result) => {
							if (abort.signal.aborted) return;
							loaded[keyOf(target, mf, h)] = result;
							if (target === m) error = null;
						}
					}
				);
			} catch (e) {
				if (abort.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
				if (target === m) error = e instanceof Error ? e.message : String(e);
			}
		};
		void fetchMonth(m, 'month', 2);
		void fetchMonth(addMonths(m, -1), 'month-prev', 1);
		void fetchMonth(addMonths(m, 1), 'month-next', 1);
		return () => abort.abort();
	});

	const at = (m: string) => loaded[keyOf(m, mondayFirst, hide)];
	const current = $derived(month ? at(month) : undefined);
	const slots = $derived(
		current
			? buildGrid(
					current,
					at(addMonths(current.month, -1)),
					at(addMonths(current.month, 1)),
					mondayFirst
				)
			: []
	);
	/**
	 * The grid of the month before (-1) or after (+1) the visible one, for
	 * arrow keys that leave the grid: built from Remind's own months, so no
	 * date arithmetic. Undefined while that month is still loading.
	 */
	function neighbour(dir: -1 | 1): Slot[] | undefined {
		if (!current) return undefined;
		const m = addMonths(current.month, dir);
		const visible = at(m);
		return visible
			? buildGrid(visible, at(addMonths(m, -1)), at(addMonths(m, 1)), mondayFirst)
			: undefined;
	}
	const names = $derived(current ? columnNames(current, mondayFirst) : []);
	const isHoliday = $derived(holidayChecker(app.snapshot?.files ?? {}));
	const selected = $derived(
		picked && picked.slice(0, 7) === month
			? picked
			: app.today && app.today.date.slice(0, 7) === month
				? app.today.date
				: (current?.days[0]?.date ?? null)
	);
	const day = $derived(slots.find((s) => s?.date === selected)?.day ?? null);
	const holidays = $derived(day ? day.entries.filter((e) => isHoliday(e)).map((e) => e.body) : []);
	const note = $derived(
		holidays.length
			? `Holiday: ${holidays.join(', ')}`
			: day?.omit === 'weekly'
				? 'Day off'
				: day?.omit === 'dated'
					? 'Holiday'
					: ''
	);

	function select(date: string) {
		picked = date;
		month = date.slice(0, 7);
	}
	function step(n: number) {
		if (!month) return;
		month = addMonths(month, n);
		picked = null;
	}
	function goToday() {
		if (!today) return;
		month = today.slice(0, 7);
		picked = today;
	}
</script>

<View eyebrow="Month" title="Month">
	{#if month}
		<div class="monthhead">
			<h2 class="mh" aria-live="polite" data-testid="month-heading">
				{monthName(month)} <span class="yr">{month.slice(0, 4)}</span>
			</h2>
			<div class="mnav">
				<button type="button" class="iconbtn" aria-label="Previous month" onclick={() => step(-1)}>
					<Icon name="prev" size={18} stroke={2} />
				</button>
				<button type="button" class="iconbtn" onclick={goToday}>Today</button>
				<button type="button" class="iconbtn" aria-label="Next month" onclick={() => step(1)}>
					<Icon name="next" size={18} stroke={2} />
				</button>
			</div>
		</div>
	{/if}

	{#if error}
		<p class="status" role="alert">{error}</p>
	{:else if !current}
		<p class="status" role="status">Loading the month…</p>
	{:else}
		<MonthGrid {slots} {names} {today} {selected} {isHoliday} {neighbour} onselect={select} />
		<div class="legend">
			<span><i class="lt"></i>Today</span>
			<span><i class="lw"></i>Day off every week (OMIT Sat Sun)</span>
			<span><i class="ld"></i>Holiday (OMIT date)</span>
			<span class="nlegend"><b>N</b>Nefastus: a day Remind omits</span>
		</div>
		{#if selected && day}
			<section class="sec" aria-labelledby="day-h">
				<div class="sec-h">
					<h2 id="day-h" data-testid="day-heading">
						{weekday(selected)}
						{dayOf(selected)}
						{monthName(selected)}
					</h2>
					{#if note}<span class="note" data-testid="day-note">{note}</span>{/if}
				</div>
				<ul class="list">
					{#each day.entries as entry (`${entry.file}:${entry.line}:${entry.date}:${entry.time}`)}
						<ItemRow {entry} />
					{:else}
						<li class="empty">No reminders on this day.</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</View>

<style>
	.monthhead {
		display: flex;
		align-items: end;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.mh {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: 28px;
		line-height: 1.1;
		margin: 0;
	}
	.yr {
		color: var(--ink-3);
		font-size: 22px;
	}
	.mnav {
		margin-left: auto;
		display: flex;
		gap: 6px;
	}
	.iconbtn {
		height: 44px;
		min-width: 44px;
		padding: 0 12px;
		border-radius: 10px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		display: inline-grid;
		place-items: center;
		font: inherit;
		font-weight: 600;
		font-size: 13.5px;
		cursor: pointer;
	}
	.iconbtn:focus-visible {
		outline: 2px solid var(--ledger);
		outline-offset: 2px;
	}
	.status {
		color: var(--ink-2);
		margin: 24px 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		margin: 10px 2px 0;
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.legend i {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		vertical-align: -2px;
		margin-right: 6px;
		border: 1px solid var(--rule);
	}
	.lw {
		background: color-mix(in srgb, var(--sunk) 55%, var(--surface));
	}
	.ld {
		background-color: var(--surface);
		background-image: repeating-linear-gradient(135deg, var(--hatch) 0 2px, transparent 2px 7px);
	}
	.legend .lt {
		background: var(--mark);
		border-color: transparent;
		border-radius: 50%;
	}
	.nlegend {
		display: none;
	}
	.nlegend b {
		font-family: var(--font-mono);
		font-size: 11px;
		margin-right: 6px;
		color: var(--ink-3);
	}
	@media (min-width: 720px) {
		.nlegend {
			display: inline;
		}
	}
	.sec {
		margin-top: 22px;
	}
	.sec-h {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 4px;
	}
	.sec-h h2 {
		font-size: 17px;
		margin: 0;
	}
	.note {
		margin-left: auto;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--ink-2);
		background: var(--sunk);
		border-radius: 6px;
		padding: 2px 7px;
	}
	.list {
		margin: 0;
		padding: 0;
	}
	.empty {
		list-style: none;
		color: var(--ink-3);
		padding: 14px 4px;
		border-bottom: 1px solid var(--rule);
	}
</style>
