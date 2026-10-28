<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	let { tagline = false }: { tagline?: boolean } = $props();
</script>

<span class="brand">
	<!-- Fasti's mark (static/favicon.svg): F for fastus, and today's yellow square. -->
	<svg class="mark" viewBox="0 0 100 100" aria-hidden="true">
		<rect width="100" height="100" rx="23" fill="#1e5b49" />
		<path
			fill="#f2f4f1"
			d="M27 22 H71 V37 H67 Q65.5 31.5 59 31.5 H42.5 V45 H55 Q58.5 45 59.5 41.5 H62.5 V57.5 H59.5 Q58.5 54 55 54 H42.5 V71 Q42.5 74 46 74.5 L49 75 V78 H27 V75 L29 74.5 Q31 74 31 71 V29 Q31 26 29 25.5 L27 25 Z"
		/>
		<rect x="56" y="64" width="14" height="14" rx="3.5" fill="#f3d04a" />
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
		width: 24px;
		height: 24px;
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
