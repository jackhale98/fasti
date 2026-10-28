<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { app } from '#lib/app/app.svelte.ts';
	import type { Clock, Theme, WeekStart } from '#lib/store/index.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';

	const weekChoices: { value: WeekStart; label: string }[] = [
		{ value: 'sunday', label: 'Sunday' },
		{ value: 'monday', label: 'Monday' }
	];
	const clockChoices: { value: Clock; label: string }[] = [
		{ value: '12h', label: '12-hour (2:00pm)' },
		{ value: '24h', label: '24-hour (14:00)' }
	];
	const themeChoices: { value: Theme; label: string }[] = [
		{ value: 'system', label: 'Match the system' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];

	function setTheme(value: Theme) {
		theme.set(value);
		void app.setSettings({ theme: value });
	}
</script>

<!-- Disabled until the saved settings load: a choice made over the defaults would be lost. -->

<fieldset disabled={!app.settingsLoaded}>
	<legend>Week starts on</legend>
	{#each weekChoices as c (c.value)}
		<label>
			<input
				type="radio"
				name="week-start"
				value={c.value}
				checked={app.settings.weekStart === c.value}
				onchange={() => app.setSettings({ weekStart: c.value })}
			/>
			{c.label}
		</label>
	{/each}
</fieldset>

<fieldset disabled={!app.settingsLoaded}>
	<legend>Times</legend>
	{#each clockChoices as c (c.value)}
		<label>
			<input
				type="radio"
				name="clock"
				value={c.value}
				checked={app.settings.clock === c.value}
				onchange={() => app.setSettings({ clock: c.value })}
			/>
			{c.label}
		</label>
	{/each}
</fieldset>

<fieldset disabled={!app.settingsLoaded}>
	<legend>Tasks</legend>
	<label>
		<input
			type="checkbox"
			checked={app.settings.hideCompletedTodos}
			onchange={(e) => app.setSettings({ hideCompletedTodos: e.currentTarget.checked })}
		/>
		Hide completed TODOs
	</label>
</fieldset>

<fieldset>
	<legend>Theme</legend>
	{#each themeChoices as c (c.value)}
		<label>
			<input
				type="radio"
				name="theme"
				value={c.value}
				checked={theme.choice === c.value}
				onchange={() => setTheme(c.value)}
			/>
			{c.label}
		</label>
	{/each}
</fieldset>

<style>
	fieldset {
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 12px 16px 14px;
		background: var(--surface);
		display: grid;
		gap: 8px;
		margin: 0 0 12px;
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
