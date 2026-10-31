<script>
  // Settings → Appearance: light/dark/system, custom colors with a live WCAG 2.2 AA check and auto-fix,
  // corner style, UI size and reset. State lives in src/lib/appearance.svelte.js and src/lib/ui.svelte.js.
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { fade } from 'svelte/transition';
  import Segmented from './Segmented.svelte';
  import { THEMES, ui } from '../lib/ui.svelte.js';
  import { COLOR_KEYS, CORNERS, SIZES, TEXT_CONTRAST, appearance } from '../lib/appearance.svelte.js';
  import { BOX, BUTTON, HEADING, SUBHEADING } from './settings-styles.js';
  import TEXT from './settings.json';

  const RATIO_DECIMALS = 1;
  const SWAP_MS = 150;
  const THEME_PLACEHOLDER = '{theme}';
  const RATIO_PLACEHOLDER = '{ratio}';

  // While the size slider is dragged it only previews the label; the page rescales on release (change event)
  let draggingSize = $state(-1);
  const sizeIndex = $derived(SIZES.indexOf(appearance.size));
  const shownSize = $derived(draggingSize >= 0 ? draggingSize : sizeIndex);
  const effective = $derived(appearance.effective);
  const checks = $derived(appearance.checks);
  const allOk = $derived(checks.every((check) => check.ok));
</script>

<h2 class={HEADING}>{TEXT.appearance}</h2>

<div class="mt-3 grid gap-5">
  <div>
    <p class={SUBHEADING}>{TEXT.theme}</p>
    <Segmented options={THEMES} value={ui.theme} labels={TEXT.themes} label={TEXT.theme} onselect={(theme) => ui.setTheme(theme)} />
  </div>

  <div>
    <p class={SUBHEADING}>{TEXT.colors}</p>
    <p class="mb-2 text-xs text-ink-muted">{TEXT.colorsHint.replace(THEME_PLACEHOLDER, TEXT.themes[appearance.theme].toLowerCase())}</p>
    <div class="grid grid-cols-2 gap-px overflow-hidden rounded-ui-sm border border-line bg-line sm:grid-cols-4">
      {#each COLOR_KEYS as key (key)}
        <label class="spring flex min-w-0 cursor-pointer items-center gap-2 bg-app p-2 hover:bg-surface-raised">
          <input type="color" class="swatch size-8 shrink-0 cursor-pointer border border-line-strong bg-transparent p-0" value={effective[key]}
            oninput={(event) => appearance.setColor(key, event.currentTarget.value)} />
          <span class="min-w-0">
            <span class="block truncate text-sm">{TEXT.colorNames[key]}</span>
            <span class="selectable block truncate font-mono text-[0.6875rem] text-ink-faint">{effective[key]}</span>
          </span>
        </label>
      {/each}
    </div>

    <!-- Every pair is always listed, so the card never changes height: only the marks and colors swap.
         Only the summary line is live, so dragging a picker doesn't re-announce every ratio. -->
    <div class="mt-2 {BOX} p-3">
      <div class="mb-2 grid items-start text-xs" aria-live="polite">
        {#if allOk}
          <p class="col-start-1 row-start-1 flex items-center gap-1.5 text-complete" transition:fade={{ duration: SWAP_MS }}><Check class="size-3.5 shrink-0" />{TEXT.contrastOk}</p>
        {:else}
          <p class="col-start-1 row-start-1 flex items-center gap-1.5 text-requested" transition:fade={{ duration: SWAP_MS }}><TriangleAlert class="size-3.5 shrink-0" />{TEXT.contrastWarning.replace(RATIO_PLACEHOLDER, String(TEXT_CONTRAST))}</p>
        {/if}
      </div>
      <ul class="grid gap-1 sm:grid-cols-2">
        {#each checks as check (check.pair)}
          <li class="flex min-w-0 items-center gap-2 text-xs">
            <span class="grid size-3.5 shrink-0">
              {#if check.ok}
                <span class="col-start-1 row-start-1" transition:fade={{ duration: SWAP_MS }}><Check class="size-3.5 text-complete" /></span>
              {:else}
                <span class="col-start-1 row-start-1" transition:fade={{ duration: SWAP_MS }}><TriangleAlert class="size-3.5 text-requested" /></span>
              {/if}
            </span>
            <span class="min-w-0 flex-1 truncate {check.ok ? 'text-ink-muted' : 'text-ink'}">{TEXT.pairs[check.pair]}</span>
            <span class="font-mono tabular-nums {check.ok ? 'text-ink-faint' : 'text-requested'}">{check.ratio.toFixed(RATIO_DECIMALS)}:1</span>
          </li>
        {/each}
      </ul>
      <button class="{BUTTON} mt-3 w-full justify-center sm:w-auto" disabled={allOk} onclick={() => appearance.autoFix()}
        title="{TEXT.autoFix} ({TEXT_CONTRAST}:1)"><WandSparkles class="size-4" />{TEXT.autoFix}</button>
    </div>
  </div>

  <div>
    <p class={SUBHEADING}>{TEXT.corners}</p>
    <Segmented options={CORNERS} value={appearance.corners} labels={TEXT.cornerNames} label={TEXT.corners} onselect={(corners) => appearance.setCorners(corners)} />
  </div>

  <!-- --thumb sizes the slider's dot (src/app.css .slider) and places the labels: each is w-8 (2rem) and the row is
       inset so the first and last centers sit thumb/2 in from the ends, exactly where the dot stops -->
  <div class="[--thumb:1.25rem]">
    <div class="mb-2 flex items-baseline justify-between gap-2">
      <label class="{SUBHEADING} mb-0" for="ui-size">{TEXT.size}</label>
      <span class="text-xs text-ink-muted">{TEXT.sizeHint}</span>
    </div>
    <input id="ui-size" type="range" class="slider block w-full cursor-pointer" style:--fill={shownSize / (SIZES.length - 1)} min="0" max={SIZES.length - 1} step="1" value={sizeIndex}
      aria-valuetext={TEXT.sizeNames[SIZES[shownSize]]}
      oninput={(event) => (draggingSize = Number(event.currentTarget.value))}
      onchange={(event) => { appearance.setSize(SIZES[Number(event.currentTarget.value)]); draggingSize = -1; }} />
    <div class="mx-[calc(var(--thumb)/2-1rem)] mt-1 flex justify-between">
      {#each SIZES as size, index (size)}
        <button type="button" tabindex="-1" class="spring press w-8 py-1 text-center font-mono text-xs {index === shownSize ? 'scale-110 font-bold text-accent' : 'text-ink-faint hover:text-ink'}"
          onclick={() => appearance.setSize(size)}>{TEXT.sizeNames[size]}</button>
      {/each}
    </div>
  </div>

  <div class="grid">
    {#if appearance.customized}
      <button class="{BUTTON} col-start-1 row-start-1 justify-self-start hover:text-accent" transition:fade={{ duration: SWAP_MS }} onclick={() => appearance.reset()}>
        <RotateCcw class="size-4" />{TEXT.reset}
      </button>
    {:else}
      <!-- Holds the reset button's space while it is hidden -->
      <span class="{BUTTON} invisible col-start-1 row-start-1 justify-self-start" aria-hidden="true"><RotateCcw class="size-4" />{TEXT.reset}</span>
    {/if}
  </div>
</div>
