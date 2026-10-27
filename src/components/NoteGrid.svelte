<script>
  // Notes laid out on a 1px grid: the container shows the line color through 1px gaps between cards.
  // Pinned notes get their own band on top. Only this list scrolls.
  import { flip } from 'svelte/animate';
  import { scale } from 'svelte/transition';
  import NoteCard from './NoteCard.svelte';
  import { reveal } from '../lib/reveal.js';

  /** @type {{ notes: any[], showProject?: boolean, empty?: string }} */
  let { notes, showProject = true, empty = 'Nothing here yet.' } = $props();

  const GRID = 'grid gap-px border-y border-line bg-line sm:border sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 ultrawide:grid-cols-6 tallscreen:grid-cols-2 tv:grid-cols-4';
  const pinned = $derived(notes.filter((note) => note.pinned));
  const others = $derived(notes.filter((note) => !note.pinned));
</script>

{#snippet section(/** @type {string} */ title, /** @type {any[]} */ list)}
  {#if title}<h2 class="px-4 pt-4 pb-2 sm:px-0 font-mono text-[11px] tv:text-sm uppercase tracking-widest text-ink-faint">{title}</h2>{/if}
  <div class={GRID}>
    {#each list as note, index (note.id)}
      <div class="bg-app" animate:flip={{ duration: 200 }} in:scale={{ start: 0.96, duration: 150 }} use:reveal={index}>
        <NoteCard {note} {showProject} />
      </div>
    {/each}
  </div>
{/snippet}

{#if !notes.length}
  <p class="px-4 py-16 text-center text-fluid-sm text-ink-faint">{empty}</p>
{:else}
  {#if pinned.length}{@render section('Pinned', pinned)}{/if}
  {#if others.length}{@render section(pinned.length ? 'Others' : '', others)}{/if}
{/if}
