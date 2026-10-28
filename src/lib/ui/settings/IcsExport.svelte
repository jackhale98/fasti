<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { app } from '#lib/app/app.svelte.ts';
	import { exportIcs } from '#lib/export/ics.ts';

	const RANGES = [3, 6, 12, 24];

	let months = $state(12);
	let which = $state<'all' | 'pick'>('all');
	let picked = $state<string[]>([]);
	let todos = $state(true);
	let completed = $state(false);
	let busy = $state(false);
	let progress = $state('');
	let message = $state('');
	let failed = $state(false);

	const files = $derived(app.discovery?.read ?? []);
	const ready = $derived(!!app.snapshot && !!app.today);
	const canExport = $derived(ready && !busy && (which === 'all' || picked.length > 0));

	function toggle(file: string, on: boolean) {
		picked = on ? [...picked, file] : picked.filter((f) => f !== file);
	}

	async function run() {
		const vault = app.snapshot;
		const today = app.today;
		if (!vault || !today) return;
		busy = true;
		failed = false;
		message = '';
		// Remind's current month; the label is cut from the date Remind printed.
		const month = today.date.slice(0, 7);
		progress = `Month 0 of ${months}…`;
		try {
			const text = await exportIcs({
				vault,
				month,
				months,
				tz: app.tz,
				onlyFiles: which === 'pick' ? new Set(picked) : null,
				todos,
				completed: todos && completed,
				onProgress: (done, total) => (progress = `Month ${done} of ${total}…`)
			});
			const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = `fasti-${month}.ics`;
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
			const count = text.split('BEGIN:VEVENT').length - 1;
			message = `Exported ${count} event${count === 1 ? '' : 's'} to fasti-${month}.ics.`;
		} catch (e) {
			failed = true;
			message = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			busy = false;
			progress = '';
		}
	}
</script>

<div class="export">
	<label class="field">
		Range
		<select bind:value={months} disabled={busy}>
			{#each RANGES as n (n)}
				<option value={n}>{n} months</option>
			{/each}
		</select>
	</label>

	<fieldset disabled={busy}>
		<legend>Files</legend>
		<label>
			<input type="radio" name="ics-files" value="all" bind:group={which} />
			All files
		</label>
		<label>
			<input type="radio" name="ics-files" value="pick" bind:group={which} />
			Pick files
		</label>
		{#if which === 'pick'}
			<ul class="files">
				{#each files as file (file)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={picked.includes(file)}
								onchange={(e) => toggle(file, e.currentTarget.checked)}
							/>
							<span class="name">{file}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if picked.length === 0}
				<p class="hint">Pick at least one file.</p>
			{/if}
		{/if}
	</fieldset>

	<fieldset disabled={busy}>
		<legend>TODOs</legend>
		<label>
			<input type="checkbox" bind:checked={todos} />
			Include TODOs
		</label>
		<label>
			<input type="checkbox" bind:checked={completed} disabled={!todos} />
			Include completed TODOs
		</label>
	</fieldset>

	<button type="button" class="go" disabled={!canExport} onclick={run}>Export .ics</button>

	<p class="status" data-testid="ics-status" role="status" aria-live="polite" class:error={failed}>
		{progress || message}
	</p>

	<p class="note">
		The file is a snapshot of the next {months} months. To update it, export again and re-import: calendars
		that honour event IDs update the events instead of duplicating them.
	</p>
</div>

<style>
	.export {
		display: grid;
		gap: 12px;
	}
	fieldset {
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 12px 16px 14px;
		background: var(--surface);
		display: grid;
		gap: 8px;
		min-width: 0;
		margin: 0;
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
	.field {
		justify-content: space-between;
		font-weight: 700;
	}
	select {
		font: inherit;
		min-height: 44px;
		padding: 0 10px;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 10px;
	}
	input[type='radio'],
	input[type='checkbox'] {
		width: 18px;
		height: 18px;
		flex: none;
		accent-color: var(--ledger);
	}
	.files {
		list-style: none;
		margin: 0;
		padding: 0 0 0 28px;
	}
	.name {
		font-family: var(--font-mono);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.go {
		font: inherit;
		font-weight: 700;
		min-height: 44px;
		border: 0;
		border-radius: 12px;
		background: var(--ledger);
		color: var(--ledger-ink);
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	:focus-visible {
		outline: 3px solid var(--ledger);
		outline-offset: 2px;
	}
	.status {
		margin: 0;
		min-height: 1.4em;
		color: var(--ink-2);
	}
	.status.error {
		color: var(--danger);
	}
	.hint,
	.note {
		margin: 0;
		color: var(--ink-2);
	}
</style>
