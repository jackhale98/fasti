<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from '#lib/ui/Icon.svelte';
	import ItemRow from '#lib/ui/ItemRow.svelte';
	import MonthGrid from '#lib/ui/month/MonthGrid.svelte';
	import {
		buildGrid,
		columnNames,
		GRID_SIZE,
		holidayChecker,
		type Slot
	} from '#lib/ui/month/model.ts';
	import { app } from '#lib/app/app.svelte.ts';
	import { shell } from '#lib/ui/shell.svelte.ts';
	import { dayOf, monthName, time, weekday } from '#lib/app/format.ts';
	import { addMonths, calendar } from '#lib/engine/client.ts';
	import type { CalendarMonth } from '#lib/engine/types.ts';

	/** The visible month, 'YYYY-MM'; starts at Remind's current month. */
	let month = $state<string | null>(null);
	let picked = $state<string | null>(null);
	let loaded = $state<Record<string, CalendarMonth>>({});
	let error = $state<string | null>(null);
	/** Which way the last month change went: 1 to a later month, -1 to an earlier one. */
	let dir = $state<1 | -1>(1);
	/** A day whose cell should take keyboard focus once its grid is on screen. */
	let focusDate = $state<string | null>(null);
	/** Below 960 px: the stationary grid with the day drawer (no inspector panel there). */
	let phone = $state(false);
	/** Wide enough for the inspector panel; the day's list lives there (or beside the grid). */
	const desktop = $derived(!phone);
	let expanded = $state(false);
	// The expanded drawer covers the screen; the FAB would float over its list.
	$effect(() => {
		shell.hideFab = expanded;
		return () => (shell.hideFab = false);
	});

	const mondayFirst = $derived(app.settings.weekStart === 'monday');
	const hide = $derived(app.settings.hideCompletedTodos);
	const today = $derived(app.today?.date ?? null);
	/** Results are kept per month and per setting that changes them. */
	const keyOf = (m: string, mf: boolean, h: boolean) => `${m}|${mf}|${h}`;

	$effect(() => {
		if (month === null && today) month = today.slice(0, 7);
	});

	// The visible month is requested first (at higher priority); the
	// neighbours fill in behind it, then one more month in the direction of
	// travel so repeated taps stay smooth. A newer request for a view
	// supersedes its predecessor, so each has its own view name.
	$effect(() => {
		// The engine posts the snapshot to a worker, which can't clone a state proxy.
		const snapshot = $state.snapshot(app.snapshot);
		const m = month;
		const heading = dir;
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
		void fetchMonth(m, 'month', 3);
		void fetchMonth(addMonths(m, -1), 'month-prev', 2);
		void fetchMonth(addMonths(m, 1), 'month-next', 2);
		void fetchMonth(addMonths(m, heading * 2), 'month-far', 1);
		return () => abort.abort();
	});

	const at = (m: string) => loaded[keyOf(m, mondayFirst, hide)];
	const current = $derived(month ? at(month) : undefined);
	/** Set once any month has loaded; from then on a month still on its way shows as a skeleton. */
	let ready = $state(false);
	$effect(() => {
		if (current) ready = true;
	});
	/**
	 * A month's 42 slots from what is loaded: all empty (a skeleton of the right
	 * shape) while the month itself hasn't arrived.
	 */
	function gridFor(m: string): Slot[] {
		const visible = at(m);
		return visible
			? buildGrid(visible, at(addMonths(m, -1)), at(addMonths(m, 1)), mondayFirst)
			: Array.from({ length: GRID_SIZE }, () => null);
	}
	/**
	 * The grid of the month before (-1) or after (+1) `m`, for arrow keys that
	 * leave the grid: built from Remind's own months, so no date arithmetic.
	 * Undefined while that month is still loading.
	 */
	function neighbour(m: string, d: -1 | 1): Slot[] | undefined {
		const other = addMonths(m, d);
		return at(other) ? gridFor(other) : undefined;
	}
	/** Weekday names; the last loaded month's, so a skeleton keeps the header. */
	let lastNames = $state<string[]>([]);
	$effect(() => {
		if (current) lastNames = columnNames(current, mondayFirst);
	});
	const isHoliday = $derived(holidayChecker(app.snapshot?.files ?? {}));
	const selected = $derived(
		picked && picked.slice(0, 7) === month
			? picked
			: app.today && app.today.date.slice(0, 7) === month
				? app.today.date
				: (current?.days[0]?.date ?? null)
	);
	const day = $derived(
		(current?.days.find((d) => d.date === selected) ??
			(selected ? gridFor(month ?? '').find((s) => s?.date === selected)?.day : null)) ||
			null
	);
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

	/** Change the visible month; the grid slides the way the month moves. */
	function go(target: string) {
		if (!month || target === month) return;
		// 'YYYY-MM' strings order like months.
		dir = target > month ? 1 : -1;
		month = target;
	}
	function select(date: string) {
		picked = date;
		go(date.slice(0, 7));
	}
	function move(date: string) {
		focusDate = date;
		select(date);
	}
	function step(n: number) {
		if (!month) return;
		go(addMonths(month, n));
		picked = null;
	}
	function goToday() {
		if (!today) return;
		picked = today;
		go(today.slice(0, 7));
	}

	// ---- the slide between months ----
	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const slide = (node: Element, side: 1 | -1) =>
		fly(node, {
			x: `${side * dir * 100}%`,
			opacity: 1,
			duration: reduced() ? 0 : 250,
			easing: cubicOut
		});
	/** The month sliding out is no longer interactive. */
	const retire = (e: Event) => ((e.currentTarget as HTMLElement).inert = true);

	// Swipe the grid sideways to change month (phones).
	let swipe: { x: number; y: number; done: boolean } | null = null;
	let swallowClick = false;
	function swipeDown(e: PointerEvent) {
		swallowClick = false;
		swipe = phone && e.isPrimary ? { x: e.clientX, y: e.clientY, done: false } : null;
	}
	function swipeMove(e: PointerEvent) {
		if (!swipe || swipe.done) return;
		const dx = e.clientX - swipe.x;
		const dy = e.clientY - swipe.y;
		if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
			swipe.done = true;
			swallowClick = true;
			step(dx < 0 ? 1 : -1);
		}
	}
	const swipeEnd = () => (swipe = null);
	function swipeClick(e: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	// ---- the day drawer (phones) ----
	let drawer = $state<HTMLElement>();
	let handle = $state<HTMLElement>();
	let listEl = $state<HTMLElement>();
	let dragY = $state<number | null>(null);
	let drag: { y: number; t: number; base: number; max: number; moved: boolean } | null = null;

	function collapsedH() {
		return parseFloat(getComputedStyle(drawer!).getPropertyValue('--col-h')) || 116;
	}
	function dragStart(e: PointerEvent) {
		if (!drawer || !e.isPrimary) return;
		const max = drawer.offsetHeight - collapsedH();
		drag = { y: e.clientY, t: e.timeStamp, base: expanded ? 0 : max, max, moved: false };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function dragMove(e: PointerEvent) {
		if (!drag) return;
		const dy = e.clientY - drag.y;
		if (!drag.moved && Math.abs(dy) < 6) return;
		drag.moved = true;
		dragY = Math.min(drag.max, Math.max(0, drag.base + dy));
	}
	function dragEnd(e: PointerEvent) {
		if (!drag) return;
		const dy = e.clientY - drag.y;
		const fast = Math.abs(dy) / Math.max(1, e.timeStamp - drag.t) > 0.5;
		const moved = drag.moved;
		drag = null;
		dragY = null;
		if (!moved) {
			// A tap anywhere on the header. (The button's own click, from keyboard
			// or a screen reader, is handled in onHandleClick.)
			expanded = !expanded;
		} else if (expanded ? dy > (fast ? 12 : 60) : dy < -(fast ? 12 : 60)) {
			expanded = !expanded;
		}
	}
	const dragCancel = () => {
		drag = null;
		dragY = null;
	};
	function onHandleClick(e: MouseEvent) {
		// detail 0: Enter, Space or assistive tech. Pointer taps are handled in dragEnd.
		if (e.detail === 0) expanded = !expanded;
	}
	function onwindowkey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !expanded || !phone) return;
		if (document.querySelector('dialog[open]')) return;
		e.preventDefault();
		expanded = false;
		if (drawer?.contains(document.activeElement)) handle?.focus();
	}
	// A new day starts at the top of the list.
	$effect(() => {
		void selected;
		if (listEl) listEl.scrollTop = 0;
	});

	// ---- fitting the viewport on phones ----
	let page = $state<HTMLElement>();
	let top = $state(61);
	function measure() {
		if (page) top = Math.round(page.getBoundingClientRect().top + window.scrollY);
	}
	onMount(() => {
		const mq = matchMedia('(max-width: 959.98px)');
		phone = mq.matches;
		const change = () => {
			phone = mq.matches;
			if (!phone) expanded = false;
			measure();
		};
		mq.addEventListener('change', change);
		measure();
		const ro = new ResizeObserver(measure);
		if (page?.parentElement) ro.observe(page.parentElement);
		void document.fonts?.ready.then(measure);
		return () => {
			mq.removeEventListener('change', change);
			ro.disconnect();
		};
	});

	// On desktop the day's list lives in the inspector panel while no reminder is
	// selected; with the panel hidden it sits beside the grid instead.
	$effect(() => {
		shell.panel = desktop && !shell.inspectorHidden ? sidepanel : null;
		return () => (shell.panel = null);
	});
	const sideBeside = $derived(desktop && shell.inspectorHidden);

	/** The collapsed drawer's one-line preview of the day. */
	const preview = $derived.by(() => {
		if (!day) return 'Loading…';
		const entries = day.entries;
		if (!entries.length) return 'No reminders';
		const first = entries[0];
		if (!first) return 'No reminders';
		const when = first.time !== null ? `${time(first.time, app.settings.clock, true)} ` : '';
		const more = entries.length > 1 ? `, +${entries.length - 1} more` : '';
		return `${when}${first.body || '(no message)'}${more}`;
	});
</script>

<svelte:head><title>Month · Fasti</title></svelte:head>
<svelte:window onkeydown={onwindowkey} />

{#snippet daylist()}
	<ul class="list">
		{#each day?.entries ?? [] as entry (`${entry.file}:${entry.line}:${entry.date}:${entry.time}`)}
			<ItemRow {entry} />
		{:else}
			<li class="empty">{day ? 'No reminders on this day.' : 'Loading…'}</li>
		{/each}
	</ul>
{/snippet}

{#snippet sidepanel()}
	<section class="sec" aria-labelledby="day-h">
		<div class="sec-h">{@render dayheading()}</div>
		{@render daylist()}
	</section>
	{@render legend()}
{/snippet}

{#snippet legend()}
	<div class="legend">
		<span><i class="lt"></i>Today</span>
		<span><i class="lw"></i>Day off every week (OMIT Sat Sun)</span>
		<span><i class="ld"></i>Holiday (OMIT date)</span>
		<span class="nlegend"><b>N</b>Nefastus: a day Remind omits</span>
	</div>
{/snippet}

{#snippet dayheading()}
	{#if selected}
		<h2 id="day-h" data-testid="day-heading">
			{weekday(selected)}
			{dayOf(selected)}
			{monthName(selected)}
		</h2>
		{#if note}<span class="note" data-testid="day-note">{note}</span>{/if}
	{:else}
		<h2 id="day-h" data-testid="day-heading">Loading…</h2>
	{/if}
{/snippet}

<div class="page" bind:this={page} style:--top="{top}px">
	<h1 class="vh-head">Month</h1>

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
	{:else if !ready || !month}
		<p class="status" role="status">Loading the month…</p>
	{:else}
		<div class="body">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="stage"
				inert={expanded}
				onpointerdown={swipeDown}
				onpointermove={swipeMove}
				onpointerup={swipeEnd}
				onpointercancel={swipeEnd}
				onclickcapture={swipeClick}
			>
				{#key month}
					{@const m = month}
					{@const shown = at(m)}
					<div class="panel" in:slide={1} out:slide={-1} onoutrostart={retire}>
						<MonthGrid
							slots={gridFor(m)}
							names={shown ? columnNames(shown, mondayFirst) : lastNames}
							{today}
							{selected}
							{isHoliday}
							neighbour={(d) => neighbour(m, d)}
							{focusDate}
							onfocused={() => (focusDate = null)}
							onmove={move}
							onselect={select}
						/>
					</div>
				{/key}
			</div>
			{#if sideBeside}
				<aside class="beside" aria-label="Selected day">{@render sidepanel()}</aside>
			{/if}
		</div>
	{/if}
</div>

{#if phone && ready && month}
	<section
		class="drawer"
		class:open={expanded}
		class:dragging={dragY !== null}
		style:transform={dragY !== null ? `translateY(${dragY}px)` : undefined}
		style:--top="{top}px"
		bind:this={drawer}
		aria-label="Selected day"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="dhead"
			onpointerdown={dragStart}
			onpointermove={dragMove}
			onpointerup={dragEnd}
			onpointercancel={dragCancel}
		>
			<button
				type="button"
				class="grab"
				bind:this={handle}
				aria-expanded={expanded}
				aria-controls="day-list"
				aria-label="Day details"
				onclick={onHandleClick}
			>
				<span class="bar"></span>
			</button>
			<div class="dtitle">{@render dayheading()}</div>
			{#if !expanded}<p class="preview" data-testid="day-preview">{preview}</p>{/if}
		</div>
		<div
			id="day-list"
			class="dlist"
			role="region"
			aria-labelledby="day-h"
			inert={!expanded}
			bind:this={listEl}
		>
			{@render daylist()}
		</div>
	</section>
{/if}

<style>
	.page {
		/* Wider when the desktop inspector is hidden (--grid-view-max, set by the layout). */
		max-width: var(--grid-view-max, 760px);
		margin: 0 auto;
		padding: 20px max(16px, env(safe-area-inset-right, 0px)) 8px
			max(16px, env(safe-area-inset-left, 0px));
	}
	.vh-head {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		font-size: 1px;
	}
	.body {
		display: flex;
		gap: 16px;
		flex: 1;
		min-height: 0;
		flex-direction: column;
	}
	.beside {
		display: none;
	}
	.monthhead {
		display: flex;
		align-items: end;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.stage {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		overflow: hidden;
		border-radius: 12px;
		touch-action: pan-y;
	}
	.panel {
		grid-area: 1 / 1;
		min-width: 0;
		min-height: 0;
	}
	.drawer {
		display: none;
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
	.sec-h :global(h2),
	.dtitle :global(h2) {
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
	@media (min-width: 960px) {
		/* Desktop: the page fills main (which scrolls); header, weekdays and six
		   rows share its height, so the whole month shows without scrolling. */
		.page {
			box-sizing: border-box;
			height: 100%;
			padding: 16px 28px 8px;
			display: flex;
			flex-direction: column;
		}
		.monthhead {
			flex: none;
			margin-bottom: 10px;
		}
		.mh {
			font-size: 26px;
		}
		.iconbtn {
			height: 38px;
		}
		.stage {
			flex: 1;
			min-height: 0;
			grid-template-rows: minmax(0, 1fr);
		}
		.body {
			flex-direction: row;
		}
		.beside {
			display: block;
			flex: none;
			width: 300px;
			overflow-y: auto;
			padding-right: 2px;
		}
		.sec {
			margin-top: 0;
		}
		.legend {
			margin-top: 18px;
		}
	}

	/* Phones: a stationary page. The header, weekdays and six week rows fill
	   what lies between the top bar and the drawer; the drawer is docked above
	   the tab bar. --top (the page's offset below the top bar) is measured. */
	@media (max-width: 959.98px) {
		.page {
			--col-h: 116px;
			--avail: calc(100dvh - var(--top) - var(--tabbar-h) - env(safe-area-inset-bottom, 0px));
			box-sizing: border-box;
			height: var(--avail);
			/* cancel the layout's bottom padding (tab bar + room for the FAB) so the document can't scroll */
			margin-bottom: calc(-1 * (var(--tabbar-h) + 88px + env(safe-area-inset-bottom, 0px)));
			padding-top: 8px;
			padding-bottom: calc(var(--col-h) + 8px);
			display: flex;
			flex-direction: column;
		}
		.monthhead {
			margin-bottom: 8px;
			flex: none;
		}
		.mh {
			font-size: 24px;
		}
		.yr {
			font-size: 18px;
		}
		.iconbtn {
			height: 40px;
		}
		.stage {
			flex: 1;
			min-height: 0;
			grid-template-rows: minmax(0, 1fr);
		}
		.drawer {
			--col-h: 116px;
			display: flex;
			flex-direction: column;
			position: fixed;
			z-index: 4;
			left: 0;
			right: 0;
			bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
			/* open: from just under the month header down to the tab bar */
			height: calc(100dvh - var(--top) - var(--tabbar-h) - env(safe-area-inset-bottom, 0px) - 56px);
			background: var(--surface);
			border-top: 1px solid var(--rule);
			border-radius: 18px 18px 0 0;
			box-shadow: 0 -6px 24px rgba(19, 34, 28, 0.12);
			transform: translateY(calc(100% - var(--col-h)));
			transition: transform 200ms ease;
			will-change: transform;
			max-width: 760px;
			margin: 0 auto;
		}
		.drawer.open {
			transform: none;
		}
		.drawer.dragging {
			transition: none;
		}
		.dhead {
			flex: none;
			height: var(--col-h);
			box-sizing: border-box;
			padding: 0 max(16px, env(safe-area-inset-left, 0px));
			/* clear of the FAB, which floats over the drawer's right edge */
			padding-right: 112px;
			touch-action: none;
			cursor: grab;
			user-select: none;
		}
		.drawer.open .dhead {
			height: auto;
			padding-right: max(16px, env(safe-area-inset-right, 0px));
			padding-bottom: 6px;
		}
		.grab {
			display: grid;
			place-items: center;
			width: calc(100% + 96px);
			margin-right: -96px;
			height: 32px;
			border: 0;
			background: transparent;
			cursor: inherit;
			padding: 0;
		}
		.drawer.open .grab {
			width: 100%;
			margin-right: 0;
		}
		.grab:focus-visible {
			outline: 2px solid var(--ledger);
			outline-offset: -2px;
			border-radius: 10px;
		}
		.bar {
			width: 40px;
			height: 5px;
			border-radius: 3px;
			background: var(--ink-3);
			opacity: 0.6;
		}
		.dtitle {
			display: flex;
			align-items: baseline;
			gap: 8px;
			flex-wrap: wrap;
		}
		.note {
			margin-left: 0;
		}
		.preview {
			margin: 4px 0 0;
			color: var(--ink-2);
			font-size: 14px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.dlist {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: 0 max(16px, env(safe-area-inset-right, 0px))
				calc(100px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drawer {
			transition: none;
		}
	}
</style>
