<script>
  // Level radio group for the note editor and the feature request form: priority by default, difficulty with
  // labels={DIFFICULTY_LABELS}. One button per level, with its number and label; loud levels (from `loud` up) turn the
  // accent when chosen. Arrow keys move the choice, for keyboards and TV remotes; only the chosen level is in the tab
  // order (the same pattern as Segmented).
  import { LOUD_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** Arrow key -> how far the choice moves. */
  const KEY_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

  /** @type {{ value: number, levels: number[], onselect: (level: number) => void, labels?: string[], name?: string, loud?: number, class?: string }} */
  let { value, levels, onselect, labels = PRIORITY_LABELS, name = 'Priority', loud = LOUD_PRIORITY, class: className = '' } = $props();

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

<div class="grid gap-px border border-line bg-line {className}" role="radiogroup" aria-label={name} tabindex="-1" {onkeydown}>
  {#each levels as level, slot (level)}
    {@const on = value === level}
    <button type="button" role="radio" aria-checked={on} tabindex={slot === index ? 0 : -1} title="{name}: {labels[level]}" onclick={() => onselect(level)}
      class="spring press flex min-w-0 items-center justify-center gap-1 px-1 py-2 text-xs font-semibold {on ? (level >= loud ? 'bg-accent-soft text-accent' : 'bg-surface-raised text-ink') : 'bg-app text-ink-muted hover:bg-surface-raised'}">
      <span class="font-mono text-[0.625rem] {on ? '' : 'text-ink-faint'}">{level || '–'}</span><span class="truncate">{labels[level]}</span>
    </button>
  {/each}
</div>
