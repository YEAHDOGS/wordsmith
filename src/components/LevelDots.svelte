<script>
  // Two dot columns at the top of a note card: priority on the left in the accent red, difficulty on the right in
  // its level's color (DIFFICULTY_DOT). Each column fills from the bottom, one dot per level; unlit dots stay faint.
  import { DIFFICULTY_DOT } from '../lib/colors.js';
  import { DIFFICULTY_LABELS, MAX_DIFFICULTY, MAX_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** @type {{ priority: number, difficulty: number }} */
  let { priority, difficulty } = $props();

  // Top dot first: dot n (1 at the bottom) is lit when the level reaches n.
  const PRIORITY_DOTS = Array.from({ length: MAX_PRIORITY }, (_, index) => MAX_PRIORITY - index);
  const DIFFICULTY_DOTS = Array.from({ length: MAX_DIFFICULTY }, (_, index) => MAX_DIFFICULTY - index);
  const DOT = 'spring size-1 tv:size-2 rounded-full';
  const UNLIT = 'bg-line-strong';

  const label = $derived([priority ? `${PRIORITY_LABELS[priority]} priority` : '', difficulty ? `${DIFFICULTY_LABELS[difficulty]} difficulty` : ''].filter(Boolean).join(', '));
</script>

<span class="mt-1 flex shrink-0 gap-px tv:mt-2 tv:gap-0.5" role="img" aria-label={label} title={label}>
  <span class="flex flex-col gap-px tv:gap-0.5">
    {#each PRIORITY_DOTS as dot (dot)}<span class="{DOT} {dot <= priority ? 'bg-accent' : UNLIT}"></span>{/each}
  </span>
  <span class="flex flex-col gap-px tv:gap-0.5">
    {#each DIFFICULTY_DOTS as dot (dot)}<span class="{DOT} {dot <= difficulty ? DIFFICULTY_DOT[difficulty] : UNLIT}"></span>{/each}
  </span>
</span>
