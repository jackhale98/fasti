<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import View from '#lib/ui/View.svelte';
	import ScriptEditor, { type Problem } from '#lib/ui/script/ScriptEditor.svelte';
	import LineInspector from '#lib/ui/script/LineInspector.svelte';
	import { app } from '#lib/app/app.svelte.ts';
	import { debounce, diagnostics } from '#lib/engine/client.ts';
	import type { Diagnostic, VaultPath } from '#lib/engine/types.ts';
	import { shell } from '#lib/ui/shell.svelte.ts';
	import { textInfo } from '#lib/store/text.ts';

	const KEYS = [
		'REM',
		'MSG',
		'AT',
		'TODO',
		'SKIP',
		'AFTER',
		'+3',
		'*7',
		'%b',
		'OMIT',
		'DURATION',
		'UNTIL'
	];

	/** Every file of the vault, the main one first. */
	const files = $derived.by(() => {
		const snap = app.snapshot;
		if (!snap) return [] as VaultPath[];
		return Object.keys(snap.files).sort(
			(a, b) => Number(b === snap.main) - Number(a === snap.main) || a.localeCompare(b)
		);
	});

	let chosen = $state<VaultPath | null>(null);
	const active = $derived(chosen && files.includes(chosen) ? chosen : (files[0] ?? null));

	let caret = $state(1);
	let editor: ScriptEditor | undefined = $state();

	/* ---- tab marks ---- */
	let synced = $state(new Map<VaultPath, string>());
	$effect(() => {
		void app.version;
		const vault = app.vault;
		if (!vault) return;
		void vault.bases().then((b) => {
			synced = new Map([...b].map(([p, v]) => [p, v.source]));
		});
	});
	const changed = (p: VaultPath) => {
		const base = synced.get(p);
		return base !== undefined && base !== app.text(p);
	};
	const unread = (p: VaultPath) => !!app.discovery && !app.discovery.read.includes(p);

	/* ---- diagnostics from the engine ---- */
	let found = $state<Diagnostic[]>([]);
	let askFailed = $state(false);
	let seq = 0;
	const ask = debounce(() => {
		const snapshot = $state.snapshot(app.snapshot);
		if (!snapshot) return;
		const mine = ++seq;
		diagnostics(snapshot, { tz: app.tz }, { view: 'script-diagnostics' })
			.then((d) => {
				if (mine !== seq) return;
				found = d;
				askFailed = false;
			})
			.catch(() => {
				if (mine === seq) askFailed = true;
			});
	}, 200);
	$effect(() => {
		void app.version;
		untrack(() => ask());
	});
	$effect(() => () => ask.cancel());

	const problems = $derived<Problem[]>(
		found
			.filter((d) => d.file === active && d.line !== null)
			.map((d) => ({ line: d.line as number, message: d.message, warning: d.warning }))
	);
	const countFor = (p: VaultPath) => found.filter((d) => d.file === p).length;
	const elsewhere = $derived(found.filter((d) => d.file !== active));

	/* ---- status ---- */
	const info = $derived.by(() => {
		void app.version;
		const text = active ? app.text(active) : null;
		return text === null ? null : { ...textInfo(text), lines: text.split('\n').length };
	});
	const eolName = (e: string) => (e === 'none' ? 'single line' : e);

	/* ---- tabs: arrow keys move between them ---- */
	function onTabKey(e: KeyboardEvent, i: number) {
		const to =
			e.key === 'ArrowRight'
				? (i + 1) % files.length
				: e.key === 'ArrowLeft'
					? (i - 1 + files.length) % files.length
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? files.length - 1
							: -1;
		if (to < 0) return;
		e.preventDefault();
		choose(files[to]!);
		queueMicrotask(() => document.getElementById(tabId(files[to]!))?.focus());
	}
	const tabId = (p: string) => `script-tab-${p.replace(/[^\w-]/g, '_')}`;
	async function choose(p: VaultPath) {
		await editor?.flush();
		chosen = p;
	}

	/* ---- the inspector: inline on phones, in the panel on desktop ---- */
	let desktop = $state(false);
	onMount(() => {
		const mq = matchMedia('(min-width: 960px)');
		desktop = mq.matches;
		const change = () => (desktop = mq.matches);
		mq.addEventListener('change', change);
		return () => mq.removeEventListener('change', change);
	});
	$effect(() => {
		shell.panel = panel;
		return () => {
			shell.panel = null;
		};
	});
</script>

{#snippet inspector()}
	{#if active}<LineInspector path={active} line={caret} />{/if}
{/snippet}

{#snippet panel()}
	{#if desktop}<div class="panel-insp">{@render inspector()}</div>{/if}
{/snippet}

<View
	eyebrow="Script"
	title="Script"
	lede="The file itself. Every change is a small text edit, so formatting and comments stay exactly as you wrote them."
>
	{#if !app.ready}
		<p class="status">{app.error ?? 'Opening your files…'}</p>
	{:else if active}
		<div class="filetabs" role="tablist" aria-label="Files">
			{#each files as p, i (p)}
				<button
					type="button"
					role="tab"
					id={tabId(p)}
					class="filetab"
					class:unread={unread(p)}
					aria-selected={p === active}
					aria-controls="script-panel"
					tabindex={p === active ? 0 : -1}
					onclick={() => choose(p)}
					onkeydown={(e) => onTabKey(e, i)}
				>
					{p}
					{#if changed(p)}<i aria-hidden="true" title="Changed since last sync"></i><span class="vh"
							>(changed since last sync)</span
						>{/if}
					{#if unread(p)}<span class="vh">(not read by Remind)</span>{/if}
					{#if countFor(p)}<b class="count"
							>{countFor(p)}<span class="vh"> problem{countFor(p) === 1 ? '' : 's'}</span></b
						>{/if}
				</button>
			{/each}
		</div>

		<div class="keys" role="group" aria-label="Insert at the cursor">
			{#each KEYS as k (k)}
				<button
					type="button"
					class="key"
					aria-label={`Insert ${k}`}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => editor?.insert(k)}>{k}</button
				>
			{/each}
		</div>

		<div id="script-panel" role="tabpanel" aria-labelledby={tabId(active)}>
			<ScriptEditor
				bind:this={editor}
				path={active}
				label={`Editing ${active}`}
				{problems}
				oncaret={(l) => (caret = l)}
			/>
		</div>

		<p class="statusline" role="status">
			{#if info}
				<span><b>{info.lines}</b> line{info.lines === 1 ? '' : 's'}</span>
				<span>Line endings kept: <b>{eolName(info.eol)}</b></span>
				{#if !info.finalNewline}<span>No final newline</span>{/if}
			{/if}
			{#if unread(active)}<span>Remind does not read this file: nothing includes it.</span>{/if}
			<span
				>{problems.length
					? `${problems.length} problem${problems.length === 1 ? '' : 's'} in this file`
					: askFailed
						? 'Remind did not answer'
						: 'No problems'}</span
			>
		</p>

		{#if problems.length}
			<section class="problems" aria-label="Problems">
				<ul>
					{#each problems as p, i (i)}
						<li>
							<button
								type="button"
								class="problem"
								class:warn={p.warning}
								onclick={() => editor?.jump(p.line)}
							>
								<b>Line {p.line}</b>
								{p.warning ? 'Warning: ' : ''}{p.message}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if elsewhere.length}
			<p class="statusline">
				{elsewhere.length} more problem{elsewhere.length === 1 ? '' : 's'} in other files.
			</p>
		{/if}

		{#if !desktop}
			<div class="inspector card">{@render inspector()}</div>
		{/if}
	{:else}
		<p class="status">There are no files yet.</p>
	{/if}
</View>

<style>
	.status {
		color: var(--ink-2);
	}
	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.filetabs {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 2px;
		margin: 0 0 10px;
		scrollbar-width: none;
	}
	.filetab {
		flex: none;
		min-height: 36px;
		padding: 0 12px;
		border-radius: 9px;
		border: 1px solid var(--rule);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: 12.5px;
		color: var(--ink-2);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		position: relative;
	}
	.filetab.unread {
		border-style: dashed;
	}
	.filetab[aria-selected='true'] {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}
	.filetab:focus-visible,
	.key:focus-visible,
	.problem:focus-visible {
		outline: 2px solid var(--ledger);
		outline-offset: 2px;
	}
	.filetab i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--mark);
	}
	.count {
		font-weight: 700;
		font-size: 11px;
		border-radius: 999px;
		padding: 1px 6px;
		background: var(--danger-soft);
		color: var(--danger);
	}
	.keys {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
		margin-bottom: 8px;
	}
	.key {
		flex: none;
		min-height: 36px;
		padding: 0 12px;
		border-radius: 8px;
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 12.5px;
		cursor: pointer;
	}
	.statusline {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 12.5px;
		color: var(--ink-2);
		margin: 8px 2px 0;
	}
	.statusline b {
		font-weight: 600;
	}
	.problems {
		margin-top: 14px;
	}
	.problems ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.problem {
		width: 100%;
		text-align: left;
		border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--rule));
		background: var(--danger-soft);
		color: var(--ink);
		border-radius: 10px;
		padding: 9px 12px;
		font-size: 13.5px;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.problem.warn {
		border-color: var(--rule);
		background: var(--sunk);
	}
	.problem b {
		font-family: var(--font-mono);
		font-weight: 400;
		font-size: 12px;
		margin-right: 6px;
	}
	.inspector {
		margin-top: 18px;
		padding: 14px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 12px;
	}
</style>
