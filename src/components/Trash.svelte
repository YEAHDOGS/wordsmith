<script>
  // The trash: deleted notes, projects and labels, kept TRASH_DAYS before the server purges them (api/lib/trash.js).
  // Restore syncs the row back to every device; Delete forever and Empty trash purge on the server right away and
  // need a connection. Both destructive buttons swap in place for a confirm, so nothing shifts. Phones: one stark
  // column edge to edge. Tablets and up: a grid split by 1px lines. Only the list scrolls.
  import { flip } from 'svelte/animate';
  import { fade, fly, scale } from 'svelte/transition';
  import { backOut, cubicIn, quintOut } from 'svelte/easing';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import Tag from '@lucide/svelte/icons/tag';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash from '@lucide/svelte/icons/trash';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { TINT_BG } from '../lib/colors.js';
  import { TRASH_DAYS } from '../lib/models.js';
  import { fullTime } from '../lib/time.js';
  import { restoreBlocker, trashItems } from './trash.js';
  import TEXT from './trash.json';

  const CONTENT = 'mx-auto w-full max-w-7xl ultrawide:max-w-none';
  const ICONS = { notes: FileText, projects: Folder, labels: Tag };
  // Re-read the clock once a minute, so "deleted N days ago" and "gone in N days" roll over while the page is open.
  const CLOCK_MS = 60_000;
  const ROW_OUT = { x: -24, duration: 180, easing: cubicIn };
  const ROW_IN = { y: 8, duration: 240, easing: quintOut };
  const FLIP = { duration: 260, easing: quintOut };
  const SWAP_IN = { start: 0.9, duration: 160, easing: backOut };
  const BUTTON = 'spring press inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs tv:text-base font-medium';
  // Above this many days left a row reads calm; inside it the countdown turns to the accent.
  const URGENT_DAYS = 3;

  let now = $state(Date.now());
  let confirmingAll = $state(false);
  /** Key "table:id" of the row whose Delete forever is waiting for a yes. */
  let confirming = $state('');
  let busy = $state(false);
  let message = $state('');

  const items = $derived(trashItems(now));
  const shown = $derived.by(() => {
    const query = ui.query.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => `${item.title} ${item.snippet}`.toLowerCase().includes(query));
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  });

  /** @param {string} text @param {Record<string, string | number>} values */
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));

  /** @param {import('./trash.js').TrashItem} item */
  function restore(item) {
    const taken = restoreBlocker(item);
    if (taken) {
      message = fill(TEXT.nameTaken, { name: taken });
      return;
    }
    message = '';
    store.update(item.table, item.id, { deleted_at: null });
  }

  /** @param {Parameters<typeof store.purge>[0]} rows */
  async function purge(rows) {
    if (busy) return;
    busy = true;
    message = '';
    try {
      await store.purge(rows);
    } catch (error) {
      message = error instanceof TypeError ? TEXT.offline : /** @type {Error} */ (error).message;
    } finally {
      busy = false;
      confirming = '';
      confirmingAll = false;
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="{CONTENT} flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2.5 sm:px-4 tv:py-4">
    <p class="min-w-0 flex-1 text-xs text-ink-muted tv:text-lg">{fill(TEXT.intro, { days: TRASH_DAYS })}</p>
    <!-- One grid cell: Empty trash and its confirmation swap in place -->
    <div class="grid shrink-0 justify-items-end">
      {#if confirmingAll}
        <div class="col-start-1 row-start-1 flex items-center gap-1" in:scale={SWAP_IN}>
          <button class="{BUTTON} bg-accent text-accent-ink hover:bg-accent-hover" disabled={busy} onclick={() => purge('all')}><Trash class="size-4" />{fill(TEXT.confirmEmpty, { count: items.length })}</button>
          <button class="{BUTTON} text-ink-muted hover:text-ink" {@attach (node) => node.focus()} onclick={() => (confirmingAll = false)}>{TEXT.keep}</button>
        </div>
      {:else}
        <button class="{BUTTON} col-start-1 row-start-1 border border-line text-ink-muted hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-muted"
          in:scale={SWAP_IN} disabled={!items.length || busy} onclick={() => (confirmingAll = true)}><Trash class="size-4" />{TEXT.emptyTrash}</button>
      {/if}
    </div>
  </div>

  <!-- Reserved line for messages, so one appearing never pushes the list down -->
  <p class="{CONTENT} h-6 shrink-0 truncate px-3 pt-1 text-xs text-accent sm:px-4 tv:h-9 tv:text-lg" role="status" aria-live="polite">
    {#key message}{#if message}<span class="block" in:fade={{ duration: 160 }}>{message}</span>{/if}{/key}
  </p>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {#if !shown.length}
      <p class="px-4 py-12 text-center text-sm text-ink-faint tv:text-xl" in:fade={{ duration: 200 }}>{ui.query && items.length ? TEXT.noMatches : TEXT.empty}</p>
    {:else}
      <ul class="{CONTENT} grid gap-px border-y border-line bg-line pb-px sm:grid-cols-2 xl:grid-cols-3 ultrawide:grid-cols-4 short:grid-cols-2 sm:border-x" aria-label={fill(TEXT.itemCount, { count: items.length })}>
        {#each shown as item (`${item.table}:${item.id}`)}
          {@const key = `${item.table}:${item.id}`}
          {@const Icon = ICONS[item.table]}
          <li class="flex min-w-0 flex-col gap-2 {item.table === 'notes' ? TINT_BG[/** @type {keyof typeof TINT_BG} */ (item.color)] ?? 'bg-surface' : 'bg-surface'} p-3 tv:gap-3 tv:p-5"
            animate:flip={FLIP} in:fly={ROW_IN} out:fly={ROW_OUT}>
            <div class="flex min-w-0 items-start gap-2">
              <Icon class="mt-0.5 size-4 shrink-0 text-ink-faint tv:size-6" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-ink tv:text-xl {item.title ? '' : 'italic text-ink-muted'}">{item.title || TEXT.untitled}</p>
                {#if item.snippet}<p class="line-clamp-2 text-xs break-words text-ink-muted tv:text-base">{item.snippet}</p>{/if}
              </div>
            </div>
            <p class="font-mono text-[0.6875rem] text-ink-faint tv:text-sm" title={fullTime(item.deletedAt)}>
              {TEXT.kinds[item.table]} · {item.daysAgo ? fill(TEXT.deletedDaysAgo, { n: item.daysAgo }) : TEXT.deletedToday} ·
              <span class={item.daysLeft <= URGENT_DAYS ? 'text-accent' : ''}>{fill(TEXT.purgesIn, { n: item.daysLeft })}</span>
            </p>
            <!-- One grid cell: the actions and the confirmation swap in place -->
            <div class="mt-auto grid">
              {#if confirming === key}
                <div class="col-start-1 row-start-1 flex flex-wrap items-center gap-1" in:scale={SWAP_IN}>
                  <span class="mr-auto text-xs text-ink tv:text-base">{TEXT.confirmDelete}</span>
                  <button class="{BUTTON} bg-accent text-accent-ink hover:bg-accent-hover" disabled={busy} onclick={() => purge({ [item.table]: [item.id] })}>{TEXT.yes}</button>
                  <button class="{BUTTON} text-ink-muted hover:text-ink" {@attach (node) => node.focus()} onclick={() => (confirming = '')}>{TEXT.keep}</button>
                </div>
              {:else}
                <div class="col-start-1 row-start-1 flex flex-wrap items-center gap-1" in:scale={SWAP_IN}>
                  <button class="{BUTTON} text-ink hover:bg-surface-raised" onclick={() => restore(item)}><RotateCcw class="size-4" />{TEXT.restore}</button>
                  <button class="{BUTTON} text-ink-muted hover:text-accent" disabled={busy} onclick={() => (confirming = key)}><Trash class="size-4" />{TEXT.deleteForever}</button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
