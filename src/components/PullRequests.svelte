<script>
  // A project's open and recently merged pull requests, live from GitHub: CI checks, review state, draft, branch,
  // diff size and author. Each PR shows the feature it belongs to, or lets you link it to one (which puts it into the
  // merge -> auto-complete loop).
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import GitPullRequestDraft from '@lucide/svelte/icons/git-pull-request-draft';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import CircleDot from '@lucide/svelte/icons/circle-dot';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { fade, fly } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { api } from '../lib/api.js';
  import { ago, fullTime } from '../lib/time.js';

  /** @type {{ project: any }} */
  let { project } = $props();

  const CHECKS = {
    success: { icon: CircleCheck, class: 'text-complete', label: 'Checks passed' },
    failure: { icon: CircleX, class: 'text-accent', label: 'Checks failed' },
    error: { icon: CircleX, class: 'text-accent', label: 'Checks errored' },
    pending: { icon: CircleDot, class: 'text-requested', label: 'Checks running' },
    expected: { icon: CircleDot, class: 'text-requested', label: 'Checks expected' },
  };
  const REVIEWS = { approved: { label: 'Approved', class: 'text-complete' }, changes_requested: { label: 'Changes requested', class: 'text-accent' }, review_required: { label: 'Review required', class: 'text-ink-muted' } };
  const ROW_STAGGER_MS = 25;

  /** @type {{ open: any[], merged: any[], source: string, fetched_at: number, authenticated: boolean } | null} */
  let data = $state(null);
  let loading = $state(false);
  let error = $state('');

  const features = $derived(store.notes.filter((note) => note.project_id === project.id && note.kind === 'feature' && !note.deleted_at));
  const linkable = $derived(features.filter((note) => note.state !== 'complete'));

  /** The feature a PR URL is linked to, if any. @param {string} url */
  function featureFor(url) {
    return features.find((note) => note.pull_requests.some((/** @type {any} */ pr) => pr.url === url));
  }

  async function load() {
    loading = true;
    error = '';
    try {
      // The server only knows synced projects, so push a freshly created or edited one first.
      if (store.pending) await store.sync();
      data = await api(`/api/projects/${project.id}/pulls`);
    } catch (failure) {
      error = /** @type {Error} */ (failure).message;
    }
    loading = false;
  }

  $effect(() => {
    project.repo;
    load();
  });

  /** @param {any} pr @param {string} noteId */
  function linkTo(pr, noteId) {
    const note = store.find('notes', noteId);
    if (!note) return;
    const [, repo, number] = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(pr.url) || [];
    store.update('notes', noteId, {
      pull_requests: [...note.pull_requests, { url: pr.url, repo, number: Number(number), title: pr.title, state: pr.merged_at ? 'merged' : 'open', merged_at: pr.merged_at }],
    });
  }
</script>

{#snippet row(/** @type {any} */ pr, /** @type {number} */ index)}
  {@const linked = featureFor(pr.url)}
  {@const check = pr.checks ? CHECKS[/** @type {keyof typeof CHECKS} */ (pr.checks)] : null}
  {@const review = pr.review ? REVIEWS[/** @type {keyof typeof REVIEWS} */ (pr.review)] : null}
  <li class="flex items-start gap-3 bg-app px-4 py-3 hover:bg-surface-raised spring" in:fly={{ y: 6, duration: 180, delay: index * ROW_STAGGER_MS }}>
    {#if pr.merged_at}
      <GitMerge class="mt-0.5 size-4 shrink-0 text-complete" />
    {:else if pr.draft}
      <GitPullRequestDraft class="mt-0.5 size-4 shrink-0 text-ink-faint" />
    {:else}
      <GitPullRequest class="mt-0.5 size-4 shrink-0 text-progress" />
    {/if}
    <div class="min-w-0 flex-1">
      <a href={pr.url} target="_blank" rel="noopener noreferrer" class="group inline-flex max-w-full items-center gap-1.5 text-sm font-semibold text-ink hover:text-accent">
        <span class="truncate">{pr.title}</span><span class="shrink-0 font-mono text-xs font-normal text-ink-faint">#{pr.number}</span>
        <ExternalLink class="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
      </a>
      <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem] text-ink-faint">
        <span class="inline-flex items-center gap-1">
          {#if pr.avatar_url}<img src={pr.avatar_url} alt="" class="size-3.5 rounded-full" loading="lazy" />{/if}{pr.author}
        </span>
        <span class="max-w-48 truncate" title={pr.branch}>{pr.branch}</span>
        {#if pr.additions !== null}<span><span class="text-complete">+{pr.additions}</span> <span class="text-accent">−{pr.deletions}</span></span>{/if}
        {#if pr.draft}<span>draft</span>{/if}
        {#if check}{@const Icon = check.icon}<span class="inline-flex items-center gap-1 {check.class}" title={check.label}><Icon class="size-3" />{pr.checks}</span>{/if}
        {#if review}<span class={review.class}>{review.label}</span>{/if}
        <span title={fullTime(pr.merged_at || pr.updated_at)}>{pr.merged_at ? `merged ${ago(pr.merged_at)}` : `updated ${ago(pr.updated_at)}`}</span>
      </p>
    </div>
    <div class="shrink-0">
      {#if linked}
        <button class="spring press max-w-40 truncate border border-line px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-ink" onclick={() => router.openNote(linked.id)} title="Open the linked feature">
          → {linked.title || 'Untitled'}
        </button>
      {:else if linkable.length && !pr.merged_at}
        <select class="spring max-w-40 border border-dashed border-line-strong bg-app px-2 py-1 text-xs text-ink-muted hover:border-accent focus:border-accent focus:outline-none" aria-label="Link #{pr.number} to a feature"
          onchange={(event) => { if (event.currentTarget.value) linkTo(pr, event.currentTarget.value); }}>
          <option value="">Link to feature…</option>
          {#each linkable as note (note.id)}<option value={note.id}>{note.title || 'Untitled'}</option>{/each}
        </select>
      {/if}
    </div>
  </li>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center gap-3 px-4 py-2">
    <p class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink-faint">
      {#if data}
        {project.repo} · {data.source === 'graphql' ? 'live from GitHub' : 'public data (sign in with GitHub for checks, reviews and private repos)'} · fetched {ago(data.fetched_at)}
      {:else}
        {project.repo}
      {/if}
    </p>
    <button class="spring press inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-accent hover:text-ink" onclick={load} disabled={loading}>
      <RefreshCw class="size-3.5 {loading ? 'spinning' : ''}" />Refresh
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto pb-3 sm:px-3">
    {#if error}
      <p class="mx-4 border border-accent bg-accent-soft px-4 py-3 text-sm sm:mx-0" role="alert" transition:fade>{error}</p>
    {:else if !data}
      <p class="px-4 py-10 text-center text-xs text-ink-faint">Loading pull requests from GitHub…</p>
    {:else}
      <h3 class="px-4 pt-2 pb-1 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint sm:px-0">Open · {data.open.length}</h3>
      <ul class="flex flex-col gap-px border-y border-line bg-line sm:border">
        {#each data.open as pr, index (pr.url)}{@render row(pr, index)}{:else}<li class="bg-app px-4 py-6 text-center text-xs text-ink-faint">No open pull requests.</li>{/each}
      </ul>
      <h3 class="px-4 pt-5 pb-1 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint sm:px-0">Recently merged · {data.merged.length}</h3>
      <ul class="flex flex-col gap-px border-y border-line bg-line sm:border">
        {#each data.merged as pr, index (pr.url)}{@render row(pr, index)}{:else}<li class="bg-app px-4 py-6 text-center text-xs text-ink-faint">Nothing merged recently.</li>{/each}
      </ul>
    {/if}
  </div>
</div>
