<script>
  // Renders one attachment as an image, video, or audio player. Web loads straight from the API with the session cookie;
  // native apps fetch it with their bearer token into a blob URL (see mediaUrl in src/lib/api.js). Media fades in once its URL is ready.
  import { fade } from 'svelte/transition';
  import { mediaUrl } from '../lib/api.js';
  import AudioTile from './AudioTile.svelte';

  /** @type {{ file: any, class?: string, controls?: boolean }} */
  let { file, class: className = '', controls = false } = $props();

  const FADE_MS = 200;

  let src = $state('');
  let failed = $state(false);
  const isVideo = $derived(file.type.startsWith('video/'));
  const isAudio = $derived(file.type.startsWith('audio/'));

  $effect(() => {
    let revoked = false;
    /** @type {string} */
    let created = '';
    failed = false;
    mediaUrl(file.url).then((url) => {
      created = url;
      if (!revoked) src = url;
    }).catch(() => (failed = true));
    return () => {
      revoked = true;
      if (created.startsWith('blob:')) URL.revokeObjectURL(created);
    };
  });
</script>

{#if failed}
  <div class="flex items-center justify-center bg-surface-raised text-xs text-ink-faint {className}" in:fade={{ duration: FADE_MS }}>Couldn't load</div>
{:else if !src}
  <div class="animate-pulse bg-surface-raised {className}"></div>
{:else if isVideo}
  <!-- Attachments are user-provided recordings without captions -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video {src} class={className} {controls} preload="metadata" playsinline muted={!controls} in:fade={{ duration: FADE_MS }}></video>
{:else if isAudio && controls}
  <!-- User-provided audio may contain speech; the native controls remain keyboard accessible. -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <audio {src} class={className} controls preload="metadata" aria-label={file.name} in:fade={{ duration: FADE_MS }}></audio>
{:else if isAudio}
  <AudioTile {file} class={className} compact />
{:else}
  <img src={src} alt={file.name} class={className} loading="lazy" decoding="async" in:fade={{ duration: FADE_MS }} />
{/if}
