<script>
  // Group dialog. From the selection bar ("Group"): put the selected notes in one of the project's groups, in a new
  // named and colored one, or take them out of their groups. From a group's header (edit): rename, recolor, or ungroup
  // (the group goes, its notes stay). A native modal <dialog>: Escape and a click outside close it.
  import X from '@lucide/svelte/icons/x';
  import { fly, scale } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { assignGroup, createGroup, groupsIn, ungroup } from '../lib/groups.js';
  import { DOT_BG } from '../lib/colors.js';
  import { COLORS, MAX_NAME } from '../lib/models.js';
  import TEXT from './group-dialog.json';

  /** @type {{ open: boolean, projectId: string, notes?: any[], group?: any, ondone?: () => void }} */
  let { open = $bindable(), projectId, notes = [], group = null, ondone = () => {} } = $props();

  const STAGGER_MS = 30;
  const DOT_STAGGER_MS = 15;
  const COUNT_PLACEHOLDER = '{count}';
  const SUBHEADING = 'px-4 pt-4 pb-2 font-mono text-[0.6875rem] tv:text-sm uppercase tracking-widest text-ink-faint';
  const BUTTON = 'spring press flex h-9 tv:h-12 w-full items-center justify-center gap-1.5 px-3 text-sm tv:text-lg';

  /** @type {HTMLDialogElement | undefined} */
  let dialog = $state();
  let name = $state('');
  let color = $state('default');

  const groups = $derived(groupsIn(projectId));
  const sizes = $derived(new Map(groups.map((row) => [row.id, store.notes.filter((note) => note.group_id === row.id && !note.deleted_at).length])));
  const grouped = $derived(notes.some((note) => sizes.has(note.group_id)));
  const title = $derived(group ? TEXT.editTitle : TEXT.createTitle.replace(COUNT_PLACEHOLDER, `${notes.length} ${notes.length === 1 ? TEXT.one : TEXT.many}`));

  // Opening fills the form from the group being edited (or blank); closing by Escape or a click outside reports back.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      name = group?.name ?? '';
      color = group?.color ?? 'default';
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  function finish() {
    open = false;
    ondone();
  }

  /** @param {SubmitEvent} event */
  function submit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (group) store.update('note_groups', group.id, { name: trimmed, color });
    else createGroup(projectId, trimmed, color, notes);
    finish();
  }

  /** Adding to a folded group opens it everywhere (notes page and every board column), so the notes don't seem to vanish. @param {any} target */
  function addTo(target) {
    assignGroup(notes, target.id);
    if (target.collapsed || target.folded_columns?.length) store.update('note_groups', target.id, { collapsed: false, folded_columns: [] });
    finish();
  }

  /** @param {MouseEvent} event */
  function onBackdrop(event) {
    if (event.target === dialog) open = false;
  }
</script>

<dialog bind:this={dialog} aria-label={title} onclose={() => (open = false)} onclick={onBackdrop}
  class="m-auto max-h-[calc(100dvh-1rem)] w-[min(24rem,calc(100vw-1rem))] bg-transparent p-0 text-ink backdrop:bg-scrim tv:w-[36rem]">
  {#if open}
    <div class="flex max-h-[calc(100dvh-1rem)] flex-col border border-line-strong bg-surface" in:fly={{ y: 16, duration: 200 }}>
      <header class="flex shrink-0 items-center gap-2 border-b border-line py-1 pr-1 pl-4">
        <h2 class="min-w-0 flex-1 truncate text-fluid-base font-bold">{title}</h2>
        <button class="spring press flex size-9 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink tv:size-12" onclick={() => (open = false)} aria-label={TEXT.close} title={TEXT.close}>
          <X class="size-4 tv:size-6" />
        </button>
      </header>

      <!-- Only the body scrolls, so the header and its close button stay on screen down to 320x320 -->
      <div class="min-h-0 overflow-y-auto overscroll-contain">
        {#if !group && groups.length}
          <p class={SUBHEADING}>{TEXT.addTo}</p>
          <ul class="flex flex-col gap-px border-y border-line bg-line">
            {#each groups as target, index (target.id)}
              <li in:fly={{ y: 6, delay: index * STAGGER_MS, duration: 150 }}>
                <button class="spring press flex w-full items-center gap-2 bg-surface px-4 py-2.5 text-left text-sm hover:bg-surface-raised tv:text-lg" onclick={() => addTo(target)}>
                  <span class="size-2.5 shrink-0 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (target.color)] || DOT_BG.default}" aria-hidden="true"></span>
                  <span class="min-w-0 flex-1 truncate">{target.name}</span>
                  <span class="font-mono text-xs text-ink-faint">{sizes.get(target.id)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <form class="flex flex-col gap-3 px-4 pb-4 {!group ? '' : 'pt-4'}" onsubmit={submit}>
          {#if !group}<p class="{SUBHEADING} -mx-4 pb-0">{TEXT.newGroup}</p>{/if}
          <input {@attach (node) => node.focus()} bind:value={name} maxlength={MAX_NAME} placeholder={TEXT.namePlaceholder} aria-label={TEXT.nameLabel}
            class="w-full border border-line-strong bg-app px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none tv:text-lg" />
          <div class="flex flex-wrap gap-1.5" role="group" aria-label={TEXT.color}>
            {#each COLORS as option, index (option)}
              <button type="button" class="spring press size-7 rounded-full border-2 tv:size-10 {color === option ? 'border-ink' : 'border-transparent hover:border-line-strong'} {DOT_BG[/** @type {keyof typeof DOT_BG} */ (option)]}"
                in:scale={{ start: 0.5, duration: 150, delay: index * DOT_STAGGER_MS }} aria-label="{TEXT.color} {option}" aria-pressed={color === option} onclick={() => (color = option)}></button>
            {/each}
          </div>
          <button type="submit" class="{BUTTON} bg-accent font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!name.trim()}>
            {group ? TEXT.save : TEXT.create}
          </button>
        </form>

        {#if group}
          <div class="border-t border-line p-4">
            <button class="{BUTTON} border border-line-strong text-ink hover:border-accent hover:text-accent" onclick={() => { ungroup(group); finish(); }}>{TEXT.ungroup}</button>
            <p class="mt-2 text-center text-xs text-ink-muted">{TEXT.ungroupHint}</p>
          </div>
        {:else if grouped}
          <div class="border-t border-line p-4">
            <button class="{BUTTON} border border-line-strong text-ink hover:border-accent hover:text-accent" onclick={() => { assignGroup(notes, null); finish(); }}>{TEXT.remove}</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</dialog>
