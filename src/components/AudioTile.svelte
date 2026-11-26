<script>
  // Visual for audio attachments, sized like a document tile. Playable tiles (the note's attachment grid) show the same
  // play circle as a video tile in place of the speaker, since a click opens the player.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Play from '@lucide/svelte/icons/play';
  import { fileSize } from '../lib/documents.js';

  /** @type {{ file: { name: string, size: number }, class?: string, compact?: boolean, playable?: boolean }} */
  let { file, class: className = '', compact = false, playable = false } = $props();
</script>

<div class="flex min-w-0 flex-col items-center justify-center gap-1 bg-surface-raised p-2 text-center {className}">
  {#if playable}
    <span class="flex size-9 items-center justify-center rounded-full bg-scrim text-ink tv:size-12" aria-hidden="true"><Play class="size-4 tv:size-6" /></span>
  {:else}
    <Volume2 class="size-8 text-ink-muted tv:size-12" aria-hidden="true" />
  {/if}
  {#if !compact}
    <span class="w-full line-clamp-2 break-all text-[0.6875rem] leading-tight text-ink tv:text-sm">{file.name}</span>
    <span class="font-mono text-[0.625rem] text-ink-faint tv:text-xs">{fileSize(file.size)}</span>
  {/if}
</div>
