<script>
  // Feature state pill. In-progress gets a live pulse so you can see agents working at a glance.
  import { STATE_STYLE } from '../lib/colors.js';

  /** @type {{ state: string }} */
  let { state } = $props();
  const style = $derived(STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)] ?? STATE_STYLE.requested);
</script>

<span class="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[11px] tv:text-sm {style.soft} {style.text}">
  <span class="relative flex size-1.5">
    {#if state === 'in_progress'}<span class="live-dot absolute inset-0 rounded-full {style.dot}"></span>{/if}
    <span class="relative size-1.5 rounded-full {style.dot}"></span>
  </span>
  {style.label}
</span>
