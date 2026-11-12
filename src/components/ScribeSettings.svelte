<script>
  // Scribe's model settings: which provider turns speech into tickets (src/lib/scribe-providers.json), and what that
  // provider needs. wordsmith cloud shows its models and today's allowance; a server on this computer shows its
  // address, its models, and, when the browser can't reach it, how to let this site in (OLLAMA_ORIGINS and friends)
  // with this site's own address filled in. Shown twice on the Scribe page (side column and floating panel).
  import { fade, slide } from 'svelte/transition';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { SCRIBE_PROVIDERS, scribe } from '../lib/scribe.svelte.js';
  import { NOT_CHAT, listModels } from '../lib/scribe-llm.js';
  import { auth } from '../lib/auth.svelte.js';
  import { speech } from '../lib/speech.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { byName } from '../lib/nav-order.js';
  import TEXT from './scribe.json';

  /** @type {{ field: string, label: string, button: string }} */
  let { field, label, button } = $props();

  const CLOUD_KIND = 'wordsmith';
  const COPIED_MS = 1_500;
  const WORKERS_DEV = '.workers.dev';
  // Ollama understands one wildcard per address: a Preview's own address names its branch, so all of the account's
  // Previews (<branch>-wordsmith.<account>.workers.dev) are allowed at once.
  const SCRIPT = 'npm run scribe:ollama -- --preview={site}';
  const COMMANDS = [
    { key: 'windows', text: 'setx OLLAMA_ORIGINS "{origins}"' },
    { key: 'mac', text: 'launchctl setenv OLLAMA_ORIGINS "{origins}"' },
    { key: 'linux', text: 'sudo systemctl edit ollama\n# [Service]\n# Environment="OLLAMA_ORIGINS={origins}"\nsudo systemctl restart ollama' },
  ];
  const PLATFORM = (/** @type {any} */ (navigator).userAgentData?.platform || navigator.platform || '').toLowerCase();
  const MINE = PLATFORM.includes('win') ? 'windows' : PLATFORM.includes('mac') ? 'mac' : 'linux';
  const SITE = location.origin;
  const ORIGINS = location.hostname.endsWith(WORKERS_DEV) ? `https://*.${location.hostname.split('.').slice(1).join('.')}` : SITE;
  const CODE = 'selectable block whitespace-pre-wrap break-all border border-line bg-app px-2 py-1.5 pr-8 font-mono text-[0.6875rem] leading-relaxed text-ink tv:text-sm';

  const projects = $derived(byName(store.projects.filter((project) => !project.deleted_at)));
  const provider = $derived(scribe.provider);
  const cloud = $derived(provider.kind === CLOUD_KIND);
  // Which engine hears you: a model on this device (desktop apps), or the browser's recognition.
  const engineNote = $derived(scribe.engine === 'local' ? TEXT.engineLocal.replace('{model}', speech.model?.name ?? '') : scribe.engine === 'browser' ? TEXT.engineBrowser : '');
  // Where your words go: speech on this device or in the browser, then text to the cloud or to your server.
  const privacy = $derived(cloud ? (scribe.engine === 'local' ? TEXT.privacyCloudLocal : TEXT.privacyCloud) : scribe.engine === 'local' ? TEXT.privacyLocal : TEXT.privacy);
  /** @type {string[]} */
  let models = $state([]);
  let finding = $state(false);
  let findNote = $state('');
  // The help for reaching a server on this computer: opens by itself when the browser can't reach it.
  let helpOpen = $state(false);
  let copied = $state('');

  $effect(() => {
    // Asked once when shown; after a failure, the Check again button asks.
    if (cloud && auth.user && !scribe.cloud && !scribe.cloudError) scribe.loadCloud();
  });

  async function findModels() {
    finding = true;
    findNote = '';
    try {
      models = await listModels(scribe.settings.endpoint, false, scribe.settings.key);
      findNote = TEXT.found.replace('{count}', String(models.length));
      const chat = models.find((name) => !NOT_CHAT.test(name));
      if (!scribe.settings.model && chat) scribe.configure({ model: chat });
    } catch (error) {
      models = [];
      // The browser refuses outright (no status) when the server is down or doesn't allow this site.
      helpOpen = true;
      findNote = /** @type {Error} */ (error).message;
    }
    finding = false;
  }

  /** @param {string} id */
  function choose(id) {
    models = [];
    findNote = '';
    helpOpen = false;
    scribe.configure({ provider: id });
  }

  /** @param {string} key @param {string} text */
  async function copy(key, text) {
    await navigator.clipboard?.writeText(text);
    copied = key;
    setTimeout(() => {
      if (copied === key) copied = '';
    }, COPIED_MS);
  }
</script>

{#snippet code(/** @type {string} */ key, /** @type {string} */ text)}
  <div class="relative">
    <code class={CODE}>{text}</code>
    <button class="spring press absolute top-1 right-1 p-1 text-ink-faint hover:text-ink" aria-label={copied === key ? TEXT.help.copied : TEXT.help.copy} title={TEXT.help.copy} onclick={() => copy(key, text)}>
      {#if copied === key}<Check class="size-3.5 text-complete" />{:else}<Copy class="size-3.5" />{/if}
    </button>
  </div>
{/snippet}

<label class={label}>{TEXT.project}
  <select class={field} value={scribe.settings.projectId} onchange={(event) => scribe.configure({ projectId: event.currentTarget.value })}>
    <option value="">{TEXT.noProject}</option>
    {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
  </select>
</label>

<label class={label}>{TEXT.provider}
  <select class={field} value={provider.id} onchange={(event) => choose(event.currentTarget.value)}>
    {#each SCRIBE_PROVIDERS as option (option.id)}<option value={option.id}>{option.name}</option>{/each}
  </select>
</label>
{#key provider.id}<p class="text-xs leading-relaxed text-ink-faint" in:fade={{ duration: 150 }}>{provider.note}</p>{/key}

{#if cloud}
  {#if !auth.user}
    <p class="text-xs leading-relaxed text-ink-muted">{TEXT.cloudSignIn}</p>
  {:else if scribe.cloudError}
    <p class="flex flex-wrap items-center gap-2 text-xs leading-relaxed text-ink-muted" role="status">{TEXT.cloudOffline}
      <button class={button} onclick={() => scribe.loadCloud()}>{TEXT.help.check}</button>
    </p>
  {:else if scribe.cloud && !scribe.cloud.available}
    <p class="text-xs leading-relaxed text-ink-muted">{TEXT.cloudUnavailable}</p>
  {:else if scribe.cloud}
    <label class={label}>{TEXT.cloudModel}
      <select class={field} value={scribe.cloudModel || scribe.cloud.default} onchange={(event) => scribe.configure({ model: event.currentTarget.value })}>
        {#each scribe.cloud.models as model (model.id)}<option value={model.id}>{model.name}: {model.note}</option>{/each}
      </select>
    </label>
    <div class="flex flex-col gap-1" role="status">
      <p class="font-mono text-[0.6875rem] text-ink-muted tv:text-sm">{TEXT.cloudUsage.replace('{used}', scribe.cloud.used.toLocaleString()).replace('{limit}', scribe.cloud.limit.toLocaleString())}</p>
      <div class="h-1 w-full overflow-hidden bg-line" aria-hidden="true">
        <div class="h-full w-full origin-left bg-accent transition-transform duration-500 ease-(--ease-spring)" style:transform="scaleX({Math.min(1, scribe.cloud.used / Math.max(1, scribe.cloud.limit))})"></div>
      </div>
      <p class="text-xs leading-relaxed text-ink-faint short:hidden">{TEXT.cloudUsageHint}</p>
    </div>
  {/if}
{:else}
  <label class={label}>{TEXT.endpoint}
    <input class="{field} font-mono" type="url" value={scribe.settings.endpoint} spellcheck="false" autocomplete="off" oninput={(event) => scribe.configure({ endpoint: event.currentTarget.value })} />
  </label>
  {#if provider.key}
    <label class={label}>{TEXT.key}
      <input class="{field} font-mono" type="password" value={scribe.settings.key} placeholder={TEXT.keyPlaceholder} spellcheck="false" autocomplete="off" oninput={(event) => scribe.configure({ key: event.currentTarget.value })} />
    </label>
  {/if}
  <div class="flex items-end gap-1">
    <label class="{label} min-w-0 flex-1">{TEXT.model}
      {#if models.length}
        <select class={field} value={scribe.settings.model} onchange={(event) => scribe.configure({ model: event.currentTarget.value })}>
          {#each models as model (model)}<option value={model}>{model}</option>{/each}
        </select>
      {:else}
        <input class="{field} font-mono" value={scribe.settings.model} placeholder={TEXT.modelPlaceholder} spellcheck="false" autocomplete="off" oninput={(event) => scribe.configure({ model: event.currentTarget.value })} />
      {/if}
    </label>
    <button class="{button} min-h-9 shrink-0" disabled={finding || !scribe.settings.endpoint.trim()} onclick={findModels}>{finding ? TEXT.finding : TEXT.find}</button>
  </div>
  {#if findNote}<p class="text-xs leading-relaxed text-ink-muted" role="status" in:fade>{findNote}</p>{/if}

  {#if provider.local}
    <details class="border border-line" bind:open={helpOpen}>
      <summary class="cursor-pointer px-2 py-1.5 text-xs text-ink-muted hover:text-ink">{TEXT.help.title}</summary>
      {#if helpOpen}<div class="flex flex-col gap-2 border-t border-line p-2 text-xs leading-relaxed text-ink-muted" transition:slide={{ duration: 180 }}>
        {#if provider.id === 'lmstudio'}
          <p>{TEXT.help.lmstudio}</p>
        {:else if provider.id === 'llamacpp'}
          <p>{TEXT.help.llamacpp}</p>
        {:else}
          <p>{TEXT.help.intro}</p>
          <p class="font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint">{TEXT.help.allow}</p>
          {@render code('origins', ORIGINS)}
          {#each [...COMMANDS].sort((a, b) => Number(b.key === MINE) - Number(a.key === MINE)) as command (command.key)}
            <p>{TEXT.help[/** @type {'windows' | 'mac' | 'linux'} */ (command.key)]}</p>
            {@render code(command.key, command.text.replaceAll('{origins}', ORIGINS))}
          {/each}
          <p class="text-ink-faint">{TEXT.help.keep}</p>
          <p>{TEXT.help.script}</p>
          {@render code('script', SCRIPT.replace('{site}', SITE))}
        {/if}
        <p class="text-ink-faint">{TEXT.help.chrome}</p>
        <button class="{button} self-start" disabled={finding || !scribe.settings.endpoint.trim()} onclick={findModels}>{finding ? TEXT.help.checking : TEXT.help.check}</button>
      </div>{/if}
    </details>
  {/if}
{/if}

<!-- Fixed height for the engine line, so finding a local model after start-up doesn't move what's under it -->
<p class="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-muted">
  <span class="min-w-0 truncate">{engineNote}</span>
  {#if speech.available}<button class="spring press shrink-0 font-semibold text-accent hover:text-accent-hover" onclick={() => router.go('settings')}>{TEXT.speechSettings}</button>{/if}
</p>
<p class="text-xs leading-relaxed text-ink-faint">{privacy}</p>
