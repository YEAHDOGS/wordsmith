<script>
  // Link a project to a GitHub repo. Searches your repos when wordsmith has a GitHub token (GitHub sign-in or
  // GITHUB_TOKEN); otherwise, or for any repo, type owner/name and it is checked against GitHub. Linking is optional.
  import Search from '@lucide/svelte/icons/search';
  import Lock from '@lucide/svelte/icons/lock';
  import X from '@lucide/svelte/icons/x';
  import { fly, slide } from 'svelte/transition';
  import ProviderIcon from './ProviderIcon.svelte';
  import { store } from '../lib/store.svelte.js';
  import { api } from '../lib/api.js';
  import { ago } from '../lib/time.js';

  /** @type {{ project: any, onclose: () => void }} */
  let { project, onclose } = $props();

  const SEARCH_DEBOUNCE_MS = 250;
  const MAX_SHOWN = 8;
  const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

  let query = $state('');
  /** @type {any[]} */
  let repos = $state([]);
  let needsGithub = $state(false);
  let loading = $state(false);
  let error = $state('');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  // A pasted GitHub URL works too: https://github.com/owner/name(.git)
  const typed = $derived(query.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, ''));
  const typedIsRepo = $derived(REPO_PATTERN.test(typed));

  /** Focus the search box when the picker opens (it opens because you just asked for it). @param {HTMLInputElement} node */
  function focus(node) {
    node.focus();
  }

  async function search() {
    loading = true;
    try {
      const result = await api(`/api/github/repos?q=${encodeURIComponent(typedIsRepo ? '' : query.trim())}`);
      repos = result.repos.slice(0, MAX_SHOWN);
      needsGithub = result.needs_github;
      error = '';
    } catch (failure) {
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
    <label class="relative flex flex-1 items-center">
      <Search class="pointer-events-none absolute left-3 size-4 text-ink-faint" />
      <input bind:value={query} use:focus placeholder={needsGithub ? 'owner/name or a github.com URL' : 'Search your repos, or type owner/name'} aria-label="Repository"
        class="w-full bg-transparent py-2.5 pr-3 pl-9 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-faint focus:outline-none" />
    </label>
    <button class="spring press border-l border-line px-4 text-sm font-semibold text-accent hover:bg-surface-raised disabled:opacity-40" disabled={!typedIsRepo || loading}>Link</button>
  </form>
  {#if needsGithub}
    <p class="px-3 py-2 text-xs text-ink-muted">Sign in with GitHub (Settings → Link GitHub) to search your repos and see private ones. Public repos work by typing owner/name.</p>
  {/if}
  <ul class="max-h-64 overflow-y-auto">
    {#each repos as repo (repo.full_name)}
      <li transition:slide={{ duration: 120 }}>
        <button class="spring flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left hover:bg-surface-raised" onclick={() => link(repo.full_name)}>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 font-mono text-sm text-ink">{#if repo.private}<Lock class="size-3 text-ink-faint" />{/if}{repo.full_name}</span>
            {#if repo.description}<span class="block truncate text-xs text-ink-muted">{repo.description}</span>{/if}
          </span>
          <span class="shrink-0 font-mono text-[11px] text-ink-faint">pushed {ago(repo.pushed_at)}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if loading}<p class="px-3 py-2 font-mono text-[11px] text-ink-faint">Checking GitHub…</p>{/if}
  {#if error}<p class="px-3 py-2 text-xs text-accent" role="alert">{error}</p>{/if}
</div>
