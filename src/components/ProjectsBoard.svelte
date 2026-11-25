<script>
  // The Projects page: every project as a thumbnail card. The thumbnail is the newest image attached to the project's
  // notes, or the project's initials on its color when it has none; a thin bar under it shows how its features split
  // between requested, in progress and complete. The slider makes the thumbnails smaller or larger (the grid fits as
  // many columns as there is room for, so nothing ever scrolls sideways), and the picker orders them eight ways
  // (projects-board.js). The search box filters by name, mission and repo. Choices are remembered on this device.
  // Only the grid scrolls; the controls stay put.
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import ArrowUpNarrowWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import Tag from '@lucide/svelte/icons/tag';
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { DOT_BG, DOT_TEXT, STATE_STYLE, TINT_BG } from '../lib/colors.js';
  import { FEATURE_STATES } from '../lib/models.js';
  import { ago, fullTime } from '../lib/time.js';
  import { DETAIL_FROM_SIZE, SIZES, SORTS, arrange, loadPrefs, projectCards, savePrefs, searchCards, startsDescending } from './projects-board.js';
  import TEXT from './projects-board.json';

  const CARD_STAGGER_MS = 30;
  const MAX_STAGGERED = 12;
  const FLIP_MS = 220;
  const INITIALS = 2;
  const CONTROL = 'spring press flex h-8 shrink-0 items-center justify-center rounded-ui-sm border border-line text-ink-muted hover:border-line-strong hover:text-ink tv:h-11';
  const STEP_BUTTON = 'spring press flex size-8 shrink-0 items-center justify-center text-ink-muted hover:text-accent disabled:opacity-30 tv:size-11';

  let prefs = $state(loadPrefs());
  // The stop under the thumb while it is dragged; the choice is saved when the drag ends.
  let dragging = $state(-1);
  const size = $derived(dragging === -1 ? prefs.size : dragging);
  const detailed = $derived(size >= DETAIL_FROM_SIZE);

  const cards = $derived(projectCards(store));
  const groups = $derived(arrange(searchCards(cards, ui.query), prefs, { colors: TEXT.colors, noTag: TEXT.noTag }));
  const shown = $derived(groups.reduce((total, group) => total + group.cards.length, 0));

  /** @param {Partial<import('./projects-board.js').BoardPrefs>} change */
  function choose(change) {
    prefs = { ...prefs, ...change };
    savePrefs(prefs);
  }

  /** The letters on a thumbnail with no image: the first letter of the first two words, or a lone word's first two. @param {string} name */
  function initials(name) {
    const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length < INITIALS) return [...(words[0] || name)].slice(0, INITIALS).join('');
    return words.slice(0, INITIALS).map((word) => [...word][0]).join('');
  }

  /** @param {number} step */
  function resize(step) {
    choose({ size: Math.min(SIZES.length - 1, Math.max(0, prefs.size + step)) });
  }
</script>

<div class="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col px-2 sm:px-4 ultrawide:max-w-none">
  <div class="flex shrink-0 flex-wrap items-center gap-2 py-2 sm:py-3 short:py-1">
    <select class="{CONTROL} min-w-0 cursor-pointer bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none tv:text-base" aria-label={TEXT.sortLabel}
      title={TEXT.sortHints[prefs.sort]} value={prefs.sort}
      onchange={(event) => { const sort = /** @type {typeof SORTS[number]} */ (event.currentTarget.value); choose({ sort, descending: startsDescending(sort) }); }}>
      {#each SORTS as sort (sort)}<option value={sort}>{TEXT.sorts[sort]}</option>{/each}
    </select>
    <button class="{CONTROL} w-8 tv:w-11" aria-label={prefs.descending ? TEXT.descending : TEXT.ascending} title={prefs.descending ? TEXT.descending : TEXT.ascending}
      onclick={() => choose({ descending: !prefs.descending })}>
      {#key prefs.descending}
        <span class="icon-swap flex">{#if prefs.descending}<ArrowDownWideNarrow class="size-4 tv:size-6" />{:else}<ArrowUpNarrowWide class="size-4 tv:size-6" />{/if}</span>
      {/key}
    </button>

    <!-- --thumb sizes the slider's dot (src/app.css .slider) -->
    <div class="ml-auto flex min-w-0 items-center [--thumb:1rem]">
      <button class={STEP_BUTTON} aria-label={TEXT.smaller} title={TEXT.smaller} disabled={prefs.size === 0} onclick={() => resize(-1)}><Minus class="size-4 tv:size-6" /></button>
      <input type="range" class="slider block w-20 min-w-0 cursor-pointer sm:w-36 tv:w-56" style:--fill={size / (SIZES.length - 1)} min="0" max={SIZES.length - 1} step="1" value={size}
        aria-label={TEXT.size} aria-valuetext={TEXT.sizeValue.replace('{step}', String(size + 1)).replace('{steps}', String(SIZES.length))}
        oninput={(event) => (dragging = Number(event.currentTarget.value))}
        onchange={(event) => { choose({ size: Number(event.currentTarget.value) }); dragging = -1; }} />
      <button class={STEP_BUTTON} aria-label={TEXT.larger} title={TEXT.larger} disabled={prefs.size === SIZES.length - 1} onclick={() => resize(1)}><Plus class="size-4 tv:size-6" /></button>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6">
    {#if !cards.length}
      <div class="flex flex-col items-center gap-2 px-4 py-16 text-center short:py-6" in:fade={{ duration: 200 }}>
        <h2 class="text-fluid-lg font-bold tracking-tight text-ink">{TEXT.emptyTitle}</h2>
        <p class="max-w-md text-sm text-ink-muted">{TEXT.emptyBody}</p>
      </div>
    {:else if !shown}
      <p class="px-4 py-12 text-center text-sm text-ink-muted" in:fade={{ duration: 200 }}>{TEXT.noMatches}</p>
    {/if}

    {#each groups as group (group.key)}
      {#if group.heading}
        <h2 class="flex items-center gap-2 pt-3 pb-2 font-mono text-[0.6875rem] tracking-widest text-ink-faint uppercase first:pt-0 tv:text-sm" in:fade={{ duration: 200 }}>
          {#if prefs.sort === 'theme'}<span class="size-2 shrink-0 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (group.key)] || DOT_BG.default}" aria-hidden="true"></span>{/if}
          {#if prefs.sort === 'tag'}<Tag class="size-3 shrink-0" aria-hidden="true" />{/if}
          <span class="min-w-0 truncate">{group.heading}</span>
          <span class="tabular-nums">{group.cards.length}</span>
        </h2>
      {/if}
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(var(--tile),100%),1fr))] gap-2 sm:gap-3" style:--tile="{SIZES[size]}rem">
        {#each group.cards as card, index (card.project.id)}
          {@const project = card.project}
          {@const color = /** @type {keyof typeof DOT_BG} */ (project.color in DOT_BG ? project.color : 'default')}
          <li class="min-w-0" animate:flip={{ duration: FLIP_MS }} in:fly={{ y: 10, duration: 260, delay: Math.min(index, MAX_STAGGERED) * CARD_STAGGER_MS }}>
            <button class="group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-ui border border-line bg-surface text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface-raised focus-visible:border-accent"
              aria-label={TEXT.open.replace('{project}', project.name)} title={detailed ? undefined : project.name} onclick={() => router.go('project', project.id)}>
              <span class="relative block aspect-video w-full overflow-hidden {TINT_BG[color]}">
                {#if card.cover}
                  <AttachmentMedia file={card.cover} class="spring size-full object-cover group-hover:scale-105" />
                {:else}
                  <span class="spring absolute inset-0 flex items-center justify-center font-mono text-fluid-lg font-black tracking-tight uppercase group-hover:scale-110 {DOT_TEXT[color]}" aria-hidden="true">{initials(project.name)}</span>
                {/if}
                <!-- How the project's features split between the states; empty projects keep a plain line -->
                <span class="absolute inset-x-0 bottom-0 flex h-1 bg-line" aria-hidden="true">
                  {#each FEATURE_STATES as state (state)}
                    {#if card.counts[state]}<span class="spring {STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)].dot}" style:flex-grow={card.counts[state]}></span>{/if}
                  {/each}
                </span>
              </span>
              <span class="flex min-w-0 items-center gap-2 px-2.5 pt-2 {detailed ? '' : 'pb-2'}">
                <span class="size-2 shrink-0 rounded-full {DOT_BG[color]}" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink tv:text-xl">{project.name}</span>
                {#if detailed}<span class="shrink-0 font-mono text-[0.6875rem] text-ink-faint tv:text-sm" title={TEXT.touched.replace('{time}', fullTime(card.touched))}>{ago(card.touched)}</span>{/if}
              </span>
              {#if detailed}
                <!-- Two lines are always reserved, so cards in a row stay the same height with or without a mission -->
                <span class="mt-1 line-clamp-2 h-8 px-2.5 text-xs leading-4 tv:h-12 tv:text-base tv:leading-6 {card.description ? 'text-ink-muted' : 'text-ink-faint'}">{card.description || TEXT.noDescription}</span>
                <span class="flex min-w-0 items-center gap-2.5 px-2.5 pt-2 pb-2.5 font-mono text-[0.6875rem] text-ink-faint tv:text-sm">
                  {#each FEATURE_STATES as state (state)}
                    {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]}
                    <span class="flex shrink-0 items-center gap-1 tabular-nums {card.counts[state] ? style.text : ''}" title="{style.label}: {card.counts[state]}">
                      <span class="size-1.5 rounded-full {card.counts[state] ? style.dot : 'bg-line-strong'}" aria-hidden="true"></span>{card.counts[state]}
                    </span>
                  {/each}
                  {#if card.tag}<span class="ml-auto flex min-w-0 items-center gap-1"><Tag class="size-3 shrink-0" aria-hidden="true" /><span class="min-w-0 truncate">{card.tag.name}</span></span>{/if}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </div>
</div>
