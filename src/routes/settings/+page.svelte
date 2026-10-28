<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import View from '#lib/ui/View.svelte';
	import YourFiles from '#lib/ui/settings/YourFiles.svelte';
	import Display from '#lib/ui/settings/Display.svelte';
	import Notifications from '#lib/ui/settings/Notifications.svelte';
	import IcsExport from '#lib/ui/settings/IcsExport.svelte';
</script>

<View eyebrow="Settings" title="Settings">
	<section class="block first" aria-labelledby="files-h">
		<h2 id="files-h">Your files</h2>
		<YourFiles />
	</section>

	<section class="block" aria-labelledby="display-h">
		<h2 id="display-h">Display</h2>
		<Display />
	</section>

	<section class="block" aria-labelledby="notify-h">
		<h2 id="notify-h">Notifications</h2>
		<Notifications />
	</section>

	<section class="block" aria-labelledby="ics-h">
		<h2 id="ics-h">Calendar export</h2>
		<IcsExport />
	</section>

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
	.block {
		margin-top: 28px;
	}
	.first {
		margin-top: 0;
	}
	.block h2 {
		font-size: 13px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		margin: 0 0 8px;
	}
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
</style>
