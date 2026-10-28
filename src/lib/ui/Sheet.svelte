<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	/**
	 * A modal on a native `<dialog>` (focus stays inside; Escape closes it):
	 * a bottom sheet on phones and a centred card from 960 px.
	 */
	let {
		open = $bindable(false),
		title,
		children,
		onclose,
		testid
	}: {
		open?: boolean;
		title: string;
		children: Snippet;
		onclose?: () => void;
		testid?: string;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function close() {
		open = false;
	}

	// The page behind doesn't scroll while a sheet is open.
	$effect(() => {
		if (!open) return;
		const root = document.documentElement;
		root.classList.add('sheet-open');
		return () => root.classList.remove('sheet-open');
	});

	// Phones: pull the sheet down to close it, from its handle, its top (when
	// scrolled to the top) or the backdrop. Touch events, as only they can stop
	// the scroll once the pull has begun.
	let pull = $state<number | null>(null);
	let leaving = $state(false);
	$effect(() => {
		const el = dialog;
		if (!el) return;
		let start: { y: number; t: number } | null = null;
		/** Whether a touch here would scroll something up (so it isn't a pull). */
		const scrollsUp = (target: EventTarget | null) => {
			for (let n = target as HTMLElement | null; n && n !== el.parentElement; n = n.parentElement) {
				if (n.matches('textarea, input, select, [contenteditable], .cm-editor')) return true;
				if (n.scrollTop > 0) return true;
			}
			return false;
		};
		const touchstart = (e: TouchEvent) => {
			start =
				open && !leaving && e.touches.length === 1 && !matchMedia('(min-width: 960px)').matches
					? scrollsUp(e.target)
						? null
						: { y: e.touches[0]!.clientY, t: e.timeStamp }
					: null;
		};
		const touchmove = (e: TouchEvent) => {
			if (!start) return;
			const dy = e.touches[0]!.clientY - start.y;
			if (pull === null) {
				if (dy < -6) start = null; // scrolling the sheet's content
				if (dy < 6 || !start) return;
			}
			e.preventDefault();
			pull = Math.max(0, dy);
		};
		const touchend = (e: TouchEvent) => {
			if (start && pull !== null) {
				const dy = (e.changedTouches[0]?.clientY ?? start.y) - start.y;
				const fast = dy / Math.max(1, e.timeStamp - start.t) > 0.5;
				if (e.type !== 'touchcancel' && (dy > 100 || (fast && dy > 30))) dismiss();
				else pull = null;
			}
			start = null;
		};
		el.addEventListener('touchstart', touchstart, { passive: true });
		el.addEventListener('touchmove', touchmove, { passive: false });
		el.addEventListener('touchend', touchend);
		el.addEventListener('touchcancel', touchend);
		return () => {
			el.removeEventListener('touchstart', touchstart);
			el.removeEventListener('touchmove', touchmove);
			el.removeEventListener('touchend', touchend);
			el.removeEventListener('touchcancel', touchend);
		};
	});
	/** Slide the sheet the rest of the way down, then close it. */
	function dismiss() {
		pull = null;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return close();
		leaving = true;
		setTimeout(() => {
			leaving = false;
			close();
		}, 160);
	}
</script>

<!-- A backdrop click is a pointer shortcut; Escape and the close button do the same. -->
<dialog
	bind:this={dialog}
	class="sheet"
	class:pulling={pull !== null}
	class:leaving
	style:transform={pull !== null ? `translateY(${pull}px)` : undefined}
	aria-labelledby="{uid}-title"
	data-testid={testid}
	onclose={() => {
		open = false;
		onclose?.();
	}}
	onclick={(event) => {
		if (event.target === dialog) close();
	}}
>
	{#if open}
		<div class="panel">
			<div class="grab" aria-hidden="true"></div>
			<div class="head">
				<h2 id="{uid}-title">{title}</h2>
				<button type="button" class="iconbtn" aria-label="Close" onclick={close}>
					<Icon name="close" size={18} stroke={2} />
				</button>
			</div>
			{@render children()}
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		margin: auto auto 0;
		width: 100%;
		max-width: 100%;
		max-height: calc(100dvh - 28px - env(safe-area-inset-top, 0px));
		padding: 0;
		border: 0;
		border-radius: 18px 18px 0 0;
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow);
		overscroll-behavior: contain;
	}
	.sheet[open] {
		animation: up 0.22s ease-out;
		transition: transform 0.2s ease;
	}
	.sheet.pulling {
		transition: none;
	}
	.sheet.leaving {
		transform: translateY(100%);
		transition-duration: 0.16s;
	}
	:global(html.sheet-open) {
		overflow: hidden;
	}
	.sheet::backdrop {
		background: color-mix(in srgb, #000 38%, transparent);
	}
	.panel {
		padding: 10px max(18px, env(safe-area-inset-right, 0px))
			calc(24px + env(safe-area-inset-bottom, 0px)) max(18px, env(safe-area-inset-left, 0px));
	}
	.grab {
		width: 40px;
		height: 5px;
		border-radius: 3px;
		background: var(--rule);
		margin: 0 auto 10px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	h2 {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 400;
		letter-spacing: -0.01em;
		margin: 0;
	}
	.iconbtn {
		margin-left: auto;
		height: 36px;
		min-width: 36px;
		border-radius: 10px;
		border: 1px solid var(--rule);
		background: var(--surface);
		display: inline-grid;
		place-items: center;
		cursor: pointer;
	}
	@keyframes up {
		from {
			transform: translateY(24px);
			opacity: 0.4;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@media (min-width: 960px) {
		.sheet {
			margin: auto;
			width: min(600px, 92vw);
			max-height: 88vh;
			border-radius: 18px;
		}
		.panel {
			padding: 20px 24px 24px;
		}
		.grab {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet[open] {
			animation: none;
		}
	}
</style>
