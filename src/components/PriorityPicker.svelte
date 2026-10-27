<script>
  // Priority radio group for the note editor and the feature request form: one button per level, with its number and
  // label; loud levels (LOUD_PRIORITY and up) turn the accent when chosen. Arrow keys move the choice, for keyboards
  // and TV remotes; only the chosen level is in the tab order (the same pattern as Segmented).
  import { LOUD_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** Arrow key -> how far the choice moves. */
  const KEY_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

  /** @type {{ value: number, levels: number[], onselect: (level: number) => void, class?: string }} */
  let { value, levels, onselect, class: className = '' } = $props();

  const index = $derived(Math.max(0, levels.indexOf(value)));

  /** @param {KeyboardEvent & { currentTarget: HTMLElement }} event */
  function onkeydown(event) {
    const step = KEY_STEPS[/** @type {keyof typeof KEY_STEPS} */ (event.key)];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + levels.length) % levels.length;
    onselect(levels[next]);
    event.currentTarget.querySelectorAll('button')[next]?.focus();
  }
</script>

<div class="grid gap-px border border-line bg-line {className}" role="radiogroup" aria-label="Priority" tabindex="-1" {onkeydown}>
  {#each levels as level, slot (level)}
    {@const on = value === level}
    <button type="button" role="radio" aria-checked={on} tabindex={slot === index ? 0 : -1} title="{PRIORITY_LABELS[level]} priority" onclick={() => onselect(level)}
      class="spring press flex min-w-0 items-center justify-center gap-1 px-1 py-2 text-xs font-semibold {on ? (level >= LOUD_PRIORITY ? 'bg-accent-soft text-accent' : 'bg-surface-raised text-ink') : 'bg-app text-ink-muted hover:bg-surface-raised'}">
      <span class="font-mono text-[0.625rem] {on ? '' : 'text-ink-faint'}">{level || '–'}</span><span class="truncate">{PRIORITY_LABELS[level]}</span>
    </button>
  {/each}
</div>
