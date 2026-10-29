<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * Settings → Notifications (docs/PLAN.md 3.6): turn them on or off on this
	 * device, what is scheduled, a test, iOS guidance and the honest limits.
	 * Every date shown comes from Remind (the schedule's last covered day).
	 */
	import { onMount } from 'svelte';
	import { longDate } from '#lib/app/format.ts';
	import { notifications as n } from '#lib/notify/notifications.svelte.ts';

	onMount(() => {
		n.start();
		if (typeof Notification !== 'undefined') n.permission = Notification.permission;
	});

	const blocked = $derived(n.permission === 'denied');
	const through = $derived(n.push?.through ?? null);
</script>

<div class="notify">
	{#if n.support === 'ios-browser'}
		<div class="card" data-testid="ios-guidance">
			<p class="lead">
				On iPhone and iPad, notifications work only when Fasti is added to the Home Screen.
			</p>
			<ol>
				<li>Open Fasti in Safari and tap the Share button.</li>
				<li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
				<li>Open Fasti from the Home Screen and turn on notifications here.</li>
			</ol>
		</div>
	{:else if n.support === 'none'}
		<p class="card">This browser can’t show notifications.</p>
	{:else}
		<div class="card">
			<div class="row">
				<div>
					<p class="lead" id="notify-state">
						{#if n.active}
							Notifications are on for this device.
						{:else if blocked}
							Notifications are blocked for Fasti in this browser.
						{:else}
							Notifications are off.
						{/if}
					</p>
					{#if n.active}
						<p class="status" data-testid="notify-status">
							{#if n.pushConfigured && through}
								Notifications scheduled through {longDate(through)}.
								{#if n.push?.truncated}
									Not everything fit; Fasti adds the rest when it opens again.
								{/if}
							{:else if n.pushConfigured && n.push}
								Scheduling…
							{:else}
								{n.pending === 1
									? '1 more notification today'
									: `${n.pending} more notifications today`} while Fasti is open.
							{/if}
						</p>
					{/if}
				</div>
				{#if n.active}
					<button type="button" class="btn" disabled={n.busy} onclick={() => n.disable()}>
						Turn off
					</button>
				{:else}
					<button
						type="button"
						class="btn primary"
						disabled={n.busy || blocked}
						onclick={() => n.enable()}
					>
						Turn on notifications
					</button>
				{/if}
			</div>

			{#if blocked}
				<p class="hint">
					Allow notifications for this site in the browser’s settings, then reload.
				</p>
			{/if}

			<div class="btns">
				<button type="button" class="btn" disabled={!n.active || n.busy} onclick={() => n.test()}>
					Send a test notification
				</button>
			</div>

			<div class="live" role="status" aria-live="polite">
				{#if n.note}<p class="ok">{n.note}</p>{/if}
				{#if n.error}<p class="err">{n.error}</p>{/if}
			</div>
		</div>

		{#if !n.pushConfigured}
			<p class="hint" data-testid="push-not-configured">
				Push isn’t set up for this copy of Fasti, so notifications only work while Fasti is open.
			</p>
		{/if}
	{/if}

	<div class="limits">
		<p class="lead">What to expect</p>
		<ul>
			{#if n.pushConfigured}
				<li>
					The schedule covers 30 days from the last time Fasti was opened on this device. If it
					isn’t opened for a while, a notification the day before the schedule runs out asks you to
					open it.
				</li>
				<li>
					Edits made on another device, or a time zone change, take effect the next time Fasti is
					opened here.
				</li>
			{:else}
				<li>Notifications are shown only while Fasti is open in a tab or window.</li>
			{/if}
			<li>
				Battery savers, Focus and Low Power Mode can delay notifications. One that arrives more than
				5 minutes late says when it was due.
			</li>
			<li>Notifications missed while Fasti was closed are listed on Today when it opens.</li>
			<li>
				Times follow Remind: AT reminders, including their +tdelta and *trepeat warnings; NOQUEUE
				reminders don’t notify.
			</li>
		</ul>
	</div>
</div>

<style>
	.notify {
		display: grid;
		gap: 10px;
	}
	.card {
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 12px 16px 14px;
		background: var(--surface);
		display: grid;
		gap: 10px;
		margin: 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: center;
		justify-content: space-between;
	}
	.lead {
		font-weight: 700;
		margin: 0;
	}
	.status,
	.hint {
		margin: 4px 0 0;
		color: var(--ink-2);
	}
	ol,
	ul {
		margin: 0;
		padding-left: 22px;
		display: grid;
		gap: 4px;
	}
	.limits {
		color: var(--ink-2);
		display: grid;
		gap: 6px;
	}
	.limits .lead {
		color: var(--ink);
	}
	.live p {
		margin: 0;
	}
	.ok {
		color: var(--ink);
	}
	.err {
		color: var(--danger);
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
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn:focus-visible {
		outline: 2px solid var(--ledger);
		outline-offset: 2px;
	}
</style>
