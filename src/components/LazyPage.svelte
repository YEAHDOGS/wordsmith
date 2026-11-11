<script>
  // A page whose code loads on first visit (import()), kept out of the start-up bundle. While it loads the space
  // stays empty, which on a normal connection is a blink. If it can't load (offline, or this tab is older than the
  // latest deploy and asks for a file that is gone), it says so and offers a reload, which fetches the current app.
  import { fade } from 'svelte/transition';

  /** @type {{ load: () => Promise<{ default: any }> } & Record<string, any>} load: a stable function, e.g. a module-level `() => import('./Page.svelte')`; other props go to the page */
  let { load, ...rest } = $props();

  const FAILED = "This page couldn't load. You may be offline, or wordsmith was updated since this tab opened.";
  const RELOAD = 'Reload';
  const FADE_MS = 150;
</script>

{#await load() then { default: Page }}
  <Page {...rest} />
{:catch}
  <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert" in:fade={{ duration: FADE_MS }}>
    <p class="max-w-md text-fluid-sm text-ink-muted">{FAILED}</p>
    <button class="spring press border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent" onclick={() => location.reload()}>{RELOAD}</button>
  </div>
{/await}
