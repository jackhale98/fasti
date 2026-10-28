<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	/** The page frame every view uses: eyebrow, display heading, lede, content. */
	let {
		eyebrow,
		title,
		lede,
		children
	}: { eyebrow?: string; title: string; lede?: string; children?: Snippet } = $props();
</script>

<svelte:head>
	<title>{title === 'Fasti' ? 'Fasti' : `${title} · Fasti`}</title>
</svelte:head>

<div class="view">
	<header>
		{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
		<h1 class="display">{title}</h1>
		{#if lede}<p class="lede">{lede}</p>{/if}
	</header>
	{@render children?.()}
</div>

<style>
	.view {
		max-width: 760px;
		margin: 0 auto;
		padding: 20px max(16px, env(safe-area-inset-right, 0px)) 8px
			max(16px, env(safe-area-inset-left, 0px));
	}
	header {
		margin-bottom: 22px;
	}
	.eyebrow {
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-3);
		margin: 0;
	}
	.display {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(34px, 9vw, 48px);
		line-height: 1.02;
		letter-spacing: -0.015em;
		margin: 4px 0 0;
		text-wrap: balance;
	}
	.lede {
		color: var(--ink-2);
		margin: 6px 0 0;
	}
	@media (min-width: 960px) {
		.view {
			padding: 32px 40px 24px;
		}
	}
</style>
