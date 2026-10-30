<script>
  // One line of dots under a note card's pin and select: priority at the far left in the accent red, difficulty at the
  // far right in its level's color (DIFFICULTY_DOT). Each group fills from the left, one dot per level; unlit dots stay faint.
  import { DIFFICULTY_DOT } from '../lib/colors.js';
  import { DIFFICULTY_LABELS, MAX_DIFFICULTY, MAX_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** @type {{ priority: number, difficulty: number }} */
  let { priority, difficulty } = $props();

  // Dot n (1 on the left) is lit when the level reaches n.
  const PRIORITY_DOTS = Array.from({ length: MAX_PRIORITY }, (_, index) => index + 1);
  const DIFFICULTY_DOTS = Array.from({ length: MAX_DIFFICULTY }, (_, index) => index + 1);
  const DOT = 'spring size-1.5 tv:size-2.5 rounded-full';
  const GROUP = 'flex gap-0.5 tv:gap-1';
  const UNLIT = 'bg-line-strong';

  const label = $derived([priority ? `${PRIORITY_LABELS[priority]} priority` : '', difficulty ? `${DIFFICULTY_LABELS[difficulty]} difficulty` : ''].filter(Boolean).join(', '));
</script>

<span class="flex items-center justify-between gap-3 tv:gap-5" role="img" aria-label={label} title={label}>
  <span class={GROUP}>
    {#each PRIORITY_DOTS as dot (dot)}<span class="{DOT} {dot <= priority ? 'bg-accent' : UNLIT}"></span>{/each}
  </span>
  <span class={GROUP}>
    {#each DIFFICULTY_DOTS as dot (dot)}<span class="{DOT} {dot <= difficulty ? DIFFICULTY_DOT[difficulty] : UNLIT}"></span>{/each}
  </span>
</span>
