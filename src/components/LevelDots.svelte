<script>
  // The bottom line of a note card: priority dots at the far left in the accent red, difficulty dots at the far right in
  // their level's color (DIFFICULTY_DOT), and anything passed as children centered between them. Each group fills from
  // the left, one dot per level; unlit dots stay faint. With neither level set, only the children show.
  import { DIFFICULTY_DOT } from '../lib/colors.js';
  import { DIFFICULTY_LABELS, MAX_DIFFICULTY, MAX_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** @type {{ priority: number, difficulty: number, children?: import('svelte').Snippet }} */
  let { priority, difficulty, children } = $props();

  // Dot n (1 on the left) is lit when the level reaches n.
  const PRIORITY_DOTS = Array.from({ length: MAX_PRIORITY }, (_, index) => index + 1);
  const DIFFICULTY_DOTS = Array.from({ length: MAX_DIFFICULTY }, (_, index) => index + 1);
  const DOT = 'spring size-1.5 tv:size-2.5 rounded-full';
  const GROUP = 'flex gap-0.5 tv:gap-1';
  const UNLIT = 'bg-line-strong';

  const rated = $derived(Boolean(priority || difficulty));
  const priorityLabel = $derived(priority ? `${PRIORITY_LABELS[priority]} priority` : 'No priority');
  const difficultyLabel = $derived(difficulty ? `${DIFFICULTY_LABELS[difficulty]} difficulty` : 'Unrated difficulty');
</script>

<!-- Three columns: the outer two size to their dots, the middle takes the rest and centers (and truncates) its content -->
<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 tv:gap-4">
  <span class={GROUP} role={rated ? 'img' : undefined} aria-label={rated ? priorityLabel : undefined} title={rated ? priorityLabel : undefined}>
    {#if rated}{#each PRIORITY_DOTS as dot (dot)}<span class="{DOT} {dot <= priority ? 'bg-accent' : UNLIT}"></span>{/each}{/if}
  </span>
  <span class="flex min-w-0 justify-center">{@render children?.()}</span>
  <span class={GROUP} role={rated ? 'img' : undefined} aria-label={rated ? difficultyLabel : undefined} title={rated ? difficultyLabel : undefined}>
    {#if rated}{#each DIFFICULTY_DOTS as dot (dot)}<span class="{DOT} {dot <= difficulty ? DIFFICULTY_DOT[difficulty] : UNLIT}"></span>{/each}{/if}
  </span>
</div>
