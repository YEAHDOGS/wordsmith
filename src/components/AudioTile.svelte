<script>
  // Compact visual for audio attachments in file grids; playback stays in the native audio controls.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import { fileSize } from '../lib/documents.js';

  /** @type {{ file: { name: string, size: number }, class?: string, compact?: boolean }} */
  let { file, class: className = '', compact = false } = $props();
</script>

<div class="flex min-w-0 flex-col items-center justify-center gap-1 bg-surface-raised p-2 text-center {className}">
  <Volume2 class="size-8 text-ink-muted tv:size-12" aria-hidden="true" />
  {#if !compact}
    <span class="w-full line-clamp-2 break-all text-[0.6875rem] leading-tight text-ink tv:text-sm">{file.name}</span>
    <span class="font-mono text-[0.625rem] text-ink-faint tv:text-xs">{fileSize(file.size)}</span>
  {/if}
</div>
