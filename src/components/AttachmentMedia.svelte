<script>
  // Renders one attachment as an <img> or <video>. Web loads straight from the API with the session cookie;
  // native apps fetch it with their bearer token into a blob URL (see mediaUrl in src/lib/api.js).
  import { mediaUrl } from '../lib/api.js';

  /** @type {{ file: any, class?: string, controls?: boolean }} */
  let { file, class: className = '', controls = false } = $props();

  let src = $state('');
  let failed = $state(false);
  const isVideo = $derived(file.type.startsWith('video/'));

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
  <div class="flex items-center justify-center bg-surface-raised text-xs text-ink-faint {className}">Couldn't load</div>
{:else if !src}
  <div class="animate-pulse bg-surface-raised {className}"></div>
{:else if isVideo}
  <!-- Attachments are user-provided recordings without captions -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video {src} class={className} {controls} preload="metadata" playsinline muted={!controls}></video>
{:else}
  <img {src} alt={file.name} class={className} loading="lazy" decoding="async" />
{/if}
