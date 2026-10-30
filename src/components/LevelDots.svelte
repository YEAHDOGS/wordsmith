<script>
  // The bottom line of a note card: priority dots at the far left in the accent red, difficulty dots at the far right in
  // their level's color (DIFFICULTY_DOT), and anything passed as children centered between them. Each group fills from
  // the left, one dot per level; unlit dots stay faint. With neither level set, only the children show.
  // Too narrow a card for both (a container query on the card's @container) drops the children to a centered line
  // under the dots instead of cutting them off.
  import { DIFFICULTY_DOT } from '../lib/colors.js';
  import { DIFFICULTY_LABELS, MAX_DIFFICULTY, MAX_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** @type {{ priority: number, difficulty: number, children?: import('svelte').Snippet }} */
  let { priority, difficulty, children } = $props();

  // Dot n (1 on the left) is lit when the level reaches n.
  const PRIORITY_DOTS = Array.from({ length: MAX_PRIORITY }, (_, index) => index + 1);
  const DIFFICULTY_DOTS = Array.from({ length: MAX_DIFFICULTY }, (_, index) => index + 1);
  const DOT = 'spring size-1.5 tv:size-2 rounded-full';
  const GROUP = 'flex gap-0.5';
  const UNLIT = 'bg-line-strong';

  const rated = $derived(Boolean(priority || difficulty));
  const priorityLabel = $derived(priority ? `${PRIORITY_LABELS[priority]} priority` : 'No priority');
  const difficultyLabel = $derived(difficulty ? `${DIFFICULTY_LABELS[difficulty]} difficulty` : 'Unrated difficulty');
</script>

<!-- Three columns: the outer two size to their dots, the middle takes the rest and centers its content, never shrinking
     below that content's full width. Under 8.75rem of card (11rem on TV, with its bigger dots and type), room for two dot
     groups and a 7-character name, it goes two columns and the middle wraps to its own row. -->
<div class="grid grid-cols-[auto_minmax(max-content,1fr)_auto] items-center gap-x-2 gap-y-1 @max-[8.75rem]:grid-cols-2 tv:@max-[11rem]:grid-cols-2">
  <span class={GROUP} role={rated ? 'img' : undefined} aria-label={rated ? priorityLabel : undefined} title={rated ? priorityLabel : undefined}>
    {#if rated}{#each PRIORITY_DOTS as dot (dot)}<span class="{DOT} {dot <= priority ? 'bg-accent' : UNLIT}"></span>{/each}{/if}
  </span>
  <span class="flex justify-center @max-[8.75rem]:col-span-2 @max-[8.75rem]:row-start-2 tv:@max-[11rem]:col-span-2 tv:@max-[11rem]:row-start-2">{@render children?.()}</span>
  <span class="{GROUP} justify-self-end" role={rated ? 'img' : undefined} aria-label={rated ? difficultyLabel : undefined} title={rated ? difficultyLabel : undefined}>
    {#if rated}{#each DIFFICULTY_DOTS as dot (dot)}<span class="{DOT} {dot <= difficulty ? DIFFICULTY_DOT[difficulty] : UNLIT}"></span>{/each}{/if}
  </span>
</div>
