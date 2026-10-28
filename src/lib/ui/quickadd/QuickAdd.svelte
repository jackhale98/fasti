<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<script lang="ts">
	// Stub: the Quick add view replaces this (docs/PLAN.md section 4, Quick add).
	let { onadded }: { onadded?: () => void } = $props();
</script>

<p>Quick add is coming.</p>
<button type="button" onclick={() => onadded?.()}>Close</button>
