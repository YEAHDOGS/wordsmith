<script>
  // The ticket calendar: a month of days, each holding the tickets that moved on it (created, started, completed,
  // a PR merged; calendar.js). Pick a day to list its moments; a moment opens its ticket. Months change with the
  // arrows, Page Up/Down, a sideways swipe or drag, or the scroll wheel, and slide in from the side they come from.
  // Portrait screens stack the month above the day's list (short ones with a shorter month); landscape and squat
  // windows (src/styles/theme.css) put the list beside it.
  // The grid is always six weeks and never scrolls; only the day's list does.
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { fade, fly } from 'svelte/transition';
  import { cubicIn, quintOut } from 'svelte/easing';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CirclePlus from '@lucide/svelte/icons/circle-plus';
  import Play from '@lucide/svelte/icons/play';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { DOT_BG, STATE_STYLE } from '../lib/colors.js';
  import { clockTime } from '../lib/time.js';
  import { fill } from '../lib/fill.js';
  import { EVENT_KINDS, dayKey, firstWeekday, monthDays, shiftDay, ticketDays, weekdayNames } from './calendar.js';
  import TEXT from './calendar.json';

  /** @type {{ notes: any[] }} The tickets to place: live ones matching the search */
  let { notes } = $props();

  // Capped like every page on desktop; TVs and ultra-wide screens give the month their full width.
  const CONTENT = 'mx-auto w-full max-w-7xl tv:max-w-none ultrawide:max-w-none';
  // Each kind of moment wears the state it moves a ticket into.
  const KINDS = {
    created: { icon: CirclePlus, style: STATE_STYLE.requested },
    started: { icon: Play, style: STATE_STYLE.in_progress },
    completed: { icon: CircleCheck, style: STATE_STYLE.complete },
    merged: { icon: GitMerge, style: STATE_STYLE.complete },
  };
  /** @type {Record<string, number>} */
  const KEY_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  /** @type {Record<string, number>} */
  const PAGE_STEPS = { PageUp: -1, PageDown: 1 };
  const CLOCK_MS = 60_000;
  // A pointer that travels this far sideways (and more sideways than down) turns the month.
  const SWIPE_PX = 48;
  // Wheel travel that turns one month (one notch anywhere: Chrome sends 100px, Firefox 3 lines = 48px), and the quiet
  // time after a turn before the wheel can turn another.
  const WHEEL_STEP = 40;
  const WHEEL_REST_MS = 400;
  // Wheel deltas in lines (deltaMode 1, Firefox: a notch is 3 lines) and pages (deltaMode 2), as pixels.
  const LINE_PX = 16;
  const PAGE_PX = 400;
  const SLIDE_PERCENT = 30;
  const MONTH_IN_MS = 260;
  const MONTH_OUT_MS = 160;
  const LABEL_SHIFT_PX = 8;
  const ROW_IN_MS = 200;
  const ROW_RISE_PX = 6;
  const ROW_STAGGER_MS = 30;
  const MAX_STAGGER_MS = 300;
  const MAX_CHIPS = 2;
  const MAX_DOTS = 4;
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
  const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const MONTH_SHORT_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
  const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const FIRST_WEEKDAY = firstWeekday();
  const WEEKDAYS = weekdayNames(FIRST_WEEKDAY);
  const NAV_BUTTON = 'spring press flex size-8 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink tv:size-12';
  const KIND_BUTTON = 'spring press inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.6875rem] tv:px-2.5 tv:py-1 tv:text-sm';

  const now = new Date();
  let today = $state(dayKey(now));
  let selected = $state(dayKey(now));
  let year = $state(now.getFullYear());
  let month = $state(now.getMonth());
  /** +1 when the new month comes from the right (later), -1 from the left. */
  let direction = $state(1);
  const hidden = new SvelteSet();
  /** @type {HTMLElement | undefined} */
  let grid = $state();

  const days = $derived(ticketDays(notes));
  const cells = $derived(monthDays(year, month, FIRST_WEEKDAY));
  const monthKey = $derived(`${year}-${month}`);
  const monthLabel = $derived(MONTH_FORMAT.format(new Date(year, month, 1)));
  const monthShort = $derived(MONTH_SHORT_FORMAT.format(new Date(year, month, 1)));
  const selectedDate = $derived.by(() => {
    const [y, m, d] = selected.split('-').map(Number);
    return new Date(y, m - 1, d);
  });
  const selectedEvents = $derived(shown(selected));
  const monthCount = $derived(cells.reduce((sum, cell) => sum + (cell.inMonth ? shown(cell.key).length : 0), 0));

  /** A ticket's name: its title, or the first line of its body. @param {any} note */
  const titleOf = (note) => (note.title || note.body || '').trim().split('\n')[0];
  /** @param {number} ms */
  const motion = (ms) => (REDUCED_MOTION.matches ? 0 : ms);
  /** @param {string} kind */
  const kindOf = (kind) => KINDS[/** @type {keyof typeof KINDS} */ (kind)];

  /** The day's moments, minus the kinds switched off. @param {string} key */
  function shown(key) {
    return (days.get(key) ?? []).filter((event) => !hidden.has(event.kind));
  }

  /** @param {number} nextYear @param {number} nextMonth 0-11, may overflow */
  function showMonth(nextYear, nextMonth) {
    const target = new Date(nextYear, nextMonth, 1);
    const from = new Date(year, month, 1);
    if (target.getTime() === from.getTime()) return;
    direction = target > from ? 1 : -1;
    year = target.getFullYear();
    month = target.getMonth();
  }

  /** Select a day, bringing its month into view. @param {string} key @param {boolean} [focus] move keyboard focus to it */
  function select(key, focus = false) {
    selected = key;
    const [y, m] = key.split('-').map(Number);
    showMonth(y, m - 1);
    if (!focus) return;
    tick().then(() => /** @type {HTMLElement | null | undefined} */ (grid?.querySelector(`[data-month="${monthKey}"] [data-day="${key}"]`))?.focus());
  }

  /** Turn by whole months; the selection moves to today if it's in that month, otherwise the 1st. @param {number} by */
  function turn(by) {
    const target = new Date(year, month + by, 1);
    const todayDate = new Date();
    const hasToday = todayDate.getFullYear() === target.getFullYear() && todayDate.getMonth() === target.getMonth();
    select(dayKey(hasToday ? todayDate : target));
  }

  /** On a day, the arrows walk the days. @param {KeyboardEvent} event */
  function onkeydown(event) {
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    select(shiftDay(selected, step), true);
  }

  /** Anywhere on the page, Page Up/Down jump a month to the same date (or the month's last day). @param {KeyboardEvent} event */
  function onpagekey(event) {
    const by = PAGE_STEPS[event.key];
    if (!by) return;
    event.preventDefault();
    const date = selectedDate;
    const lastDay = new Date(date.getFullYear(), date.getMonth() + by + 1, 0).getDate();
    // Focus on a day or in the day's list would vanish with the old month and list, so it moves to the new day;
    // on Today or a filter it stays put.
    const replaced = /** @type {HTMLElement} */ (event.target).closest?.('[data-day], [data-moments]');
    select(dayKey(new Date(date.getFullYear(), date.getMonth() + by, Math.min(date.getDate(), lastDay))), Boolean(replaced));
  }

  /** Page Up/Down for the whole calendar, the day list included. @param {HTMLElement} node */
  function pageKeys(node) {
    node.addEventListener('keydown', onpagekey);
    return () => node.removeEventListener('keydown', onpagekey);
  }

  /** @type {{ x: number, y: number } | null} */
  let pointerStart = null;
  /** True right after a swipe, so the click that ends it doesn't also pick a day. */
  let swiped = false;

  /** @param {PointerEvent} event */
  function onpointerdown(event) {
    if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY };
  }

  /** @param {PointerEvent} event */
  function onpointerup(event) {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    swiped = true;
    setTimeout(() => (swiped = false));
    turn(dx < 0 ? 1 : -1);
  }

  /** @param {MouseEvent} event */
  function onclickcapture(event) {
    if (!swiped) return;
    event.stopPropagation();
    swiped = false;
  }

  let wheelTravel = 0;
  let wheelRestUntil = 0;
  let lastWheel = 0;
  /** One month per wheel gesture, either axis: a fling's tail keeps the rest going instead of turning again. @param {WheelEvent} event */
  function onwheel(event) {
    if (event.ctrlKey) return;
    if (event.timeStamp < wheelRestUntil) {
      wheelRestUntil = event.timeStamp + WHEEL_REST_MS;
      return;
    }
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? PAGE_PX : 1;
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * scale;
    // A new gesture, or a turn the other way, starts a fresh count.
    if (event.timeStamp - lastWheel > WHEEL_REST_MS || Math.sign(delta) !== Math.sign(wheelTravel)) wheelTravel = 0;
    lastWheel = event.timeStamp;
    wheelTravel += delta;
    if (Math.abs(wheelTravel) < WHEEL_STEP) return;
    turn(Math.sign(wheelTravel));
    wheelTravel = 0;
    wheelRestUntil = event.timeStamp + WHEEL_REST_MS;
  }

  /** Swipe, drag and wheel listeners for the month grid (the days themselves are the focusable buttons). @param {HTMLElement} node */
  function gestures(node) {
    const cancel = () => (pointerStart = null);
    node.addEventListener('pointerdown', onpointerdown);
    node.addEventListener('pointerup', onpointerup);
    node.addEventListener('pointercancel', cancel);
    // A press that leaves the grid is no longer a swipe, so a later release can't reuse its start.
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('wheel', onwheel, { passive: true });
    node.addEventListener('click', onclickcapture, true);
    return () => {
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('pointerup', onpointerup);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('wheel', onwheel);
      node.removeEventListener('click', onclickcapture, true);
    };
  }

  // Midnight passes while the page is open: today's mark moves on.
  $effect(() => {
    const timer = setInterval(() => (today = dayKey(Date.now())), CLOCK_MS);
    return () => clearInterval(timer);
  });
</script>

<div class="{CONTENT} flex min-h-0 flex-1 flex-col landscape:flex-row squat:flex-row" {@attach pageKeys}>
  <section class="flex h-[min(58dvh,38rem,calc(100dvh_-_20rem))] shrink-0 flex-col landscape:h-auto landscape:min-w-0 landscape:flex-1 short:h-[48dvh] squat:h-auto squat:min-w-0 squat:flex-1" aria-labelledby="calendar-month">
    <div class="@container/controls flex shrink-0 items-center gap-1 border-b border-line px-1 py-1 sm:px-3 tv:py-3">
      <button class={NAV_BUTTON} aria-label={TEXT.previous} title={TEXT.previous} onclick={() => turn(-1)}><ChevronLeft class="size-4 tv:size-6" /></button>
      <!-- One grid cell: the leaving month's name slides out under the arriving one -->
      <h2 id="calendar-month" class="grid min-w-0 flex-1 overflow-hidden text-center text-xs font-semibold text-ink @xs/controls:text-sm sm:text-base tv:text-2xl" aria-live="polite">
        {#key monthKey}
          <span class="col-start-1 row-start-1 truncate" in:fly={{ y: direction * LABEL_SHIFT_PX, duration: motion(MONTH_IN_MS), easing: quintOut }} out:fade={{ duration: motion(MONTH_OUT_MS) }}>
            <!-- Narrow windows name the month short ("Nov 2026") so it never truncates -->
            <span class="@xs/controls:hidden">{monthShort}</span><span class="hidden @xs/controls:inline">{monthLabel}</span>
          </span>
        {/key}
      </h2>
      <span class="hidden shrink-0 font-mono text-[0.6875rem] text-ink-faint tabular-nums sm:inline tv:text-sm">{fill(TEXT.monthTotals, { n: monthCount })}</span>
      <button class={NAV_BUTTON} aria-label={TEXT.next} title={TEXT.next} onclick={() => turn(1)}><ChevronRight class="size-4 tv:size-6" /></button>
      <button class="spring press shrink-0 border border-line px-1.5 py-1 text-xs @xs/controls:px-2 text-ink-muted hover:border-accent hover:text-ink tv:px-4 tv:py-2 tv:text-lg" onclick={() => select(today)}>{TEXT.today}</button>
    </div>

    <div class="grid shrink-0 grid-cols-7 border-b border-line text-center font-mono text-[0.625rem] uppercase text-ink-faint sm:text-[0.6875rem] tv:text-sm" aria-hidden="true">
      {#each WEEKDAYS as weekday, index (index)}
        <span class="truncate py-1 tv:py-2"><span class="sm:hidden">{weekday.narrow}</span><span class="hidden sm:inline">{weekday.short}</span></span>
      {/each}
    </div>

    <!-- The month: a 1px-lined grid. Swipe, drag or wheel it sideways to change months; the arrow keys walk the days. -->
    <div class="@container relative grid min-h-0 flex-1 touch-pan-y select-none overflow-hidden" bind:this={grid} role="group" aria-label={fill(TEXT.gridLabel, { month: monthLabel })}
      {@attach gestures}>
      {#key monthKey}
        <div data-month={monthKey} class="col-start-1 row-start-1 grid min-h-0 grid-cols-7 grid-rows-6 gap-px bg-line"
          in:fly={{ x: `${direction * SLIDE_PERCENT}%`, duration: motion(MONTH_IN_MS), easing: quintOut }}
          out:fly={{ x: `${-direction * SLIDE_PERCENT}%`, duration: motion(MONTH_OUT_MS), easing: cubicIn }}>
          {#each cells as cell (cell.key)}
            {@const events = shown(cell.key)}
            {@const isToday = cell.key === today}
            {@const isSelected = cell.key === selected}
            <button data-day={cell.key} tabindex={isSelected ? 0 : -1} onclick={() => select(cell.key, !cell.inMonth)} {onkeydown}
              class="spring relative flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden p-1 text-left focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:p-1.5 tv:gap-1 tv:p-3
                {isSelected ? 'bg-accent-soft' : cell.inMonth ? 'bg-surface hover:bg-surface-raised' : 'bg-app hover:bg-surface-raised'} {cell.inMonth ? 'text-ink' : 'text-ink-faint'}"
              aria-label="{DAY_FORMAT.format(cell.date)}, {events.length === 1 ? TEXT.dayEvent : fill(TEXT.dayEvents, { n: events.length })}{isSelected ? `, ${TEXT.selected}` : ''}"
              aria-current={isToday ? 'date' : undefined}>
              <span class="flex items-center justify-between gap-1">
                <span class="spring flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums sm:size-6 tv:size-10 tv:text-lg
                  {isToday ? 'bg-accent text-accent-ink' : ''} {isSelected && !isToday ? 'scale-110 text-accent' : ''}">{cell.day}</span>
                {#if events.length}<span class="hidden font-mono text-[0.625rem] text-ink-faint tabular-nums @2xl:inline tv:text-sm">{events.length}</span>{/if}
              </span>
              <!-- A wide grid names the tickets; a narrow one shows a dot per moment -->
              <span class="hidden min-h-0 flex-col gap-0.5 @2xl:flex" aria-hidden="true">
                {#each events.slice(0, MAX_CHIPS) as event, index (index)}
                  {@const style = kindOf(event.kind).style}
                  <span class="truncate px-1 text-[0.6875rem] leading-4 tv:text-sm tv:leading-6 {style.soft} {style.text}">{titleOf(event.note) || TEXT.untitled}</span>
                {/each}
                {#if events.length > MAX_CHIPS}<span class="truncate px-1 text-[0.625rem] leading-4 text-ink-faint tv:text-sm">{fill(TEXT.more, { n: events.length - MAX_CHIPS })}</span>{/if}
              </span>
              <span class="flex flex-wrap gap-0.5 @2xl:hidden" aria-hidden="true">
                {#each events.slice(0, MAX_DOTS) as event, index (index)}<span class="size-1.5 rounded-full {kindOf(event.kind).style.dot}"></span>{/each}
              </span>
            </button>
          {/each}
        </div>
      {/key}
    </div>
  </section>

  <aside class="flex min-h-0 flex-1 flex-col border-t border-line landscape:w-2/5 landscape:max-w-80 landscape:flex-none landscape:border-t-0 landscape:border-l squat:w-2/5 squat:max-w-80 squat:flex-none squat:border-t-0 squat:border-l tv:max-w-[32rem] ultrawide:max-w-[40rem]"
    aria-label={fill(TEXT.dayList, { day: DAY_FORMAT.format(selectedDate) })}>
    <div class="shrink-0 border-b border-line px-3 py-2 sm:px-4 tv:py-4">
      <div class="grid overflow-hidden">
        {#key selected}
          <p class="col-start-1 row-start-1 truncate text-sm font-semibold text-ink tv:text-xl" in:fade={{ duration: motion(MONTH_IN_MS) }}>{DAY_FORMAT.format(selectedDate)}</p>
        {/key}
      </div>
      <p class="font-mono text-[0.6875rem] text-ink-faint tabular-nums tv:text-sm">{selectedEvents.length === 1 ? TEXT.dayEvent : fill(TEXT.dayEvents, { n: selectedEvents.length })}</p>
      <!-- Switch kinds of moments on and off; short screens keep just the icons -->
      <div class="mt-2 flex flex-wrap gap-1" role="group" aria-label={TEXT.filters}>
        {#each EVENT_KINDS as kind (kind)}
          {@const entry = kindOf(kind)}
          {@const on = !hidden.has(kind)}
          <button class="{KIND_BUTTON} {on ? `${entry.style.border} ${entry.style.soft} ${entry.style.text}` : 'border-line text-ink-faint hover:text-ink'}"
            aria-pressed={on} title={fill(on ? TEXT.hide : TEXT.show, { kind: TEXT.kinds[/** @type {keyof typeof TEXT.kinds} */ (kind)] })}
            onclick={() => (on ? hidden.add(kind) : hidden.delete(kind))}>
            <entry.icon class="size-3 shrink-0 tv:size-4" />
            <span class="short:sr-only">{TEXT.kinds[/** @type {keyof typeof TEXT.kinds} */ (kind)]}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-moments>
      {#key selected}
        {#if !notes.length}
          <p class="px-4 py-10 text-center text-sm text-ink-faint tv:text-xl" in:fade={{ duration: motion(ROW_IN_MS) }}>{ui.query ? TEXT.noMatches : TEXT.noTickets}</p>
        {:else if !selectedEvents.length}
          <p class="px-4 py-10 text-center text-sm text-ink-faint tv:text-xl" in:fade={{ duration: motion(ROW_IN_MS) }}>{days.get(selected)?.length ? TEXT.allHidden : TEXT.nothing}</p>
        {:else}
          <ul>
            {#each selectedEvents as event, index (index)}
              {@const entry = kindOf(event.kind)}
              {@const project = event.note.project_id ? store.find('projects', event.note.project_id) : null}
              {@const title = titleOf(event.note)}
              <li in:fly={{ y: ROW_RISE_PX, duration: motion(ROW_IN_MS), delay: motion(Math.min(index * ROW_STAGGER_MS, MAX_STAGGER_MS)), easing: quintOut }}>
                <button class="spring flex w-full min-w-0 items-start gap-2.5 border-b border-line px-3 py-2.5 text-left hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-4 tv:gap-4 tv:py-4"
                  onclick={() => router.openNote(event.note.id)}>
                  <entry.icon class="mt-0.5 size-4 shrink-0 {entry.style.text} tv:size-6" />
                  <span class="min-w-0 flex-1">
                    <span class="line-clamp-2 text-sm break-words tv:text-xl {title ? 'text-ink' : 'italic text-ink-muted'}">{title || TEXT.untitled}</span>
                    <span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[0.6875rem] text-ink-faint tv:text-sm">
                      <span class={entry.style.text}>{TEXT.kinds[/** @type {keyof typeof TEXT.kinds} */ (event.kind)]}{event.pr?.number ? ` #${event.pr.number}` : ''}</span>
                      <span class="tabular-nums">{clockTime(event.at)}</span>
                      {#if project && !project.deleted_at}
                        <span class="flex min-w-0 items-center gap-1">
                          <span class="size-1.5 shrink-0 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (project.color)] || DOT_BG.default}"></span>
                          <span class="truncate">{project.name}</span>
                        </span>
                      {/if}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/key}
    </div>
  </aside>
</div>
