<script>
  // A document attachment drawn as a file tile: its type's icon and tag, name and size. Fills whatever box it's given
  // (note attachment grid, composer queue), so it sits where an image thumbnail would.
  import { documentIcon, documentTag, fileSize } from '../lib/documents.js';

  /** @type {{ file: { name: string, type: string, size: number }, class?: string, compact?: boolean }} */
  let { file, class: className = '', compact = false } = $props();

  const Icon = $derived(documentIcon(file.type));
</script>

<div class="flex flex-col items-center justify-center gap-1 bg-surface-raised p-2 text-center {className}">
  <span class="relative text-ink-muted">
    <Icon class="{compact ? 'size-6' : 'size-8'} tv:size-12" aria-hidden="true" />
    <span class="absolute -right-2 -bottom-1 bg-accent px-1 font-mono text-[0.5625rem] leading-tight font-semibold text-accent-ink tv:text-xs">{documentTag(file.name)}</span>
  </span>
  {#if !compact}
    <span class="mt-1 line-clamp-2 w-full text-[0.6875rem] leading-tight break-all text-ink tv:text-sm">{file.name}</span>
    <span class="font-mono text-[0.625rem] text-ink-faint tv:text-xs">{fileSize(file.size)}</span>
  {/if}
</div>
