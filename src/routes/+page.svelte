<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	// Phase 0 placeholder. The app shell (Today, Month, Script, Sync, Settings) arrives in Phase 3.
</script>

<svelte:head>
	<title>Fasti</title>
</svelte:head>

<main>
	<h1 class="brand">
		<svg viewBox="0 0 24 24" aria-hidden="true">
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
		Fasti
	</h1>
	<p class="lede">A web front end for Remind, the plain-text reminder language.</p>
	<p>Fasti is being built. Nothing here reads or changes your files yet.</p>
	<p class="small">
		Fasti is not affiliated with or endorsed by Remind or its author. It is free software under the
		GNU General Public License, version 2 or later, and was built with AI assistance.
	</p>
</main>

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 48px max(16px, env(safe-area-inset-left, 0px)) 32px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(34px, 9vw, 48px);
		letter-spacing: -0.015em;
		margin: 0;
	}
	.brand svg {
		width: 0.8em;
		height: 0.8em;
		flex: none;
	}
	.lede {
		color: var(--ink-2);
		font-size: 17px;
	}
	.small {
		color: var(--ink-2);
		font-size: 13px;
	}
</style>
