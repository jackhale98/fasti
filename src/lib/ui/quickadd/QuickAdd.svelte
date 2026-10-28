<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	/**
	 * Quick add (docs/PLAN.md section 4): one plain-language field, the REM
	 * line it makes (with syntax colours), what it means, the next dates from
	 * Remind with the line appended to the chosen file, an Adjust panel and a
	 * file picker. The Add button is enabled only when Remind accepts the line
	 * with no diagnostics (the agreement check).
	 *
	 * Dates shown here come from the engine. The lens turns words into a date
	 * literal for the new line (src/lib/lens/quickadd.ts); nothing here
	 * computes when a reminder fires.
	 */
	import { onMount } from 'svelte';
	import { app } from '#lib/app/app.svelte.ts';
	import { duration as fmtDuration, longDate, time as fmtTime } from '#lib/app/format.ts';
	import { debounce, EngineAbortError, nextDates } from '#lib/engine/client.ts';
	import type { NextDatesResult, VaultSnapshot } from '#lib/engine/types.ts';
	import { explainLine } from '#lib/lens/explain.ts';
	import { appendLines } from '#lib/lens/patch.ts';
	import {
		blank,
		MAX_YEAR,
		MIN_YEAR,
		parse,
		toRem,
		type QuickKind,
		type QuickModel,
		type Ymd
	} from '#lib/lens/quickadd.ts';
	import { analyze, segments } from '#lib/lens/tokenize.ts';

	let { onadded }: { onadded?: () => void } = $props();

	const uid = $props.id();
	const id = (name: string) => `${uid}-${name}`;

	const KINDS: [QuickKind, string][] = [
		['once', 'Once'],
		['daily', 'Every day'],
		['weekly', 'Weekly'],
		['monthly-day', 'Monthly, on a date'],
		['monthly-nth', 'Monthly, on a weekday'],
		['monthly-last', 'Last day of the month'],
		['monthly-lastwork', 'Last working day'],
		['yearly', 'Yearly'],
		['interval', 'Every N days']
	];
	const WEEKDAYS: [number, string, string][] = [
		[1, 'Monday', 'Mo'],
		[2, 'Tuesday', 'Tu'],
		[3, 'Wednesday', 'We'],
		[4, 'Thursday', 'Th'],
		[5, 'Friday', 'Fr'],
		[6, 'Saturday', 'Sa'],
		[0, 'Sunday', 'Su']
	];
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const OMIT_MODES: [QuickModel['omitMode'], string][] = [
		['', 'Keep'],
		['SKIP', 'Skip'],
		['BEFORE', 'Day before'],
		['AFTER', 'Day after']
	];
	const DURATIONS: [number, string][] = [
		[0, 'None'],
		[15, '15 min'],
		[30, '30 min'],
		[45, '45 min'],
		[60, '1 hour'],
		[90, '1½ hours'],
		[120, '2 hours'],
		[180, '3 hours']
	];
	const MIN_DATE = `${MIN_YEAR}-01-01`;
	const MAX_DATE = `${MAX_YEAR}-12-31`;

	const isRaw = (t: string) => /^\s*(REM|OMIT)\b/i.test(t);
	const p2 = (n: number) => String(n).padStart(2, '0');
	const isoOf = (d: Ymd) => `${d.y}-${p2(d.m)}-${p2(d.d)}`;
	const ymdOf = (s: string): Ymd | null => {
		const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
		return r ? { y: +r[1]!, m: +r[2]!, d: +r[3]! } : null;
	};
	const hhmm = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;

	// Remind's own today, as the date literal the parser wants.
	const today = $derived(app.today ? ymdOf(app.today.date) : null);

	let text = $state('');
	let model = $state<QuickModel | null>(null);
	let file = $state('');
	let touched = $state(false);
	let adding = $state(false);
	let input = $state<HTMLInputElement>();

	$effect(() => {
		if (!model && today) model = text.trim() && !isRaw(text) ? parse(text, today) : blank(today);
	});
	$effect(() => {
		if (!file && app.snapshot) {
			const files = Object.keys(app.snapshot.files);
			file = files.includes(app.snapshot.main) ? app.snapshot.main : (files.sort()[0] ?? '');
		}
	});
	onMount(() => {
		// The sheet opens its dialog after this mounts.
		const t = setTimeout(() => input?.focus(), 30);
		return () => clearTimeout(t);
	});

	const files = $derived(Object.keys(app.snapshot?.files ?? {}).sort());
	const raw = $derived(isRaw(text));
	const line = $derived.by(() => {
		if (!model || !today) return '';
		if (raw) return text.trim();
		return text.trim() || touched ? toRem(model, today) : '';
	});
	const parsed = $derived(line ? analyze(line).find((l) => l.kind !== 'blank') : undefined);
	const parts = $derived(
		parsed
			? segments(parsed).map((s) => ({ role: s.role, text: parsed.raw.slice(s.from, s.to) }))
			: []
	);
	const explanation = $derived(parsed ? explainLine(parsed) : []);
	const refused = $derived(!raw && !!model?.refused?.length ? model.refused : []);
	const needsMessage = $derived(!raw && !!line && !model?.msg);

	// The agreement check: Remind reads the line appended to the target file.
	interface Check {
		key: string;
		result?: NextDatesResult;
		error?: string;
	}
	let check = $state<Check | null>(null);
	const key = $derived(`${file}\u0000${line}\u0000${app.snapshot?.hash ?? ''}`);
	const current = $derived(check?.key === key ? check : null);
	// A result for older text stays on screen, marked as updating, until the new one lands.
	const stale = $derived(!!line && !!check && !current);
	const shownDiagnostics = $derived(check?.result?.diagnostics ?? []);

	function fnv(s: string): string {
		let h = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
		return (h >>> 0).toString(16).padStart(8, '0');
	}

	/** A copy of the snapshot with `line` appended to `path`, and the line's number there. */
	function withLine(snap: VaultSnapshot, path: string, newLine: string) {
		const patch = appendLines(snap.files[path] ?? '', newLine);
		const lineNo = patch.text.replace(/\r?\n$/, '').split('\n').length;
		const scratch: VaultSnapshot = {
			...snap,
			files: { ...snap.files, [path]: patch.text },
			hash: `${snap.hash}+${fnv(path + '\u0000' + newLine)}`
		};
		return { scratch, lineNo };
	}

	const run = debounce(
		async (k: string, snap: VaultSnapshot, path: string, newLine: string, signal: AbortSignal) => {
			try {
				const { scratch, lineNo } = withLine(snap, path, newLine);
				const result = await nextDates(
					scratch,
					{ file: path, line: lineNo, count: 5, tz: app.tz },
					{ view: 'quickadd', signal }
				);
				if (!signal.aborted) check = { key: k, result };
			} catch (e) {
				if (signal.aborted || e instanceof EngineAbortError) return;
				check = { key: k, error: e instanceof Error ? e.message : String(e) };
			}
		},
		120
	);
	$effect(() => {
		const snap = app.snapshot;
		if (!snap || !file || !line) return;
		const ctl = new AbortController();
		run(key, snap, file, line, ctl.signal);
		return () => {
			run.cancel();
			ctl.abort();
		};
	});

	const diagnostics = $derived(current?.result?.diagnostics ?? []);
	const accepted = $derived(
		!!current?.result && diagnostics.length === 0 && !needsMessage && refused.length === 0
	);
	const canAdd = $derived(accepted && !adding);

	function oninput(event: Event & { currentTarget: HTMLInputElement }) {
		if (!today) return;
		const value = event.currentTarget.value;
		if (!isRaw(value)) model = parse(value, today);
	}
	function change(fn: (m: QuickModel) => void) {
		if (!model) return;
		touched = true;
		fn(model);
	}
	function setDate(value: string, apply: (d: Ymd) => void) {
		const d = ymdOf(value);
		if (!d) return;
		change((m) => {
			apply(d);
			// A date picked by hand settles a date the words could not give.
			m.refused = undefined;
		});
	}
	function setKind(kind: QuickKind) {
		change((m) => {
			m.kind = kind;
			if (kind === 'weekly' && !m.wds.length) m.wds = [1];
			if (kind === 'yearly') {
				m.day = m.date.d;
				m.month = m.date.m;
			}
			if (kind === 'monthly-day') m.day = m.date.d;
		});
	}
	function toggleWeekday(w: number) {
		change((m) => {
			m.wds = m.wds.includes(w) ? m.wds.filter((x) => x !== w) : [...m.wds, w];
		});
	}
	const clampInt = (v: string, lo: number, hi: number) =>
		Math.min(hi, Math.max(lo, Math.trunc(+v) || lo));

	async function add() {
		if (!canAdd) return;
		adding = true;
		try {
			if (await app.append(file, line)) onadded?.();
		} finally {
			adding = false;
		}
	}
	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			void add();
		}
	}

	const durationOptions = $derived.by(() => {
		const d = model?.duration;
		return d && !DURATIONS.some(([v]) => v === d)
			? [...DURATIONS, [d, fmtDuration(d)] as [number, string]]
			: DURATIONS;
	});
	const roleClass = (role: string) => (role === 'plain' ? '' : `sx-${role}`);
</script>

<div class="qa">
	<label class="vh" for={id('text')}>Describe the reminder</label>
	<input
		bind:this={input}
		class="field"
		id={id('text')}
		type="text"
		bind:value={text}
		{oninput}
		{onkeydown}
		placeholder="Dentist next Thu 3:30pm, warn me 3 days before"
		autocomplete="off"
		autocapitalize="sentences"
		spellcheck="true"
		aria-describedby={id('hint')}
	/>
	<p class="hint" id={id('hint')}>
		{#if raw}
			Raw mode: your REM or OMIT line is added exactly as written.
		{:else}
			Write it the way you'd say it, or type a REM line directly.
		{/if}
	</p>

	<div class="result" aria-live="polite" aria-busy={stale}>
		{#if line}
			<pre
				class="remline"
				data-testid="remline"
				aria-label="The REM line">{#each parts as part, i (i)}<span class={roleClass(part.role)}
						>{part.text}</span
					>{/each}</pre>
			<ul class="explain">
				{#each explanation as sentence, i (i)}<li>{sentence}</li>{/each}
			</ul>
			<!-- One reserved line for the notes, so a message appearing never shifts what follows. -->
			<div class="notes">
				{#if refused.length}
					<p class="problem" data-testid="refused">
						{#each refused as r, i (r)}{i ? ' ' : ''}I couldn't read '{r}' as a date.{/each}
						Fix it above, or pick a date under Adjust.
					</p>
				{:else if needsMessage}
					<p class="note">Add a message to finish.</p>
				{/if}
			</div>
			<!-- The previous result stays up (dimmed) while the engine works on the new text. -->
			<div class="check" class:stale data-testid="check" data-stale={stale}>
				{#if !check}
					<div class="nextdates" data-testid="nextdates-placeholder">
						<div class="ndhead"><h3 class="eyebrow">Next dates</h3></div>
						<p class="note">Asking Remind…</p>
					</div>
				{:else if check.error}
					<p class="problem">Remind couldn't check this line: {check.error}</p>
				{:else if check.result}
					{#if shownDiagnostics.length}
						<ul class="problems" data-testid="diagnostics">
							{#each shownDiagnostics as d, i (i)}
								<li class="problem">{d.message}</li>
							{/each}
						</ul>
					{:else if !check.result.reached}
						<p class="note">
							Remind doesn't reach the end of {file}, so this line would never run.
						</p>
					{:else}
						<div class="nextdates" data-testid="nextdates">
							<div class="ndhead">
								<h3 class="eyebrow">Next dates</h3>
								<span class="upd" class:on={stale} data-testid="updating">Updating…</span>
							</div>
							{#if check.result.dates.length}
								<ul class="dates">
									{#each check.result.dates as occurrence, i (occurrence.date + occurrence.time)}
										<li class:first={i === 0}>
											{longDate(occurrence.date)}{occurrence.time != null
												? ` · ${fmtTime(occurrence.time, app.settings.clock)}`
												: ''}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="note">Remind finds no upcoming date for this line.</p>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		{:else}
			<p class="note">The REM line and its next dates appear here.</p>
		{/if}
	</div>

	{#if !raw && model}
		<details class="tune">
			<summary>Adjust</summary>
			<div class="form">
				<div class="row">
					<label for={id('msg')}>Message</label>
					<input
						id={id('msg')}
						type="text"
						value={model.msg}
						oninput={(e) => change((m) => (m.msg = e.currentTarget.value))}
						placeholder="What to remind you of"
						{onkeydown}
					/>
				</div>
				<div class="row">
					<label for={id('kind')}>Repeats</label>
					<select
						id={id('kind')}
						value={model.kind}
						onchange={(e) => setKind(e.currentTarget.value as QuickKind)}
					>
						{#each KINDS as [value, label] (value)}<option {value}>{label}</option>{/each}
					</select>
				</div>
				{#if model.kind === 'once'}
					<div class="row">
						<label for={id('date')}>Date</label>
						<input
							id={id('date')}
							type="date"
							min={MIN_DATE}
							max={MAX_DATE}
							value={isoOf(model.date)}
							onchange={(e) =>
								setDate(e.currentTarget.value, (d) => {
									if (model) model.date = d;
								})}
						/>
					</div>
				{:else if model.kind === 'weekly'}
					<div class="row">
						<span class="lab" id={id('wd')}>On</span>
						<div class="seg wd" role="group" aria-labelledby={id('wd')}>
							{#each WEEKDAYS as [w, name, short] (w)}
								<button
									type="button"
									aria-pressed={model.wds.includes(w)}
									aria-label={name}
									onclick={() => toggleWeekday(w)}>{short}</button
								>
							{/each}
						</div>
					</div>
				{:else if model.kind === 'monthly-day'}
					<div class="row">
						<label for={id('day')}>Day of the month</label>
						<input
							id={id('day')}
							type="number"
							min="1"
							max="31"
							value={model.day}
							oninput={(e) => change((m) => (m.day = clampInt(e.currentTarget.value, 1, 31)))}
						/>
					</div>
				{:else if model.kind === 'monthly-nth'}
					<div class="row">
						<span class="lab">The</span>
						<div class="inline">
							<select
								aria-label="Which"
								value={String(model.nth)}
								onchange={(e) =>
									change(
										(m) =>
											(m.nth = e.currentTarget.value === 'last' ? 'last' : +e.currentTarget.value)
									)}
							>
								<option value="1">First</option>
								<option value="2">Second</option>
								<option value="3">Third</option>
								<option value="4">Fourth</option>
								<option value="last">Last</option>
							</select>
							<select
								aria-label="Weekday"
								value={String(model.nthWd)}
								onchange={(e) => change((m) => (m.nthWd = +e.currentTarget.value))}
							>
								{#each WEEKDAYS as [w, name] (w)}<option value={String(w)}>{name}</option>{/each}
							</select>
						</div>
					</div>
				{:else if model.kind === 'yearly'}
					<div class="row">
						<span class="lab">On</span>
						<div class="inline">
							<input
								type="number"
								min="1"
								max="31"
								aria-label="Day"
								value={model.day}
								oninput={(e) => change((m) => (m.day = clampInt(e.currentTarget.value, 1, 31)))}
							/>
							<select
								aria-label="Month"
								value={String(model.month)}
								onchange={(e) => change((m) => (m.month = +e.currentTarget.value))}
							>
								{#each MONTHS as name, i (name)}<option value={String(i + 1)}>{name}</option>{/each}
							</select>
						</div>
					</div>
				{:else if model.kind === 'interval'}
					<div class="row">
						<span class="lab">Every</span>
						<div class="inline">
							<input
								type="number"
								min="1"
								aria-label="Days between"
								value={model.interval}
								oninput={(e) =>
									change((m) => (m.interval = clampInt(e.currentTarget.value, 1, 3650)))}
							/>
							<input
								type="date"
								aria-label="Starting on"
								min={MIN_DATE}
								max={MAX_DATE}
								value={isoOf(model.date)}
								onchange={(e) =>
									setDate(e.currentTarget.value, (d) => {
										if (model) model.date = d;
									})}
							/>
						</div>
					</div>
				{/if}
				<div class="row">
					<label for={id('time')}>Time</label>
					<div class="inline">
						<input
							id={id('time')}
							type="time"
							value={model.time != null ? hhmm(model.time) : ''}
							onchange={(e) =>
								change((m) => {
									const r = /^(\d{2}):(\d{2})$/.exec(e.currentTarget.value);
									m.time = r ? +r[1]! * 60 + +r[2]! : null;
								})}
						/>
						<select
							aria-label="Duration"
							value={String(model.duration ?? 0)}
							onchange={(e) => change((m) => (m.duration = +e.currentTarget.value || null))}
						>
							{#each durationOptions as [value, label] (value)}
								<option value={String(value)}>{label}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="row">
					<label for={id('warn')}>Heads-up</label>
					<div class="inline">
						<input
							id={id('warn')}
							type="number"
							min="0"
							max="60"
							value={model.warn}
							oninput={(e) => change((m) => (m.warn = clampInt(e.currentTarget.value, 0, 60)))}
						/>
						<label class="tick">
							<input
								type="checkbox"
								checked={model.warnAll}
								onchange={(e) => change((m) => (m.warnAll = e.currentTarget.checked))}
							/>Count days off
						</label>
					</div>
				</div>
				<div class="row">
					<span class="lab" id={id('omit')}>On days off</span>
					<div class="seg" role="group" aria-labelledby={id('omit')}>
						{#each OMIT_MODES as [value, label] (value)}
							<button
								type="button"
								aria-pressed={model.omitMode === value}
								onclick={() => change((m) => (m.omitMode = value))}>{label}</button
							>
						{/each}
					</div>
				</div>
				{#if model.kind !== 'once'}
					<div class="row">
						<label for={id('until')}>Ends</label>
						<input
							id={id('until')}
							type="date"
							min={MIN_DATE}
							max={MAX_DATE}
							value={model.until ? isoOf(model.until) : ''}
							onchange={(e) => {
								const v = e.currentTarget.value;
								if (v) setDate(v, (d) => model && (model.until = d));
								else change((m) => (m.until = null));
							}}
						/>
					</div>
				{/if}
				<div class="row">
					<span class="lab">Options</span>
					<div class="inline">
						<label class="tick">
							<input
								type="checkbox"
								checked={model.todo}
								onchange={(e) => change((m) => (m.todo = e.currentTarget.checked))}
							/>It's a task (TODO)
						</label>
						<label class="tick">
							<input
								type="checkbox"
								checked={model.countdown}
								onchange={(e) => change((m) => (m.countdown = e.currentTarget.checked))}
							/>Add countdown %b
						</label>
					</div>
				</div>
			</div>
		</details>
	{:else if raw}
		<!-- Same height as the Adjust toggle, so typing "REM" doesn't move the footer's neighbours. -->
		<div class="tune off">Adjust is off while you write the line yourself.</div>
	{/if}

	<div class="foot">
		<label class="vh" for={id('file')}>Add to file</label>
		<select id={id('file')} bind:value={file}>
			{#each files as path (path)}<option value={path}>{path}</option>{/each}
		</select>
		<button type="button" class="add" disabled={!canAdd} onclick={add}>Add reminder</button>
	</div>
</div>

<style>
	.qa {
		--pad-x: max(18px, env(safe-area-inset-right, 0px));
		--pad-b: calc(24px + env(safe-area-inset-bottom, 0px));
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		min-height: min(520px, 62dvh);
	}
	.field {
		width: 100%;
		height: 52px;
		border-radius: 12px;
		border: 1.5px solid var(--ledger);
		background: var(--paper);
		padding: 0 14px;
		font-size: 17px;
	}
	.field::placeholder {
		color: var(--ink-3);
	}
	.hint,
	.note {
		margin: 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	.result {
		display: grid;
		align-content: start;
		gap: 8px;
		min-width: 0;
		min-height: 230px;
	}
	.notes {
		min-height: 20px;
	}
	.check {
		transition: opacity 0.12s;
	}
	.check.stale {
		opacity: 0.55;
	}
	.nextdates {
		min-height: 92px;
	}
	.ndhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}
	.ndhead .eyebrow {
		margin: 0;
	}
	.upd {
		font-size: 12px;
		color: var(--ink-2);
		visibility: hidden;
	}
	.upd.on {
		visibility: visible;
	}
	.remline {
		margin: 0;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--sunk);
		border: 1px solid var(--rule);
		font: 14px/1.5 var(--font-mono);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.remline :global(.sx-cmd) {
		color: var(--ink);
	}
	.remline :global(.sx-kw) {
		color: var(--sx-kw);
		font-weight: 600;
	}
	.remline :global(.sx-date),
	.remline :global(.sx-wday) {
		color: var(--sx-date);
	}
	.remline :global(.sx-num) {
		color: var(--sx-num);
	}
	.remline :global(.sx-time) {
		color: var(--sx-time);
	}
	.remline :global(.sx-str) {
		color: var(--sx-str);
	}
	.remline :global(.sx-name) {
		color: var(--ink-2);
	}
	.remline :global(.sx-expr) {
		color: var(--sx-expr);
	}
	.remline :global(.sx-pct) {
		color: var(--sx-kw);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.remline :global(.sx-comment) {
		color: var(--ink-3);
	}
	.remline :global(.sx-err) {
		text-decoration: wavy underline var(--danger);
		text-underline-offset: 3px;
	}
	.explain {
		margin: 0;
		padding-left: 18px;
		font-size: 14px;
	}
	.problem {
		margin: 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 14px;
		font-weight: 600;
	}
	.problems {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.eyebrow {
		margin: 0 0 6px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
	}
	.dates {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.dates li {
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--sunk);
		border: 1px solid var(--rule);
		font-size: 13px;
	}
	.dates li.first {
		background: var(--mark);
		color: var(--mark-ink);
		border-color: transparent;
		font-weight: 700;
	}
	.tune {
		border-top: 1px solid var(--rule);
		padding-top: 12px;
	}
	.tune.off {
		min-height: 48px;
		box-sizing: border-box;
		font-size: 13px;
		color: var(--ink-2);
	}
	.tune summary {
		font-weight: 700;
		font-size: 14px;
		cursor: pointer;
		list-style: none;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
	}
	.tune summary::-webkit-details-marker {
		display: none;
	}
	.tune summary::after {
		content: 'Show';
		margin-left: auto;
		font-weight: 600;
		font-size: 13px;
		color: var(--ledger);
	}
	.tune[open] summary::after {
		content: 'Hide';
	}
	.form {
		display: grid;
		gap: 12px;
		margin-top: 12px;
	}
	.row {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.row > label,
	.lab {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-2);
	}
	input[type='text'],
	input[type='number'],
	input[type='date'],
	input[type='time'],
	select {
		min-width: 0;
		height: 44px;
		border-radius: 10px;
		border: 1px solid var(--rule);
		background: var(--surface);
		padding: 0 10px;
	}
	.row > input,
	.row > select {
		width: 100%;
	}
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.inline > input,
	.inline > select {
		flex: 1 1 120px;
	}
	.tick {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font-size: 14px;
	}
	.tick input {
		width: 20px;
		height: 20px;
		accent-color: var(--ledger);
	}
	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.seg button {
		flex: 1 1 auto;
		min-width: 44px;
		height: 44px;
		border-radius: 10px;
		border: 1px solid var(--rule);
		background: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	.seg button[aria-pressed='true'] {
		background: var(--ledger);
		color: var(--ledger-ink);
		border-color: var(--ledger);
	}
	/* Pinned to the bottom of the sheet's scrolling content; it extends through the
	   sheet's own bottom padding so it sits at the same place scrolled or not. */
	.foot {
		position: sticky;
		bottom: 0;
		z-index: 1;
		margin-top: auto;
		margin-inline: calc(-1 * var(--pad-x));
		margin-bottom: calc(-1 * var(--pad-b));
		padding: 12px var(--pad-x) var(--pad-b);
		background: var(--surface);
		display: flex;
		gap: 8px;
		align-items: center;
		border-top: 1px solid var(--rule);
	}
	@media (min-width: 960px) {
		.qa {
			--pad-x: 24px;
			--pad-b: 24px;
		}
	}
	.foot select {
		flex: 1 1 0;
		min-width: 0;
	}
	.add {
		height: 44px;
		padding: 0 18px;
		border-radius: 12px;
		border: 0;
		background: var(--ledger);
		color: var(--ledger-ink);
		font-weight: 700;
		cursor: pointer;
	}
	.add:disabled {
		background: var(--sunk);
		color: var(--ink-3);
		cursor: not-allowed;
	}
</style>
