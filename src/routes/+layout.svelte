<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import '@fontsource/young-serif/400.css';
	import '@fontsource-variable/hanken-grotesk';
	import '@fontsource/ibm-plex-mono/400.css';
	import '#lib/ui/tokens.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Brand from '#lib/ui/Brand.svelte';
	import Icon, { type IconName } from '#lib/ui/Icon.svelte';
	import Toast from '#lib/ui/Toast.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Inspector from '#lib/ui/inspector/Inspector.svelte';
	import QuickAdd from '#lib/ui/quickadd/QuickAdd.svelte';
	import { app } from '#lib/app/app.svelte.ts';
	import { shell } from '#lib/ui/shell.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';

	let { children } = $props();

	const views: { path: '/' | '/month' | '/script' | '/sync'; label: string; icon: IconName }[] = [
		{ path: '/', label: 'Today', icon: 'today' },
		{ path: '/month', label: 'Month', icon: 'month' },
		{ path: '/script', label: 'Script', icon: 'script' },
		{ path: '/sync', label: 'Sync', icon: 'sync' }
	];

	const here = $derived(page.route.id ?? '/');
	const current = (path: string) => (here === path ? 'page' : undefined);

	const desktopQuery = '(min-width: 960px)';
	let desktop = $state(false);

	onMount(() => {
		theme.init();
		void app.start();
		const mq = matchMedia(desktopQuery);
		desktop = mq.matches;
		const change = () => (desktop = mq.matches);
		mq.addEventListener('change', change);
		return () => mq.removeEventListener('change', change);
	});

	// On phones the inspector is a bottom sheet, open while something is selected.
	let sheetOpen = $derived(!desktop && shell.selected !== null);

	function onkeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing =
			target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null;
		const modal = document.querySelector('dialog[open]') !== null;
		if (
			event.key === 'n' &&
			!typing &&
			!modal &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
		) {
			event.preventDefault();
			shell.composing = true;
		}
	}
</script>

<svelte:window {onkeydown} />

<a class="skip" href="#main">Skip to content</a>

<div class="app">
	<header class="topbar">
		<Brand />
		<a
			class="iconlink"
			href={resolve('/settings')}
			aria-label="Settings"
			aria-current={current('/settings')}
		>
			<Icon name="settings" />
		</a>
	</header>

	<nav class="nav" aria-label="Views">
		<div class="rail-head"><Brand tagline /></div>
		<button type="button" class="rail-new" onclick={() => (shell.composing = true)}>
			<Icon name="plus" size={18} stroke={2.2} />New reminder
		</button>
		{#each views as view (view.path)}
			<a class="navbtn" href={resolve(view.path)} aria-current={current(view.path)}>
				<Icon name={view.icon} size={22} stroke={1.7} />{view.label}
			</a>
		{/each}
		<a class="navbtn rail-only" href={resolve('/settings')} aria-current={current('/settings')}>
			<Icon name="settings" size={22} stroke={1.7} />Settings
		</a>
		<p class="rail-foot">
			A web front end for Remind. Not affiliated with or endorsed by Remind or its author.
		</p>
	</nav>

	<main id="main" tabindex="-1">
		{@render children()}
	</main>

	<aside class="panel" aria-label="Inspector">
		{#if shell.selected}
			{#key `${shell.selected.file}:${shell.selected.line}:${shell.selected.date}`}
				<Inspector selection={shell.selected} />
			{/key}
		{:else if shell.panel}
			{@render shell.panel()}
		{:else}
			<h2 class="eyebrow">Inspector</h2>
			<p class="hint">
				Select a reminder to see how Remind computes its dates, what its line says in plain words,
				and to edit it.
			</p>
		{/if}
	</aside>

	<button
		type="button"
		class="fab"
		aria-label="New reminder"
		onclick={() => (shell.composing = true)}
	>
		<Icon name="plus" size={22} stroke={2.2} />New
	</button>
</div>

{#if !desktop}
	<Sheet bind:open={sheetOpen} title="Reminder" onclose={() => shell.select(null)}>
		{#if shell.selected}
			<Inspector selection={shell.selected} />
		{/if}
	</Sheet>
{/if}

<Sheet bind:open={shell.composing} title="New reminder" testid="quickadd">
	<QuickAdd onadded={() => (shell.composing = false)} />
</Sheet>

<Toast />

<style>
	.skip {
		position: absolute;
		left: 8px;
		top: -48px;
		z-index: 40;
		background: var(--ledger);
		color: var(--ledger-ink);
		padding: 8px 12px;
		border-radius: 8px;
	}
	.skip:focus {
		top: 8px;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--paper);
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(10px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px))
			10px max(16px, env(safe-area-inset-left, 0px));
		border-bottom: 1px solid var(--rule);
	}
	.iconlink {
		margin-left: auto;
		display: inline-grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		color: var(--ink-2);
	}
	.iconlink[aria-current='page'] {
		color: var(--ink);
		background: var(--sunk);
	}
	.nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 6;
		background: var(--surface);
		border-top: 1px solid var(--rule);
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		padding: 0 max(8px, env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px)
			max(8px, env(safe-area-inset-left, 0px));
	}
	.rail-head,
	.rail-foot,
	.rail-new,
	.rail-only {
		display: none !important;
	}
	.navbtn {
		height: var(--tabbar-h);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		color: var(--ink-3);
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-decoration: none;
		position: relative;
	}
	.navbtn[aria-current='page'] {
		color: var(--ink);
	}
	.navbtn[aria-current='page']::after {
		content: '';
		position: absolute;
		top: 0;
		left: 30%;
		right: 30%;
		height: 3px;
		border-radius: 0 0 3px 3px;
		background: var(--ledger);
	}
	main {
		outline: none;
		padding-bottom: calc(var(--tabbar-h) + 88px + env(safe-area-inset-bottom, 0px));
	}
	.panel {
		display: none;
	}
	.fab {
		position: fixed;
		z-index: 7;
		right: max(16px, env(safe-area-inset-right, 0px));
		bottom: calc(var(--tabbar-h) + 16px + env(safe-area-inset-bottom, 0px));
		height: 54px;
		padding: 0 20px 0 16px;
		border-radius: 27px;
		border: 0;
		background: var(--ledger);
		color: var(--ledger-ink);
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 700;
		font-size: 15px;
		box-shadow: var(--shadow);
		cursor: pointer;
	}
	.eyebrow {
		font-size: 13px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
		font-weight: 700;
		margin: 0 0 10px;
	}
	.hint {
		color: var(--ink-2);
		margin: 0;
	}

	@media (min-width: 960px) {
		.app {
			display: grid;
			grid-template-columns: 236px minmax(0, 1fr) 392px;
			height: 100dvh;
		}
		.topbar,
		.fab {
			display: none;
		}
		.nav {
			position: static;
			display: flex;
			flex-direction: column;
			gap: 2px;
			border-top: 0;
			border-right: 1px solid var(--rule);
			padding: 20px 14px;
			background: var(--paper);
			overflow: auto;
		}
		.rail-head {
			display: block !important;
			padding: 4px 6px 18px;
		}
		.rail-only {
			display: flex !important;
		}
		.rail-foot {
			display: block !important;
			margin: auto 0 0;
			padding: 12px 6px 0;
			font-size: 12px;
			color: var(--ink-3);
			line-height: 1.5;
		}
		.rail-new {
			display: flex !important;
			margin: 0 0 14px;
			height: 42px;
			border: 0;
			border-radius: 10px;
			background: var(--ledger);
			color: var(--ledger-ink);
			font-weight: 700;
			align-items: center;
			justify-content: center;
			gap: 8px;
			cursor: pointer;
		}
		.navbtn {
			height: 40px;
			flex-direction: row;
			justify-content: flex-start;
			gap: 12px;
			padding: 0 12px;
			border-radius: 10px;
			font-size: 14.5px;
			letter-spacing: 0;
		}
		.navbtn:hover {
			background: var(--sunk);
		}
		.navbtn[aria-current='page'] {
			background: var(--surface);
			box-shadow: inset 0 0 0 1px var(--rule);
		}
		.navbtn[aria-current='page']::after {
			display: none;
		}
		main {
			overflow: auto;
			padding-bottom: 40px;
		}
		.panel {
			display: block;
			overflow: auto;
			border-left: 1px solid var(--rule);
			background: var(--surface);
			padding: 28px 24px 40px;
		}
	}
</style>
