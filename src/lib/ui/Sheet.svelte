<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	/**
	 * A modal on a native `<dialog>` (focus stays inside; Escape closes it):
	 * a bottom sheet on phones and a centred card from 960 px.
	 */
	let {
		open = $bindable(false),
		title,
		children,
		onclose,
		testid
	}: {
		open?: boolean;
		title: string;
		children: Snippet;
		onclose?: () => void;
		testid?: string;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function close() {
		open = false;
	}
</script>

<!-- A backdrop click is a pointer shortcut; Escape and the close button do the same. -->
<dialog
	bind:this={dialog}
	class="sheet"
	aria-labelledby="{uid}-title"
	data-testid={testid}
	onclose={() => {
		open = false;
		onclose?.();
	}}
	onclick={(event) => {
		if (event.target === dialog) close();
	}}
>
	{#if open}
		<div class="panel">
			<div class="grab" aria-hidden="true"></div>
			<div class="head">
				<h2 id="{uid}-title">{title}</h2>
				<button type="button" class="iconbtn" aria-label="Close" onclick={close}>
					<Icon name="close" size={18} stroke={2} />
				</button>
			</div>
			{@render children()}
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		margin: auto auto 0;
		width: 100%;
		max-width: 100%;
		max-height: calc(100dvh - 28px - env(safe-area-inset-top, 0px));
		padding: 0;
		border: 0;
		border-radius: 18px 18px 0 0;
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow);
		overscroll-behavior: contain;
	}
	.sheet[open] {
		animation: up 0.22s ease-out;
	}
	.sheet::backdrop {
		background: color-mix(in srgb, #000 38%, transparent);
	}
	.panel {
		padding: 10px max(18px, env(safe-area-inset-right, 0px))
			calc(24px + env(safe-area-inset-bottom, 0px)) max(18px, env(safe-area-inset-left, 0px));
	}
	.grab {
		width: 40px;
		height: 5px;
		border-radius: 3px;
		background: var(--rule);
		margin: 0 auto 10px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	h2 {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 400;
		letter-spacing: -0.01em;
		margin: 0;
	}
	.iconbtn {
		margin-left: auto;
		height: 36px;
		min-width: 36px;
		border-radius: 10px;
		border: 1px solid var(--rule);
		background: var(--surface);
		display: inline-grid;
		place-items: center;
		cursor: pointer;
	}
	@keyframes up {
		from {
			transform: translateY(24px);
			opacity: 0.4;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@media (min-width: 960px) {
		.sheet {
			margin: auto;
			width: min(600px, 92vw);
			max-height: 88vh;
			border-radius: 18px;
		}
		.panel {
			padding: 20px 24px 24px;
		}
		.grab {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet[open] {
			animation: none;
		}
	}
</style>
