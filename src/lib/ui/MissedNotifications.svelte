<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * Today: the notifications that were due while Fasti was closed and never
	 * shown on this device (#lib/notify/notifications.svelte.ts finds them in
	 * the plan kept on the device). Shown once; Dismiss clears it. The dates
	 * and times are the ones Remind planned, formatted when they were planned.
	 */
	import { dayMonth, weekdayShort } from '#lib/app/format.ts';
	import { notifications as n } from '#lib/notify/notifications.svelte.ts';

	/** At most this many rows; the rest are counted. */
	const SHOWN = 8;
	const rows = $derived(n.missed.slice(0, SHOWN));
	const more = $derived(n.missed.length - rows.length);
	const when = (p: (typeof n.missed)[number]) =>
		[p.date ? `${weekdayShort(p.date)} ${dayMonth(p.date)}` : '', p.payload.due ?? '']
			.filter(Boolean)
			.join(' · ');
</script>

{#if n.missed.length}
	<section class="missed" aria-labelledby="missed-h" data-testid="missed">
		<div class="head">
			<h2 id="missed-h">Missed while Fasti was closed</h2>
			<span class="count">{n.missed.length}</span>
			<button
				type="button"
				class="dismiss"
				aria-label="Dismiss missed notifications"
				onclick={() => n.dismissMissed()}>Dismiss</button
			>
		</div>
		<ul>
			{#each rows as p (p.payload.id)}
				<li>
					<span class="title">{p.payload.title}</span>
					<span class="when">{when(p)}</span>
				</li>
			{/each}
		</ul>
		{#if more > 0}<p class="more">and {more} more</p>{/if}
	</section>
{/if}

<style>
	.missed {
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		padding: 10px 14px 12px;
		margin-bottom: 18px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
	}
	.count {
		font-size: 12px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.dismiss {
		margin-left: auto;
		min-height: 44px;
		min-width: 44px;
		padding: 0 12px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--ledger);
		font: inherit;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
	}
	.dismiss:focus-visible {
		outline: 2px solid var(--ledger);
		outline-offset: 2px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	li {
		display: grid;
		gap: 1px;
		min-width: 0;
	}
	.title {
		overflow-wrap: anywhere;
	}
	.when,
	.more {
		color: var(--ink-2);
		font-size: 13px;
	}
	.more {
		margin: 6px 0 0;
	}
</style>
