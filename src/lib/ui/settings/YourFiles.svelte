<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { app } from '#lib/app/app.svelte.ts';
	import {
		SAMPLE_FILES,
		downloadZip,
		pickFiles,
		pickFolder,
		restoreSample,
		type FilePlan,
		type ImportResult
	} from '#lib/store/index.ts';
	import { toasts } from '#lib/ui/toast.svelte.ts';
	import Sheet from '#lib/ui/Sheet.svelte';

	let main = $state('');
	let paths = $state<string[]>([]);
	let busy = $state(false);
	let error = $state('');

	// The select lists the root, every directory and every file in the vault.
	const options = $derived.by(() => {
		const dirs: string[] = [];
		for (const p of paths) {
			const parts = p.split('/');
			for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
		}
		const list = [
			{ value: '', label: 'Whole vault (every .rem file)' },
			...[...new Set(dirs)]
				.sort()
				.map((d) => ({ value: d, label: `${d}/ (every .rem file in it)` })),
			...[...paths].sort().map((p) => ({ value: p, label: p }))
		];
		if (!list.some((o) => o.value === main)) list.push({ value: main, label: `${main} (missing)` });
		return list;
	});

	async function load() {
		const vault = app.vault;
		if (!vault) return;
		const [record, all] = await Promise.all([vault.record(), vault.paths()]);
		main = record.main;
		paths = all;
	}

	$effect(() => {
		void app.ready;
		void app.version;
		void load();
	});

	async function changeMain(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (!app.vault) return;
		try {
			await app.vault.setMain(value);
			main = value;
			await app.refresh();
			toasts.show(`Main entry is now ${value === '' ? 'the whole vault' : value}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const problems = $derived(app.discovery?.diagnostics ?? []);

	/* ------------------------------- import ------------------------------ */
	let importOpen = $state(false);
	let pending = $state.raw<ImportResult | null>(null);
	let plan = $state.raw<FilePlan | null>(null);
	const SKIP_WHY = {
		'not-utf8': 'not UTF-8 text',
		'too-large': 'too large',
		'invalid-path': 'not a usable file name',
		'too-many': 'too many files'
	} as const;

	async function startImport(pick: () => Promise<ImportResult | null>) {
		error = '';
		const vault = app.vault;
		if (!vault) return;
		try {
			const result = await pick();
			if (!result) return;
			pending = result;
			plan = await vault.plan(result.files);
			importOpen = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function confirmImport(replace: boolean) {
		const vault = app.vault;
		if (!vault || !pending || !plan) return;
		busy = true;
		try {
			const done = await vault.addFiles(
				pending.files,
				'Import files',
				replace ? plan.conflicts : []
			);
			await app.refresh();
			toasts.show(`Imported ${done.added.length} file${done.added.length === 1 ? '' : 's'}`, () =>
				app.undo()
			);
			importOpen = false;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/* ------------------------------- export ------------------------------ */
	async function exportZip() {
		if (!app.vault) return;
		downloadZip(await app.vault.files(), 'fasti-vault.zip');
	}

	/* -------------------------------- reset ------------------------------ */
	let resetOpen = $state(false);

	async function reset() {
		const vault = app.vault;
		if (!vault) return;
		busy = true;
		try {
			for (const p of await vault.paths()) if (!(p in SAMPLE_FILES)) await vault.removeFile(p);
			await restoreSample(vault);
			await vault.clearHistory();
			await app.refresh();
			resetOpen = false;
			toasts.show('Local data reset to the sample vault');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="card">
	<div class="field">
		<label for="main-entry">Main entry</label>
		<select id="main-entry" onchange={changeMain} aria-describedby="main-hint">
			{#each options as option (option.value)}
				<option value={option.value} selected={option.value === main}>{option.label}</option>
			{/each}
		</select>
		<p id="main-hint" class="hint">
			Remind starts here. A directory means every <code>*.rem</code> file in it, sorted by name.
		</p>
	</div>

	<div class="field">
		<h3>Files Remind reads</h3>
		{#if app.discovery && app.discovery.read.length}
			<ul data-testid="files-read">
				{#each app.discovery.read as path (path)}
					<li><code>{path}</code></li>
				{/each}
			</ul>
		{:else}
			<p class="hint">No files are read yet.</p>
		{/if}
		{#if problems.length}
			<h3>Include problems</h3>
			<ul data-testid="include-problems">
				{#each problems as d, i (i)}
					<li>
						<strong>{d.severity}</strong>
						<code>{d.path}:{d.line + 1}</code>
						{d.message}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="row">
		<button type="button" onclick={() => startImport(pickFiles)}>Import files</button>
		<button type="button" onclick={() => startImport(pickFolder)}>Import a folder</button>
		<button type="button" onclick={exportZip}>Export as zip</button>
	</div>
	{#if error}<p class="err" role="alert">{error}</p>{/if}

	<div class="field danger">
		<h3>Reset local data</h3>
		<p class="hint">Replaces everything in this browser with the sample vault.</p>
		<button type="button" class="warn" onclick={() => (resetOpen = true)}>Reset local data</button>
	</div>
</div>

<Sheet bind:open={importOpen} title="Import files" testid="import-dialog">
	{#if plan && pending}
		<div class="plan" data-testid="import-plan">
			<p>Nothing is written until you confirm.</p>
			<h3>Will be added ({plan.added.length})</h3>
			<ul>
				{#each plan.added as p (p)}<li><code>{p}</code></li>{:else}<li>None</li>{/each}
			</ul>
			<h3>Will replace a different file of the same name ({plan.conflicts.length})</h3>
			<ul>
				{#each plan.conflicts as p (p)}<li><code>{p}</code></li>{:else}<li>None</li>{/each}
			</ul>
			{#if plan.same.length}
				<p class="hint">Already identical, left alone: {plan.same.join(', ')}</p>
			{/if}
			{#if pending.skipped.length}
				<p class="hint">
					Skipped: {pending.skipped.map((s) => `${s.path} (${SKIP_WHY[s.reason]})`).join(', ')}
				</p>
			{/if}
			<p class="hint">You can undo an import from the toast right afterwards.</p>
			<div class="row">
				{#if plan.conflicts.length}
					<button type="button" class="warn" disabled={busy} onclick={() => confirmImport(true)}>
						Add and replace
					</button>
					<button type="button" disabled={busy} onclick={() => confirmImport(false)}>
						Add new files only
					</button>
				{:else}
					<button
						type="button"
						disabled={busy || !plan.added.length}
						onclick={() => confirmImport(false)}
					>
						Add files
					</button>
				{/if}
				<button type="button" onclick={() => (importOpen = false)}>Cancel</button>
			</div>
		</div>
	{/if}
</Sheet>

<Sheet bind:open={resetOpen} title="Reset local data?" testid="reset-dialog">
	<p>
		This deletes every file in this browser's vault, including your own reminders and edits, and
		puts back the sample vault. Undo history is cleared too, so this cannot be undone. Files you
		have exported or synced elsewhere are not touched. Display settings are kept.
	</p>
	<div class="row">
		<button type="button" class="warn" disabled={busy} onclick={reset}>Delete and reset</button>
		<button type="button" onclick={() => (resetOpen = false)}>Cancel</button>
	</div>
</Sheet>

<style>
	.card {
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		padding: 14px 16px;
		display: grid;
		gap: 16px;
	}
	.field {
		display: grid;
		gap: 6px;
	}
	label {
		font-weight: 700;
	}
	h3 {
		font-size: 14px;
		margin: 6px 0 0;
	}
	select {
		min-height: 44px;
		max-width: 100%;
		font: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: 10px;
		padding: 0 10px;
	}
	.hint {
		color: var(--ink-2);
		font-size: 13.5px;
		margin: 0;
		overflow-wrap: anywhere;
	}
	ul {
		margin: 0;
		padding-left: 20px;
		overflow-wrap: anywhere;
	}
	strong {
		text-transform: capitalize;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
	}
	button {
		min-height: 44px;
		padding: 0 14px;
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 10px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.warn {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-soft);
	}
	.err {
		color: var(--danger);
		margin: 0;
	}
	.danger {
		border-top: 1px solid var(--rule);
		padding-top: 12px;
	}
	.danger .warn {
		justify-self: start;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
</style>
