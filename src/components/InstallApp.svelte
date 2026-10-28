<script>
  // Settings → About: the Made by DOGS sticker, the running version (linked to the PR it shipped with, and when that merged), the Privacy Policy link and, on the web,
  // installers for every platform from the latest GitHub release, the visitor's own platform first. Installers are
  // hidden inside the native app.
  import Download from '@lucide/svelte/icons/download';
  import madeByDogs from '../assets/made-by-dogs-small.png';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import { fade, fly } from 'svelte/transition';
  import { IS_NATIVE } from '../lib/api.js';
  import { APP_VERSION, LATEST_PR } from '../lib/version.js';
  import { fullTime } from '../lib/time.js';
  import { latestRelease, visitorPlatform } from './settings-data.js';
  import { PRIVACY_PATH, privacy } from './privacy-route.svelte.js';
  import { BOX, BUTTON, HEADING, HINT, SUBHEADING } from './settings-styles.js';
  import TEXT from './settings.json';

  const DOGS_URL = 'https://dogs.red';
  const MB_DECIMALS = 1;
  const STAGGER_MS = 40;
  const ENTER = { y: 8, duration: 220 };
  const FADE = { duration: 150 };

  const platform = visitorPlatform();
  /** @type {import('./settings-data.js').Release | null | undefined} undefined while loading */
  let release = $state(undefined);

  /** Downloads grouped by platform, the visitor's own first. */
  const groups = $derived.by(() => {
    if (!release) return [];
    const order = Object.keys(TEXT.platforms).sort((a, b) => Number(b === platform) - Number(a === platform));
    return order
      .map((id) => ({ id, downloads: /** @type {import('./settings-data.js').Release} */ (release).downloads.filter((download) => download.platform === id) }))
      .filter((group) => group.downloads.length);
  });

  $effect(() => {
    if (IS_NATIVE) return;
    latestRelease().then((found) => (release = found));
  });
</script>

<div class="flex items-start justify-between gap-3">
  <h2 class={HEADING}>{TEXT.about}</h2>
  <a href={DOGS_URL} target="_blank" rel="noopener noreferrer" class="group -mt-1 shrink-0" title="DOGS" aria-label={TEXT.madeByDogs}>
    <img src={madeByDogs} alt="" width="480" height="159"
      class="h-9 w-auto -rotate-3 shadow-md spring group-hover:rotate-0 group-hover:scale-105 group-active:scale-95 tv:h-14" />
  </a>
</div>
<p class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-fluid-sm text-ink-muted">
  <span>{TEXT.version} <span class="selectable font-mono text-ink">{APP_VERSION}</span></span>
  {#if LATEST_PR}
    <a class="spring inline-flex min-w-0 max-w-full items-center gap-1.5 text-ink-muted hover:text-accent" href={LATEST_PR.url} target="_blank" rel="noopener noreferrer"
      title="{TEXT.latestPr}: {LATEST_PR.title}">
      <GitMerge class="size-3.5 shrink-0" /><span class="font-mono">#{LATEST_PR.number}</span><span class="truncate">{LATEST_PR.title}</span>
    </a>
    <!-- When that pull request merged, i.e. when this update shipped: date and time in the visitor's locale -->
    {#if LATEST_PR.mergedAt}<time class="font-mono text-xs text-ink-faint" datetime={new Date(LATEST_PR.mergedAt).toISOString()}>{TEXT.updated} {fullTime(LATEST_PR.mergedAt)}</time>{/if}
  {/if}
</p>
<a href={PRIVACY_PATH} class="{BUTTON} group mb-4" onclick={(event) => privacy.show(event)}>
  <ShieldCheck class="size-4 shrink-0 spring group-hover:text-accent" />{TEXT.privacy}
</a>

{#if !IS_NATIVE}
  <p class={SUBHEADING}>{TEXT.install}</p>
  <p class={HINT}>{TEXT.installHint}</p>

  <!-- One grid cell for loading / empty / list, so each state crossfades in place -->
  <div class="grid">
    {#if release === undefined}
      <p class="col-start-1 row-start-1 text-xs text-ink-faint" transition:fade={FADE}>{TEXT.loadingRelease}</p>
    {:else if !groups.length}
      <p class="col-start-1 row-start-1 text-xs text-ink-faint" in:fade={FADE}>{TEXT.noRelease}</p>
    {:else}
      <ul class="col-start-1 row-start-1 grid gap-2 sm:grid-cols-2" in:fade={FADE}>
        {#each groups as group, index (group.id)}
          <li class="{BOX} min-w-0 p-3 {group.id === platform ? 'border-accent' : ''}" in:fly={{ ...ENTER, delay: index * STAGGER_MS }}>
            <p class="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
              {TEXT.platforms[/** @type {keyof typeof TEXT.platforms} */ (group.id)]}
              {#if group.id === platform}<span class="truncate text-xs font-normal text-accent">{TEXT.forThisDevice}</span>{/if}
            </p>
            <div class="flex flex-wrap gap-2">
              {#each group.downloads as download (download.url)}
                <a class="{BUTTON} {group.id === platform ? 'border-accent' : ''}" href={download.url} download title={download.name}>
                  <Download class="size-4 shrink-0" /><span class="font-mono uppercase">.{download.kind}</span>
                  <span class="text-xs text-ink-faint">{download.mb.toFixed(MB_DECIMALS)} MB</span>
                </a>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <p class="mt-3 flex items-start gap-2 text-xs {platform === 'ios' ? 'text-ink' : 'text-ink-muted'}">
    <Smartphone class="mt-px size-3.5 shrink-0 {platform === 'ios' ? 'text-accent' : ''}" />{TEXT.iosNote}
  </p>
  {#if release}
    <a class="spring mt-3 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-accent" href={release.url} target="_blank" rel="noopener noreferrer"
      in:fade={FADE}>{TEXT.allReleases} · <span class="font-mono">{release.tag}</span><ExternalLink class="size-3" /></a>
  {/if}
{/if}
