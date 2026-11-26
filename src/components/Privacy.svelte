<script>
  // Privacy Policy page: every piece of data wordsmith keeps, where it lives, why, and for how long.
  // Shown at /privacy whether or not anyone is signed in (see privacy-route.svelte.js). Content lives in privacy.json.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Database from '@lucide/svelte/icons/database';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { fly } from 'svelte/transition';
  import logo from '../assets/dogs-logo-cropped.png';
  import { reveal } from '../lib/reveal.js';
  import { privacy } from './privacy-route.svelte.js';
  import TEXT from './privacy.json';

  const DOGS_URL = 'https://dogs.red';
  const ID_PREFIX = 'privacy-';
  const PROMISE_STAGGER_MS = 70;
  const PROMISE_IN = { y: 10, duration: 320 };
  const DATE_FORMAT = /** @type {const} */ ({ dateStyle: 'long' });
  // Noon local time, so the effective date never slips a day in time zones west of UTC.
  const EFFECTIVE_DATE = new Date(`${TEXT.effective}T12:00:00`);
  const PLACE_ICONS = { d1: Database, r2: HardDrive, edge: Cloud, device: Smartphone };
  const FIELDS = /** @type {const} */ (['what', 'why', 'kept']);
  const CONTENTS = [...TEXT.groups, ...TEXT.sections].map(({ id, title }) => ({ id, title }));

  /** @type {HTMLElement | undefined} */
  let scroller = $state();

  /** In-page links scroll the list rather than touch the URL, which belongs to the routers. @param {string} id */
  function jump(id) {
    scroller?.querySelector(`#${ID_PREFIX}${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<main class="relative flex h-dvh w-full flex-col overflow-hidden bg-app text-ink">
  <header class="relative z-10 flex items-center justify-between gap-3 border-b border-line bg-app px-4 py-3 short:py-2 sm:px-8">
    <a href={DOGS_URL} target="_blank" rel="noopener noreferrer" class="group flex items-center gap-2.5" aria-label="DOGS (dogs.red)">
      <img src={logo} alt="DOGS logo" class="size-8 short:size-6 object-contain spring group-hover:rotate-12" />
      <span class="spring text-fluid-base font-bold tracking-[0.2em] group-hover:text-accent">DOGS</span>
    </a>
    <button class="spring press group inline-flex items-center gap-2 border border-line-strong px-3 py-2 short:py-1.5 text-sm text-ink hover:border-accent tv:text-xl"
      onclick={() => privacy.close()}>
      <ArrowLeft class="size-4 spring group-hover:-translate-x-0.5" />{TEXT.back}
    </button>
  </header>

  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain" bind:this={scroller}>
    <div class="mx-auto max-w-7xl border-line sm:border-x ultrawide:max-w-none">
      <!-- Hero: title on the spine, effective date beneath -->
      <section class="relative border-b border-line px-4 py-10 short:py-5 text-center sm:px-8 tv:py-20">
        <div class="spine-line pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true"></div>
        <div class="relative mx-auto max-w-2xl bg-app py-2 tv:max-w-4xl">
          <p class="font-mono text-xs tracking-widest text-accent uppercase tv:text-base">{TEXT.kicker}</p>
          <h1 class="mt-2 text-fluid-display font-black leading-none tracking-tight tv:text-display-tv">{TEXT.title}</h1>
          <p class="mt-3 text-fluid-sm text-ink-muted">
            {TEXT.effectiveLabel} <time class="font-mono text-ink" datetime={TEXT.effective}>{EFFECTIVE_DATE.toLocaleDateString(undefined, DATE_FORMAT)}</time>
          </p>
          <p class="mt-5 text-fluid-base leading-relaxed text-ink-muted">{TEXT.intro}</p>
        </div>
      </section>

      <ul class="grid grid-cols-1 gap-px border-b border-line bg-line min-[400px]:grid-cols-2 lg:grid-cols-4">
        {#each TEXT.promises as promise, index (promise.title)}
          <li class="bg-app p-4 sm:p-6 tv:p-10" in:fly={{ ...PROMISE_IN, delay: index * PROMISE_STAGGER_MS }}>
            <p class="text-fluid-base font-bold tracking-tight">{promise.title}</p>
            <p class="mt-1 text-fluid-sm text-ink-muted">{promise.body}</p>
          </li>
        {/each}
      </ul>

      <div class="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] tv:grid-cols-[22rem_minmax(0,1fr)]">
        <!-- Contents rail: sticks beside the policy on wide screens -->
        <nav class="hidden border-r border-line lg:block" aria-label={TEXT.contents}>
          <div class="sticky top-0 p-6 tv:p-10">
            <p class="mb-3 text-xs font-semibold tracking-wide text-ink-faint uppercase tv:text-base">{TEXT.contents}</p>
            <ul class="flex flex-col gap-1">
              {#each CONTENTS as item (item.id)}
                <li>
                  <button class="spring w-full py-1 text-left text-sm text-ink-muted hover:translate-x-1 hover:text-accent tv:text-xl" onclick={() => jump(item.id)}>{item.title}</button>
                </li>
              {/each}
            </ul>
          </div>
        </nav>

        <div class="min-w-0">
          <section class="border-b border-line px-4 py-6 sm:px-8 tv:px-12 tv:py-10" use:reveal={0}>
            <h2 class="text-fluid-xl font-black tracking-tight">{TEXT.inventoryTitle}</h2>
            <p class="mt-2 text-fluid-sm text-ink-muted">{TEXT.inventoryHint}</p>
          </section>

          {#each TEXT.groups as group, groupIndex (group.id)}
            <section id="{ID_PREFIX}{group.id}" class="scroll-mt-2 border-b border-line" aria-labelledby="{ID_PREFIX}{group.id}-title">
              <h3 id="{ID_PREFIX}{group.id}-title" class="border-b border-line px-4 pt-6 pb-3 text-fluid-lg font-bold tracking-tight sm:px-8 tv:px-12" use:reveal={groupIndex}>{group.title}</h3>
              <ul class="grid grid-cols-1 gap-px bg-line ultrawide:grid-cols-2">
                {#each group.items as item, index (item.name)}
                  {@const Icon = PLACE_ICONS[/** @type {keyof typeof PLACE_ICONS} */ (item.where)]}
                  <li class="min-w-0 bg-app px-4 py-5 sm:px-8 tv:px-12 tv:py-8" use:reveal={index}>
                    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h4 class="text-fluid-base font-bold tracking-tight">{item.name}</h4>
                      <span class="inline-flex items-center gap-1.5 rounded-ui-sm border border-line bg-surface px-2 py-1 text-xs text-ink-muted tv:text-base">
                        <Icon class="size-3.5 shrink-0 text-accent" />{TEXT.places[/** @type {keyof typeof TEXT.places} */ (item.where)]}
                      </span>
                    </div>
                    <dl class="grid gap-3 md:grid-cols-3 md:gap-6">
                      {#each FIELDS as field (field)}
                        <div class="min-w-0">
                          <dt class="mb-1 font-mono text-[0.6875rem] tracking-widest text-ink-faint uppercase tv:text-sm">{TEXT.fields[field]}</dt>
                          <dd class="text-fluid-sm leading-relaxed wrap-break-word {field === 'kept' ? 'text-ink' : 'text-ink-muted'}">{item[field]}</dd>
                        </div>
                      {/each}
                    </dl>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}

          {#each TEXT.sections as section, index (section.id)}
            <section id="{ID_PREFIX}{section.id}" class="scroll-mt-2 border-b border-line px-4 py-6 sm:px-8 tv:px-12 tv:py-10" use:reveal={index}>
              <h2 class="mb-3 text-fluid-lg font-bold tracking-tight">{section.title}</h2>
              <div class="flex max-w-3xl flex-col gap-3 tv:max-w-5xl">
                {#each section.paragraphs as paragraph (paragraph)}
                  <p class="text-fluid-sm leading-relaxed text-ink-muted">{paragraph}</p>
                {/each}
                {#if section.links}
                  <ul class="flex flex-col items-start gap-2">
                    {#each section.links as link (link.url)}
                      <li>
                        <a href={link.url} target="_blank" rel="noopener noreferrer"
                          class="spring inline-flex items-center gap-2 text-fluid-sm text-accent underline underline-offset-4 hover:text-ink">
                          {link.label}<ExternalLink class="size-3.5 shrink-0" />
                        </a>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </section>
          {/each}

          <div class="px-4 py-8 sm:px-8 tv:px-12">
            <a href={DOGS_URL} target="_blank" rel="noopener noreferrer"
              class="spring press inline-flex items-center gap-2 bg-accent px-5 py-3 text-fluid-sm font-semibold text-accent-ink hover:bg-accent-hover">
              {TEXT.contactLabel}<ExternalLink class="size-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</main>
