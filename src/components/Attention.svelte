<script>
  // "Needs you": one decision at a time. Only notes waiting on the owner show (attention.js): an agent's question
  // (notes.ask, with one-key options) or work in progress with an open PR. Done, reply, snooze, open; Z undoes the last
  // one. Keyboard-first on desktop; on phones the buttons sit at thumb height and a sideways swipe steps between cards.
  // The card slides with transform and opacity only, in a fixed box, so nothing around it moves.
  import { fly, fade, slide } from 'svelte/transition';
  import { backOut, cubicIn } from 'svelte/easing';
  import Check from '@lucide/svelte/icons/check';
  import Reply from '@lucide/svelte/icons/reply';
  import AlarmClock from '@lucide/svelte/icons/alarm-clock';
  import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import Folder from '@lucide/svelte/icons/folder';
  import Inbox from '@lucide/svelte/icons/inbox';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ago } from '../lib/time.js';
  import { DOT_TEXT, TINT_BG } from '../lib/colors.js';
  import { SNOOZES, answer, needsYou } from './attention.js';
  import TEXT from './attention.json';

  const CONTENT = 'mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-2 py-3 sm:px-4 sm:py-6 tv:max-w-5xl';
  const ACTION_BASE = 'spring press inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 border px-3 text-sm font-medium disabled:opacity-40 sm:flex-none tv:min-h-16 tv:text-xl';
  const ACTION = `${ACTION_BASE} border-line bg-surface hover:border-line-strong hover:bg-surface-raised`;
  const PRIMARY = `${ACTION_BASE} border-accent bg-accent text-accent-ink hover:bg-accent-hover`;
  const KEY = 'hidden font-mono text-[0.625rem] text-ink-faint sm:inline';
  const CLOCK_MS = 60_000;
  const EVENTS_SHOWN = 3;
  const SWIPE_PX = 80;
  const SLIDE_PX = 48;
  const CARD_OUT = { duration: 140, easing: cubicIn };
  const SWAP = { duration: 150 };

  let now = $state(Date.now());
  let index = $state(0);
  let direction = $state(1);
  let replying = $state(false);
  let snoozing = $state(false);
  let draft = $state('');
  let notice = $state('');
  let swipe = $state(0);
  /** The last action, to undo: the note and the fields it had before. @type {{ id: string, before: Record<string, any> } | null} */
  let last = $state(null);
  /** @type {{ x: number, id: number } | null} */
  let touch = null;

  const items = $derived(needsYou(now));
  const current = $derived(items[Math.min(index, items.length - 1)] ?? null);
  const project = $derived(current?.note.project_id ? store.find('projects', current.note.project_id) : null);
  const recent = $derived(current ? store.events.filter((event) => event.note_id === current.note.id).sort((a, b) => b.created_at - a.created_at).slice(0, EVENTS_SHOWN) : []);

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  });

  /** @param {string} text @param {Record<string, string | number>} values */
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));

  /** Steps to another card. @param {number} step */
  function go(step) {
    if (!items.length) return;
    direction = step;
    index = (Math.min(index, items.length - 1) + step + items.length) % items.length;
    replying = snoozing = false;
  }

  /** Applies a change to the current note, remembering how to undo it. @param {Record<string, any>} patch @param {(note: any) => void} [write] */
  function act(patch, write) {
    if (!current) return;
    const { note } = current;
    last = { id: note.id, before: Object.fromEntries(['body', 'ask', 'state', 'snoozed_until'].map((field) => [field, note[field]])) };
    direction = 1;
    if (write) write(note);
    else store.update('notes', note.id, patch);
    replying = snoozing = false;
    draft = '';
    notice = '';
    now = Date.now();
  }

  const done = () => act({ state: 'complete', ask: '' });
  /** @param {string} text */
  const reply = (text) => text.trim() && act({}, (note) => answer(note, text.trim()));
  /** @param {typeof SNOOZES[number]} choice */
  const snooze = (choice) => act({ snoozed_until: choice.wake(new Date()) });

  function undo() {
    if (!last) return;
    store.update('notes', last.id, last.before);
    last = null;
    notice = TEXT.undone;
    now = Date.now();
  }

  /** @param {SubmitEvent} event */
  function send(event) {
    event.preventDefault();
    reply(draft);
  }

  /** Single keys act on the card; typing in a field or an open note editor keeps its own keys. @param {KeyboardEvent} event */
  function onkeydown(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    if (router.route.note || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z') return undo();
    if (!current) return;
    const option = current.options.find((entry) => entry.key === key);
    /** @type {Record<string, () => void>} */
    const keys = { e: done, r: () => (replying = true), l: () => (snoozing = !snoozing), o: () => router.openNote(current.note.id), j: () => go(1), k: () => go(-1), arrowright: () => go(1), arrowleft: () => go(-1) };
    const run = option ? () => reply(option.text) : keys[key];
    if (!run) return;
    event.preventDefault();
    run();
  }

  /** @param {PointerEvent} event */
  function ondown(event) {
    if (event.pointerType === 'mouse' || /** @type {HTMLElement} */ (event.target).closest('button, a, textarea, input')) return;
    touch = { x: event.clientX, id: event.pointerId };
  }

  /** @param {PointerEvent} event */
  function onmove(event) {
    if (touch?.id === event.pointerId) swipe = event.clientX - touch.x;
  }

  function onup() {
    if (Math.abs(swipe) > SWIPE_PX) go(swipe < 0 ? 1 : -1);
    touch = null;
    swipe = 0;
  }
</script>

<svelte:window {onkeydown} />

<div class="h-full overflow-y-auto">
  <div class={CONTENT}>
    <div class="flex min-h-6 items-center gap-3 px-2 font-mono text-xs text-ink-faint sm:px-0 tv:text-base">
      {#if items.length}<span class="tabular-nums">{fill(TEXT.count, { n: Math.min(index, items.length - 1) + 1, total: items.length })}</span>{/if}
      {#if notice}<span class="text-ink-muted" role="status" transition:fade={SWAP}>{notice}</span>{/if}
      <span class="ml-auto hidden lg:inline">{TEXT.keys}</span>
    </div>

    <div class="relative grid flex-1">
      {#if current}
        {#key current.note.id}
          <article class="col-start-1 row-start-1 flex touch-pan-y flex-col gap-4 border border-line p-4 sm:p-6 tv:p-10 {TINT_BG[current.note.color] || TINT_BG.default}"
            style:translate="{swipe}px 0" onpointerdown={ondown} onpointermove={onmove} onpointerup={onup} onpointercancel={onup}
            in:fly={{ x: direction * SLIDE_PX, duration: 260, easing: backOut }} out:fade={CARD_OUT} aria-live="polite">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tv:text-base">
              <span class="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono uppercase tracking-wide {current.reason === 'question' ? 'border-accent text-accent' : 'border-progress text-progress'}">
                {#if current.reason === 'question'}{TEXT.question}{:else}<GitPullRequest class="size-3" />{TEXT.review}{/if}
              </span>
              <span class="inline-flex items-center gap-1 font-semibold {DOT_TEXT[project?.color] || DOT_TEXT.default}"><Folder class="size-3" />{project?.name ?? TEXT.noProject}</span>
              {#if current.note.assignee}<span class="font-mono text-ink-muted">{current.note.assignee}</span>{/if}
              <span class="ml-auto font-mono text-ink-faint">{ago(current.note.updated_at)}</span>
            </div>

            <h2 class="text-fluid-lg font-bold leading-tight tracking-tight">{current.note.title || 'Untitled'}</h2>

            {#if current.question}<p class="whitespace-pre-wrap text-fluid-base text-ink">{current.question}</p>{/if}
            {#if current.options.length}
              <div class="grid gap-px border border-line bg-line">
                {#each current.options as option (option.key)}
                  <button class="spring press flex items-start gap-3 bg-surface px-3 py-2.5 text-left text-sm hover:bg-surface-raised tv:text-xl" aria-label={fill(TEXT.pick, { key: option.key })} onclick={() => reply(option.text)}>
                    <span class="flex size-5 shrink-0 items-center justify-center border border-line-strong font-mono text-xs tv:size-8 tv:text-base">{option.key}</span>{option.text}
                  </button>
                {/each}
              </div>
            {/if}
            {#if current.note.status}<p class="border-l-2 border-progress pl-2 text-sm text-ink-muted">{current.note.status}</p>{/if}
            {#each current.note.pull_requests.filter((/** @type {any} */ pr) => pr.state === 'open') as pr (pr.url)}
              <a class="spring inline-flex items-center gap-1.5 self-start font-mono text-xs text-progress hover:underline tv:text-base" href={pr.url} target="_blank" rel="noopener noreferrer"><GitPullRequest class="size-3.5" />{pr.repo}#{pr.number}{pr.title ? ` ${pr.title}` : ''}</a>
            {/each}
            {#if recent.length}
              <ul class="mt-auto flex flex-col gap-1 border-t border-line pt-3 font-mono text-[0.6875rem] text-ink-faint tv:text-sm">
                {#each recent as event (event.id)}<li class="truncate">{event.actor_name} · {event.type} · {ago(event.created_at)}</li>{/each}
              </ul>
            {/if}

            {#if replying}
              <form class="flex flex-col gap-2" onsubmit={send} transition:slide={SWAP}>
                <textarea {@attach (node) => node.focus()} bind:value={draft} rows="3" placeholder={TEXT.replyPlaceholder} aria-label={TEXT.reply}
                  class="w-full resize-y border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                  onkeydown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send(/** @type {any} */ (event)); if (event.key === 'Escape') replying = false; }}></textarea>
                <button class="spring press self-end bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!draft.trim()}>{TEXT.send}</button>
              </form>
            {/if}
            {#if snoozing}
              <div class="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4" role="group" aria-label={TEXT.snooze} transition:slide={SWAP}>
                {#each SNOOZES as choice (choice.key)}
                  <button class="spring press bg-surface px-3 py-2.5 text-sm hover:bg-surface-raised tv:text-xl" onclick={() => snooze(choice)}>{choice.label}</button>
                {/each}
              </div>
            {/if}
          </article>
        {/key}
      {:else}
        <div class="col-start-1 row-start-1 flex flex-col items-center justify-center gap-2 p-8 text-center" in:fade={SWAP}>
          <Inbox class="size-8 text-ink-faint tv:size-14" />
          <p class="text-fluid-base font-semibold">{TEXT.empty}</p>
          <p class="max-w-md text-sm text-ink-muted">{TEXT.emptyHint}</p>
        </div>
      {/if}
    </div>

    {#if current}
      <!-- Thumb height on phones: the actions sit under the card, wrapping into two rows on narrow screens -->
      <div class="flex flex-wrap gap-2">
        <button class={PRIMARY} onclick={done}><Check class="size-4" />{TEXT.done}<span class="hidden font-mono text-[0.625rem] text-accent-ink/70 sm:inline">E</span></button>
        <button class={ACTION} aria-expanded={replying} onclick={() => (replying = !replying)}><Reply class="size-4" />{TEXT.reply}<span class={KEY}>R</span></button>
        <button class={ACTION} aria-expanded={snoozing} onclick={() => (snoozing = !snoozing)}><AlarmClock class="size-4" />{TEXT.snooze}<span class={KEY}>L</span></button>
        <button class={ACTION} onclick={() => router.openNote(current.note.id)}><SquareArrowOutUpRight class="size-4" />{TEXT.open}<span class={KEY}>O</span></button>
        <div class="flex flex-1 gap-2 sm:ml-auto sm:flex-none">
          <button class={ACTION} aria-label={TEXT.previous} title="{TEXT.previous} (K)" onclick={() => go(-1)} disabled={items.length < 2}><ChevronLeft class="size-4" /></button>
          <button class={ACTION} aria-label={TEXT.next} title="{TEXT.next} (J)" onclick={() => go(1)} disabled={items.length < 2}><ChevronRight class="size-4" /></button>
        </div>
      </div>
    {/if}
    {#if last}
      <button class="spring press inline-flex items-center gap-1.5 self-start px-2 py-1 text-xs text-ink-muted hover:text-ink" onclick={undo} transition:fade={SWAP}><Undo2 class="size-3.5" />{TEXT.undo}<span class={KEY}>Z</span></button>
    {/if}
  </div>
</div>
