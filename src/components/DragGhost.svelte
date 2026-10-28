<script>
  // The card under the finger while a note is being moved (see src/lib/reorder.svelte.js). Fixed to the viewport and
  // moved with transform only; it lifts in slightly tilted and glides into the card's slot on drop. Inert: it's a
  // picture of the card, the real one stays in the list as the dimmed placeholder. Carrying a selection, it wears a
  // badge with the number of cards moving.
  import { fade, scale } from 'svelte/transition';
  import NoteCard from './NoteCard.svelte';
  import { drag } from '../lib/reorder.svelte.js';

  /** @type {{ showProject?: boolean }} */
  let { showProject = true } = $props();
</script>

{#if drag.note}
  <div class="pointer-events-none fixed top-0 left-0 z-50 {drag.landing ? 'transition-transform duration-150 ease-(--ease-out-soft)' : ''}"
    style:width="{drag.width}px" style:transform="translate3d({drag.x}px, {drag.y}px, 0)" inert aria-hidden="true">
    <div class="spring overflow-hidden border border-accent bg-app ring-1 ring-accent {drag.landing ? '' : 'rotate-1 scale-[1.03]'}"
      in:scale|global={{ start: 0.96, duration: 150 }} out:fade|global={{ duration: 120 }}>
      <NoteCard note={drag.note} {showProject} />
    </div>
    <!-- Carrying a selection: a count badge on the corner says how many cards move together -->
    {#if drag.taking > 1}
      <span class="absolute -top-2 -right-2 flex min-w-6 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 font-mono text-xs font-bold text-accent-ink ring-2 ring-app tv:min-w-9 tv:text-base"
        in:scale|global={{ start: 0.5, duration: 150 }}>{drag.taking}</span>
    {/if}
  </div>
{/if}
