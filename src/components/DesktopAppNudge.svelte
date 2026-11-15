<script>
  // On the Tapes page where there's no local speech engine (the web app, phones): how many free wordsmith cloud
  // minutes are left today, and the desktop app, which transcribes every tape on the computer, free and private. The
  // link is the installer for this computer when the newest release has one, else the release page.
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import MonitorDown from '@lucide/svelte/icons/monitor-down';
  import { IS_NATIVE } from '../lib/api.js';
  import { latestRelease, visitorPlatform } from '../lib/github-public.js';
  import { transcriber } from '../lib/tape-transcribe.svelte.js';
  import SETTINGS from './settings.json';
  import TEXT from './tapes.json';

  const RELEASES_URL = 'https://github.com/YEAHDOGS/wordsmith/releases/latest';
  const DESKTOP = ['windows', 'macos', 'linux'];
  const FADE = { duration: 150 };

  const platform = visitorPlatform();
  const desktop = DESKTOP.includes(platform);
  let url = $state(RELEASES_URL);

  onMount(() => {
    transcriber.loadCloud();
    latestRelease().then((release) => {
      const installer = desktop && release?.downloads.find((download) => download.platform === platform);
      url = installer ? installer.url : release?.url || RELEASES_URL;
    });
  });

  const label = $derived(desktop ? TEXT.desktopGetFor.replace('{platform}', SETTINGS.platforms[/** @type {keyof typeof SETTINGS.platforms} */ (platform)]) : TEXT.desktopGet);
  const minutes = $derived(
    !transcriber.cloud?.available ? '' : transcriber.cloudLeft > 0
      ? TEXT.cloudLeft.replace('{left}', String(transcriber.cloudLeft)).replace('{limit}', String(transcriber.cloud.limit))
      : TEXT.cloudUsedUp,
  );

  /** The native apps open links in the system browser. @param {MouseEvent} event */
  async function open(event) {
    if (!IS_NATIVE) return;
    event.preventDefault();
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  }
</script>

<div class="flex min-w-0 items-center gap-2 border-b border-line bg-surface px-2 py-1.5 text-xs short:hidden sm:px-4" in:fade={FADE}>
  <MonitorDown class="size-4 shrink-0 text-accent" />
  <p class="min-w-0 flex-1 truncate text-ink-muted" title="{minutes ? `${minutes}. ` : ''}{TEXT.desktopNudge}">
    {#if minutes}<span class="text-ink">{minutes}.</span>{/if} {TEXT.desktopNudge}
  </p>
  <a class="spring press shrink-0 border border-accent px-2.5 py-1 font-semibold text-ink hover:bg-accent-soft" href={url} target="_blank" rel="noopener" onclick={open}>{label}</a>
</div>
