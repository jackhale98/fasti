<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A titled group of rows with a count. `id` names the heading for the region. */
	let {
		id,
		title,
		count,
		children
	}: { id: string; title: string; count?: number; children: Snippet } = $props();
</script>

<section class="sec" aria-labelledby="{id}-h">
	<div class="sec-h">
		<h2 id="{id}-h">{title}</h2>
		{#if count}<span class="count" aria-label="{count} items">{count}</span>{/if}
	</div>
	{@render children()}
</section>

<style>
	.sec {
		margin-top: 26px;
	}
	.sec-h {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 6px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
	}
	.count {
		font-size: 12px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
</style>
