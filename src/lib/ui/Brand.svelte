<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	let { tagline = false }: { tagline?: boolean } = $props();
</script>

<span class="brand">
	<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
		<rect
			x="3"
			y="4"
			width="18"
			height="17"
			rx="3"
			fill="none"
			stroke="var(--ledger)"
			stroke-width="1.8"
		/>
		<path d="M3 9h18" stroke="var(--ledger)" stroke-width="1.8" />
		<rect x="7" y="12.5" width="4" height="4" rx="1" fill="var(--mark)" />
	</svg>
	<span class="words">
		Fasti
		{#if tagline}<small>A front end for Remind</small>{/if}
	</span>
</span>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-size: 22px;
		letter-spacing: -0.01em;
		line-height: 1;
		color: var(--ink);
	}
	.mark {
		width: 22px;
		height: 22px;
		flex: none;
	}
	.words {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	small {
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--ink-3);
		letter-spacing: 0.02em;
	}
</style>
