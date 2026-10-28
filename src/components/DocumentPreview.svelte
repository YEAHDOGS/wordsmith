<script>
  // The attachment viewer's body for a document: a large file tile, the start of the text for .md and .txt (as plain
  // text, never rendered), and a link that opens a PDF in a new tab or downloads anything else. Web links straight to
  // the API with the session cookie; native apps get a blob URL (mediaUrl in src/lib/api.js), so they always download.
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { fade, fly } from 'svelte/transition';
  import DocumentTile from './DocumentTile.svelte';
  import { mediaUrl } from '../lib/api.js';
  import { PDF, hasExcerpt, textExcerpt } from '../lib/documents.js';

  /** @type {{ file: any }} */
  let { file } = $props();

  const FADE_MS = 200;
  const BLOB = 'blob:';

  let src = $state('');
  let excerpt = $state('');
  let failed = $state(false);
  const opensInTab = $derived(file.type === PDF && !src.startsWith(BLOB));

  $effect(() => {
    let revoked = false;
    /** @type {string} */
    let created = '';
    failed = false;
    excerpt = '';
    mediaUrl(file.url).then(async (url) => {
      created = url;
      if (revoked) return;
      src = url;
      if (hasExcerpt(file.type)) excerpt = await textExcerpt(url, file.size);
    }).catch(() => (failed = true));
    return () => {
      revoked = true;
      if (created.startsWith(BLOB)) URL.revokeObjectURL(created);
    };
  });
</script>

<div class="flex max-h-full w-[min(40rem,100%)] min-h-0 flex-col gap-3 border border-line bg-app p-4 tv:w-[min(64rem,100%)] tv:gap-5 tv:p-8">
  <div class="flex min-w-0 items-center gap-3">
    <DocumentTile {file} compact class="size-16 shrink-0 tv:size-28" />
    <p class="min-w-0 flex-1 text-sm break-all text-ink tv:text-xl">{file.name}</p>
  </div>
  {#if hasExcerpt(file.type)}
    <div class="min-h-24 flex-1 overflow-y-auto overscroll-contain border border-line bg-surface p-3">
      {#if excerpt}
        <pre class="font-mono text-xs whitespace-pre-wrap break-words text-ink-muted tv:text-base" in:fade={{ duration: FADE_MS }}>{excerpt}</pre>
      {:else if failed}
        <p class="text-xs text-ink-faint">Couldn't load a preview.</p>
      {:else}
        <div class="h-16 animate-pulse bg-surface-raised"></div>
      {/if}
    </div>
  {/if}
  {#if src}
    <a href={src} target={opensInTab ? '_blank' : undefined} rel={opensInTab ? 'noopener' : undefined} download={opensInTab ? undefined : file.name}
      class="spring press flex shrink-0 items-center justify-center gap-2 self-start border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent tv:text-lg"
      in:fly={{ y: 8, duration: FADE_MS }}>
      {#if opensInTab}<ExternalLink class="size-4" />Open PDF{:else}<Download class="size-4" />Download{/if}
    </a>
  {:else if failed}
    <p class="text-xs text-accent" role="alert" in:fade={{ duration: FADE_MS }}>Couldn't load this file.</p>
  {/if}
</div>
