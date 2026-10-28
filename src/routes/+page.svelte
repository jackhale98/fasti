<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * Today: Remind's agenda for the engine's today, plus the next two weeks
	 * from its calendar. Every date shown was printed by Remind.
	 */
	import { app } from '#lib/app/app.svelte.ts';
	import { dayMonth, longDate, weekday, weekdayShort } from '#lib/app/format.ts';
	import { agenda, calendar } from '#lib/engine/client.ts';
	import type { AgendaResult, CalendarDay } from '#lib/engine/types.ts';
	import ItemRow from '#lib/ui/ItemRow.svelte';
	import Section from '#lib/ui/today/Section.svelte';
	import { sections, upcoming, visibleEntries } from '#lib/ui/today/model.ts';

	interface Loaded {
		date: string;
		agenda: AgendaResult;
		todayDay: CalendarDay | null;
		days: CalendarDay[];
	}

	let loaded = $state<Loaded | null>(null);
	let failure = $state<string | null>(null);
	let seq = 0;

	$effect(() => {
		const snapshot = app.snapshot ? $state.snapshot(app.snapshot) : null;
		const now = app.today;
		void app.version;
		const mondayFirst = app.settings.weekStart === 'monday';
		const hideCompletedTodos = app.settings.hideCompletedTodos;
		if (!snapshot || !now) return;
		const mine = ++seq;
		const hh = String(Math.floor(now.time / 60)).padStart(2, '0');
		const mm = String(now.time % 60).padStart(2, '0');
		const month = now.date.slice(0, 7);
		Promise.all([
			agenda(snapshot, { date: now.date, time: `${hh}:${mm}`, tz: app.tz }, { view: 'today' }),
			calendar(
				snapshot,
				{ month, months: 2, mondayFirst, hideCompletedTodos, tz: app.tz },
				{ view: 'today-calendar' }
			)
		]).then(
			([ag, cal]) => {
				if (mine !== seq) return;
				failure = null;
				loaded = { date: now.date, agenda: ag, ...upcoming(cal.months, now.date) };
			},
			(e: unknown) => {
				if (mine !== seq || (e instanceof Error && e.name === 'AbortError')) return;
				failure = e instanceof Error ? e.message : String(e);
			}
		);
	});

	const parts = $derived(loaded ? sections(loaded.agenda, loaded.date) : null);
	const groups = $derived(
		(loaded?.days ?? [])
			.map((day, index) => ({ day, index, entries: visibleEntries(day) }))
			.filter((g) => g.entries.length > 0 || g.day.omit === 'dated')
	);
	const problems = $derived(
		loaded ? loaded.agenda.diagnostics.filter((d) => !d.warning).length : 0
	);
	const error = $derived(app.error ?? failure);
	const key = (e: { file: string; line: number; date: string }) => `${e.file}:${e.line}:${e.date}`;
</script>

<svelte:head
	><title>{loaded ? `${weekday(loaded.date)} · Fasti` : 'Today · Fasti'}</title></svelte:head
>

<div class="view">
	{#if error}
		<div class="err" role="alert">
			<strong>Remind could not run.</strong>
			<span>{error}</span>
		</div>
	{/if}
	{#if loaded && parts}
		<header class="dayhead">
			{#if loaded.agenda.banner}<p class="banner">{loaded.agenda.banner}</p>{/if}
			<h1 class="display"><span>{weekday(loaded.date)}</span></h1>
			<p class="sub">
				{longDate(loaded.date).replace(/^\w+ /, '')}{#if loaded.todayDay?.omit}
					· Day off{/if}
			</p>
		</header>

		{#if problems}
			<p class="note">
				Remind reported {problems} problem{problems === 1 ? '' : 's'} in your files. See Script.
			</p>
		{/if}

		{#if parts.overdue.length}
			<Section id="overdue" title="Overdue" count={parts.overdue.length}>
				<ul class="list">
					{#each parts.overdue as e (key(e))}
						<ItemRow entry={e} when={dayMonth(e.date)} whenSub="overdue" late />
					{/each}
				</ul>
			</Section>
		{/if}

		<Section id="today" title="Today" count={parts.today.length}>
			<ul class="list">
				{#each parts.today as e (key(e))}
					<ItemRow entry={e} />
				{:else}
					<li class="empty">Nothing scheduled today.</li>
				{/each}
			</ul>
		</Section>

		{#if parts.headsUp.length}
			<Section id="headsup" title="Heads-up" count={parts.headsUp.length}>
				<ul class="list">
					{#each parts.headsUp as e (key(e))}
						<ItemRow entry={e} when={weekdayShort(e.date)} whenSub={dayMonth(e.date)} />
					{/each}
				</ul>
			</Section>
		{/if}

		<Section id="next" title="Next two weeks">
			{#if groups.length}
				<ul class="days">
					{#each groups as g (g.day.date)}
						<li class="day">
							<div class="dayrow-h">
								<h3>{g.index === 0 ? 'Tomorrow' : weekday(g.day.date)}</h3>
								<span>{dayMonth(g.day.date)}</span>
								{#if g.day.omit}<span class="off">Day off</span>{/if}
							</div>
							{#if g.entries.length}
								<ul class="list">
									{#each g.entries as e (key(e))}
										<ItemRow entry={e} />
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<ul class="list"><li class="empty">Nothing in the next two weeks.</li></ul>
			{/if}
		</Section>
	{:else if !error}
		<div class="skeleton" role="status" aria-live="polite" aria-busy="true">
			<span class="sr">Loading your agenda…</span>
			<div class="bar b1" aria-hidden="true"></div>
			<div class="bar b2" aria-hidden="true"></div>
			<div class="bar b3" aria-hidden="true"></div>
			<div class="bar b3" aria-hidden="true"></div>
			<div class="bar b3" aria-hidden="true"></div>
		</div>
	{/if}
</div>

<style>
	.view {
		max-width: 760px;
		margin: 0 auto;
		padding: 20px max(16px, env(safe-area-inset-right, 0px)) 8px
			max(16px, env(safe-area-inset-left, 0px));
	}
	.dayhead {
		display: grid;
		gap: 2px;
		margin-bottom: 22px;
	}
	.banner {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-3);
		margin: 0 0 10px;
		overflow-wrap: anywhere;
	}
	.display {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(34px, 9vw, 48px);
		line-height: 1.02;
		letter-spacing: -0.015em;
		margin: 0;
	}
	.display span {
		background: linear-gradient(
			transparent 58%,
			color-mix(in srgb, var(--mark) 70%, transparent) 58%,
			color-mix(in srgb, var(--mark) 70%, transparent) 92%,
			transparent 92%
		);
		padding: 0 0.06em;
	}
	.sub {
		color: var(--ink-2);
		margin: 6px 0 0;
		font-size: 15px;
	}
	.note {
		color: var(--ink-2);
		font-size: 14px;
		margin: 0;
	}
	.list,
	.days {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list {
		border-top: 1px solid var(--rule);
	}
	.days .list {
		border-top: 0;
	}
	.dayrow-h {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 14px 4px 4px;
	}
	.dayrow-h h3 {
		margin: 0;
		font-weight: 700;
		font-size: 14px;
	}
	.dayrow-h span {
		color: var(--ink-3);
		font-size: 12.5px;
	}
	.dayrow-h .off {
		margin-left: auto;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--ink-2);
		background: var(--sunk);
		border-radius: 6px;
		padding: 2px 7px;
	}
	.empty {
		color: var(--ink-3);
		padding: 14px 4px;
		border-bottom: 1px solid var(--rule);
	}
	.err {
		display: grid;
		gap: 4px;
		background: var(--danger-soft);
		color: var(--danger);
		border-radius: 10px;
		padding: 12px 14px;
		margin-bottom: 16px;
		overflow-wrap: anywhere;
	}
	.skeleton {
		display: grid;
		gap: 14px;
		padding-top: 8px;
	}
	.bar {
		height: 18px;
		border-radius: 6px;
		background: var(--sunk);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.b1 {
		height: 48px;
		width: 55%;
	}
	.b2 {
		width: 80%;
	}
	.b3 {
		height: 40px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar {
			animation: none;
		}
	}
	@media (min-width: 960px) {
		.view {
			padding: 32px 40px 24px;
		}
	}
</style>
