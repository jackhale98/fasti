<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import View from '#lib/ui/View.svelte';
	import { theme, type ThemeChoice } from '#lib/ui/theme.svelte.ts';

	const choices: { value: ThemeChoice; label: string }[] = [
		{ value: 'system', label: 'Match the system' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
</script>

<View eyebrow="Settings" title="Settings">
	<fieldset>
		<legend>Theme</legend>
		{#each choices as choice (choice.value)}
			<label>
				<input
					type="radio"
					name="theme"
					value={choice.value}
					checked={theme.choice === choice.value}
					onchange={() => theme.set(choice.value)}
				/>
				{choice.label}
			</label>
		{/each}
	</fieldset>

	<section class="about" aria-labelledby="about-h">
		<h2 id="about-h">About</h2>
		<p>
			Fasti is a web front end for Remind, Dianne Skoll's reminder language. It is not affiliated
			with or endorsed by Remind or its author. Fasti was built with AI assistance.
		</p>
		<p>
			Fasti is free software under the GNU General Public License, version 2 or later. It includes
			Remind, © 1992-2026 Dianne Skoll, under the GNU General Public License, version 2, so the site
			as a whole is conveyed under version 2.
		</p>
		<p>
			<a href="https://github.com/jackhale98/fasti">Source code</a>, including Remind's source (<code
				>engine/vendor/</code
			>), the build script and the
			<a href="https://github.com/jackhale98/fasti/blob/main/THIRD_PARTY_NOTICES.md"
				>third-party notices</a
			>.
		</p>
		{#if __APP_COMMIT__}
			<p class="build">Build {__APP_COMMIT__}, {__APP_BUILT__}</p>
		{/if}
	</section>
</View>

<style>
	.about {
		margin-top: 28px;
		color: var(--ink-2);
	}
	.about h2 {
		font-size: 13px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		margin: 0 0 8px;
	}
	.about a {
		color: var(--ledger);
	}
	.build {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	fieldset {
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 12px 16px 14px;
		background: var(--surface);
		display: grid;
		gap: 8px;
	}
	legend {
		font-weight: 700;
		padding: 0 6px;
	}
	label {
		display: flex;
		gap: 10px;
		align-items: center;
		min-height: 32px;
	}
	input {
		width: 18px;
		height: 18px;
		accent-color: var(--ledger);
	}
</style>
