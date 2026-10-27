<script>
  // Link a project to a GitHub repo. Searches your repos, collaborations and organization repos (grouped by owner) when
  // wordsmith has a GitHub token (GitHub sign-in or GITHUB_TOKEN); otherwise, or for any repo, type owner/name and it is
  // checked against GitHub. When org repos may be hidden it links to where you grant wordsmith org access. Optional.
  import Search from '@lucide/svelte/icons/search';
  import Lock from '@lucide/svelte/icons/lock';
  import X from '@lucide/svelte/icons/x';
  import Building from '@lucide/svelte/icons/building';
  import User from '@lucide/svelte/icons/user';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { fade, fly, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { backOut } from 'svelte/easing';
  import ProviderIcon from './ProviderIcon.svelte';
  import { store } from '../lib/store.svelte.js';
  import { api } from '../lib/api.js';
  import { ago } from '../lib/time.js';

  /** @type {{ project: any, onclose: () => void }} */
  let { project, onclose } = $props();

  const SEARCH_DEBOUNCE_MS = 250;
  const MAX_SHOWN = 40;
  const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
  // Result motion: rows spring up in a short stagger, fade out, and the rest glide into place.
  const ROW_IN_MS = 180;
  const ROW_OUT_MS = 110;
  const ROW_RISE_PX = 6;
  const STAGGER_MS = 22;
  const MAX_STAGGER_MS = 180;
  const FLIP_MS = 150;
  const STATUS_FADE_MS = 120;
  const SCOPE_ORGS = 'read:org';
  const SCOPE_PRIVATE = 'repo';
  const STATUS_LOADING = 'Checking GitHub…';
  const STATUS_EMPTY = 'No matching repos. Type owner/name to link any repo.';
  const HINT_RESTRICTED = 'may restrict third-party apps, so their repos stay hidden until wordsmith is approved.';
  const HINT_NO_ORG_SCOPE = 'Organization missing? Link GitHub again in Settings so wordsmith can list your orgs, or grant it access.';
  const HINT_DEFAULT = 'Organization repos missing? Its owners may need to approve wordsmith.';
  const HINT_PRIVATE = 'Private repos are hidden until the GitHub sign-in includes the repo scope.';

  let query = $state('');
  /** @type {any[]} */
  let repos = $state([]);
  let needsGithub = $state(false);
  // True until the first search answers, so the status line never flashes "no repos".
  let loading = $state(true);
  let error = $state('');
  /** @type {{ url: string, restricted_orgs: string[], missing_scopes: string[] } | null} */
  let orgAccess = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  // Only the newest search may write results, so a slow early answer can't replace a newer one.
  let latestSearch = 0;

  // A pasted GitHub URL works too: https://github.com/owner/name(.git)
  const typed = $derived(query.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, ''));
  const typedIsRepo = $derived(REPO_PATTERN.test(typed));

  // Results grouped by owner, owners ordered by their most recently pushed repo (the server sorts by push).
  const groups = $derived.by(() => {
    /** @type {Map<string, { owner: string, org: boolean, repos: any[] }>} */
    const byOwner = new Map();
    for (const repo of repos) {
      const group = byOwner.get(repo.owner) ?? { owner: repo.owner, org: repo.owner_type === 'org', repos: [] };
      group.repos.push(repo);
      byOwner.set(repo.owner, group);
    }
    return [...byOwner.values()];
  });

  const status = $derived.by(() => {
    if (loading) return STATUS_LOADING;
    if (needsGithub) return '';
    if (!repos.length) return STATUS_EMPTY;
    const owners = groups.length > 1 ? ` from ${groups.length} owners` : '';
    return `${repos.length} repo${repos.length === 1 ? '' : 's'}${owners}`;
  });

  const orgHint = $derived.by(() => {
    if (!orgAccess) return '';
    const restricted = orgAccess.restricted_orgs;
    const lead = restricted.length ? `${restricted.join(', ')} ${HINT_RESTRICTED}` : orgAccess.missing_scopes.includes(SCOPE_ORGS) ? HINT_NO_ORG_SCOPE : HINT_DEFAULT;
    return orgAccess.missing_scopes.includes(SCOPE_PRIVATE) ? `${lead} ${HINT_PRIVATE}` : lead;
  });

  async function search() {
    const ticket = ++latestSearch;
    loading = true;
    try {
      const result = await api(`/api/github/repos?q=${encodeURIComponent(typedIsRepo ? '' : query.trim())}`);
      if (ticket !== latestSearch) return;
      repos = result.repos.slice(0, MAX_SHOWN);
      needsGithub = result.needs_github;
      orgAccess = result.org_access ?? null;
      error = '';
    } catch (failure) {
      if (ticket !== latestSearch) return;
      error = /** @type {Error} */ (failure).message;
    }
    loading = false;
  }

  $effect(() => {
    query;
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  /** @param {string} repo */
  function link(repo) {
    store.update('projects', project.id, { repo });
    onclose();
  }

  async function linkTyped() {
    if (!typedIsRepo) {
      error = 'Type a repo as owner/name, e.g. YEAHDOGS/wordsmith';
      return;
    }
    // Offline: link it anyway; the PR tab checks it once you are back online.
    if (!navigator.onLine) return link(typed);
    loading = true;
    try {
      const { repo } = await api(`/api/github/repo?name=${encodeURIComponent(typed)}`);
      link(repo.full_name);
    } catch (failure) {
      error = /** @type {Error} */ (failure).message;
    }
    loading = false;
  }
</script>

<div class="border border-accent bg-surface" in:fly={{ y: -8, duration: 200 }} out:slide={{ duration: 150 }}>
  <div class="flex items-center gap-2 border-b border-line px-3 py-2">
    <ProviderIcon provider="github" class="size-4" />
    <p class="flex-1 text-sm font-semibold">Link a GitHub repo <span class="font-normal text-ink-muted">(optional)</span></p>
    <button class="spring press p-1 text-ink-muted hover:text-ink" aria-label="Skip linking" onclick={onclose}><X class="size-4" /></button>
  </div>
  <form class="flex border-b border-line" onsubmit={(event) => { event.preventDefault(); linkTyped(); }}>
    <label class="relative flex min-w-0 flex-1 items-center">
      <Search class="pointer-events-none absolute left-3 size-4 text-ink-faint" />
      <!-- Focused on open: the picker opens because you just asked for it -->
      <input bind:value={query} {@attach (node) => node.focus()} placeholder={needsGithub ? 'owner/name or a github.com URL' : 'Search your and your orgs\' repos, or type owner/name'} aria-label="Repository"
        class="w-full min-w-0 bg-transparent py-2.5 pr-3 pl-9 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-faint focus:outline-none" />
    </label>
    <button class="spring press border-l border-line px-4 text-sm font-semibold text-accent hover:bg-surface-raised disabled:opacity-40" disabled={!typedIsRepo || loading}>Link</button>
  </form>
  {#if needsGithub}
    <p class="px-3 py-2 text-xs text-ink-muted" transition:slide={{ duration: FLIP_MS }}>Sign in with GitHub (Settings → Link GitHub) to search your repos and your organizations' repos, and see private ones. Public repos work by typing owner/name.</p>
  {/if}
  <!-- Status line keeps its height, so loading, counts and "no matches" crossfade without moving the list -->
  <p class="relative h-7 overflow-hidden border-b border-line font-mono text-[0.6875rem] text-ink-faint" aria-live="polite">
    {#key status}
      <span class="absolute inset-0 truncate px-3 leading-7" in:fade={{ duration: STATUS_FADE_MS }} out:fade={{ duration: STATUS_FADE_MS }}>{status}</span>
    {/key}
  </p>
  <ul class="relative max-h-64 overflow-x-hidden overflow-y-auto">
    {#each groups as group (group.owner)}
      <li animate:flip={{ duration: FLIP_MS }} in:fade={{ duration: ROW_IN_MS }} out:fade={{ duration: ROW_OUT_MS }}>
        <p class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-surface-raised px-3 py-1 font-mono text-[0.6875rem] text-ink-muted">
          {#if group.org}<Building class="size-3 shrink-0" />{:else}<User class="size-3 shrink-0" />{/if}
          <span class="min-w-0 flex-1 truncate">{group.owner}</span>
          {#if group.org}<span class="shrink-0 text-ink-faint">organization</span>{/if}
        </p>
        <ul class="relative">
          {#each group.repos as repo, index (repo.full_name)}
            <li animate:flip={{ duration: FLIP_MS }} in:fly|global={{ y: ROW_RISE_PX, duration: ROW_IN_MS, delay: Math.min(index * STAGGER_MS, MAX_STAGGER_MS), easing: backOut }} out:fade={{ duration: ROW_OUT_MS }}>
              <button class="spring flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left hover:bg-surface-raised" onclick={() => link(repo.full_name)} title={repo.full_name}>
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-1.5 font-mono text-sm text-ink">
                    {#if repo.private}<Lock class="size-3 shrink-0 text-ink-faint" />{/if}
                    <span class="truncate"><span class="sr-only">{group.owner}/</span>{repo.full_name.slice(group.owner.length + 1)}</span>
                  </span>
                  {#if repo.description}<span class="block truncate text-xs text-ink-muted">{repo.description}</span>{/if}
                </span>
                <span class="shrink-0 font-mono text-[0.6875rem] text-ink-faint">pushed {ago(repo.pushed_at)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
  {#if orgHint}
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs text-ink-muted" transition:slide={{ duration: FLIP_MS }}>
      <span class="min-w-0 flex-1 basis-48">{orgHint}</span>
      <a href={orgAccess?.url} target="_blank" rel="noopener noreferrer" class="spring inline-flex shrink-0 items-center gap-1 font-semibold text-accent hover:text-accent-hover">Grant org access<ExternalLink class="size-3" /></a>
    </div>
  {/if}
  {#if error}<p class="px-3 py-2 text-xs text-accent" role="alert" transition:slide={{ duration: FLIP_MS }}>{error}</p>{/if}
</div>
