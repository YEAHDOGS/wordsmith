<script>
  // A note's history on a vertical spine: every interaction with its exact time and who did it.
  // Above it, the lifecycle at a glance: requested -> started -> PR -> completed, with the time between steps.
  import User from '@lucide/svelte/icons/user';
  import Bot from '@lucide/svelte/icons/bot';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import { fade, fly } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { DIFFICULTY_LABELS, attachmentKind } from '../lib/models.js';
  import { clockTime, dayLabel, duration, fullTime } from '../lib/time.js';

  /** @type {{ note: any }} */
  let { note } = $props();

  const ACTOR_ICONS = { user: User, agent: Bot, github: GitMerge };
  const ROW_STAGGER_MS = 40;
  const MAX_STAGGER_MS = 400;
  const ATTACHED = { image: 'an image', video: 'a video', document: 'a document' };

  const events = $derived(store.eventsFor(note.id));
  const firstPr = $derived(events.find((event) => event.type === 'pr_linked')?.created_at ?? null);
  const milestones = $derived([
    { label: 'Requested', at: note.created_at, tone: STATE_STYLE.requested },
    { label: 'Started', at: note.started_at, tone: STATE_STYLE.in_progress },
    { label: 'PR linked', at: firstPr, tone: STATE_STYLE.in_progress },
    { label: 'Completed', at: note.completed_at, tone: STATE_STYLE.complete },
  ]);
  /** Events grouped under a heading per day. */
  const days = $derived.by(() => {
    /** @type {{ day: string, events: any[] }[]} */
    const groups = [];
    for (const event of events) {
      const day = dayLabel(event.created_at);
      if (groups.at(-1)?.day !== day) groups.push({ day, events: [] });
      groups.at(-1)?.events.push(event);
    }
    return groups;
  });

  /** Plain-language line for an event. @param {any} event */
  function describe(event) {
    const data = event.data || {};
    const stateName = (/** @type {string} */ state) => STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]?.label ?? state;
    switch (event.type) {
      case 'created': return data.kind === 'feature' ? 'requested this feature' : 'created this note';
      case 'claimed': return 'claimed it and started work';
      case 'state': return `moved it ${stateName(data.from)} → ${stateName(data.to)}${data.reason ? ` (${data.reason})` : ''}`;
      case 'status': return `status: “${data.text}”`;
      case 'asked': return `asked: “${data.text}”`;
      case 'answered': return 'answered the question';
      case 'assigned': return `assigned it to ${data.to}`;
      case 'pr_linked': return `linked ${data.repo}#${data.number}`;
      case 'pr_merged': return `merged ${data.url?.split('/').slice(-3).join('/').replace('/pull/', '#')}`;
      case 'pr_closed': return 'closed a pull request without merging';
      case 'edited': return 'edited it';
      case 'archived': return 'archived it';
      case 'unarchived': return 'restored it from the archive';
      case 'deleted': return 'deleted it';
      case 'restored': return 'restored it';
      case 'attached': return `attached ${ATTACHED[attachmentKind(data.type)] || ATTACHED.image}: ${data.name}`;
      case 'detached': return `removed ${data.name}`;
      case 'published': return 'made it public';
      case 'unpublished': return 'made it private';
      case 'analyzed': return `triaged it: ${DIFFICULTY_LABELS[data.difficulty] ?? DIFFICULTY_LABELS[0]}${data.batch ? `, batch ${data.batch}` : ''}`;
      default: return event.type;
    }
  }
</script>

{#if note.kind === 'feature'}
  <ol class="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4" aria-label="Lifecycle" in:fly={{ y: -8, duration: 180 }} out:fade={{ duration: 100 }}>
    {#each milestones as step, index (step.label)}
      <li class="bg-app px-3 py-2 transition-opacity duration-300 {step.at ? '' : 'opacity-50'}">
        <p class="flex items-center gap-1.5 text-[0.6875rem] font-semibold {step.at ? step.tone.text : 'text-ink-faint'}">
          <span class="size-1.5 rounded-full {step.at ? step.tone.dot : 'bg-line-strong'}"></span>{step.label}
        </p>
        <p class="selectable mt-0.5 font-mono text-[0.6875rem] text-ink-muted" title={fullTime(step.at)}>{step.at ? fullTime(step.at) : '—'}</p>
        {#if index > 0 && step.at && milestones[index - 1].at}
          <p class="font-mono text-[0.625rem] text-ink-faint" in:fade={{ duration: 200 }}>+{duration(milestones[index - 1].at, step.at)}</p>
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<div class="relative mt-4 pl-6">
  <div class="spine-line absolute top-1 bottom-1 left-2 w-px bg-line-strong" aria-hidden="true"></div>
  {#if !events.length}
    <p class="py-2 text-xs text-ink-faint" in:fade={{ duration: 200 }} out:fade={{ duration: 100 }}>History appears here after the first sync.</p>
  {/if}
  {#each days as group (group.day)}
    <h4 class="relative -ml-6 mb-1 mt-3 first:mt-0 pl-6 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint">{group.day}</h4>
    <ol>
      {#each group.events as event, index (event.id)}
        {@const Icon = ACTOR_ICONS[/** @type {keyof typeof ACTOR_ICONS} */ (event.actor_type)] ?? User}
        <li class="relative py-1.5" in:fly={{ x: -8, duration: 200, delay: Math.min(index * ROW_STAGGER_MS, MAX_STAGGER_MS) }}>
          <span class="absolute top-2.5 -left-5 size-2 rounded-full ring-4 ring-app {event.type === 'pr_merged' || event.data?.to === 'complete' ? 'bg-complete' : event.actor_type === 'agent' ? 'bg-progress' : 'bg-accent'}"></span>
          <p class="text-[0.8125rem] leading-snug text-ink">
            <span class="inline-flex items-center gap-1 font-semibold"><Icon class="size-3.5 text-ink-muted" />{event.actor_name || event.actor_type}</span>
            <span class="text-ink-muted">{describe(event)}</span>
          </p>
          <time class="selectable font-mono text-[0.6875rem] text-ink-faint" datetime={new Date(event.created_at).toISOString()} title={fullTime(event.created_at)}>{clockTime(event.created_at)}</time>
        </li>
      {/each}
    </ol>
  {/each}
</div>
