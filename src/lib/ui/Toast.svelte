<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { toasts } from './toast.svelte.ts';
</script>

<div class="root" role="status" aria-live="polite">
	{#if toasts.current}
		<div class="toast">
			<span>{toasts.current.text}</span>
			{#if toasts.current.undo}
				<button type="button" onclick={() => toasts.runUndo()}>Undo</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.root {
		position: fixed;
		z-index: 30;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(var(--tabbar-h) + 84px + env(safe-area-inset-bottom, 0px));
		max-width: calc(100% - 32px);
	}
	.toast {
		background: var(--ink);
		color: var(--paper);
		border-radius: 12px;
		padding: 10px 12px 10px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 14px;
		box-shadow: var(--shadow);
	}
	button {
		border: 0;
		background: none;
		color: var(--mark);
		font-weight: 700;
		padding: 4px 6px;
		cursor: pointer;
	}
	@media (min-width: 960px) {
		.root {
			bottom: 28px;
		}
	}
</style>
