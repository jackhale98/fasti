<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	// Stub: the Inspector view replaces this (docs/PLAN.md section 4, Inspector).
	import type { Selection } from '../shell.svelte.ts';

	let { selection }: { selection: Selection } = $props();
</script>

<p>{selection.file} line {selection.line}</p>
