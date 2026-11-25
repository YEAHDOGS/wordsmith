<script>
  // The free trial as a meter, in Settings under Account: how much of the TRIAL_DAYS is used and how long is left.
  // Only while the trial is the best plan the account holds (auth.trialEndsAt); the bar fills as the days go and the
  // time left counts down. The space it takes never changes while it shows.
  import { auth } from '../lib/auth.svelte.js';
  import { TRIAL_DAYS, TRIAL_MS } from '../lib/models.js';
  import { countdown } from './trial-countdown.js';
  import TEXT from './paywall.json';

  // A minute is fine here: the top bar's pill already counts the seconds.
  const TICK_MS = 60_000;
  const PERCENT = 100;

  const ends = $derived(auth.trialEndsAt);
  let now = $state(Date.now());
  $effect(() => {
    if (ends === null) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), TICK_MS);
    return () => clearInterval(timer);
  });
  const left = $derived(ends === null ? 0 : Math.max(0, ends - now));
  const used = $derived(Math.min(PERCENT, Math.max(0, ((TRIAL_MS - left) / TRIAL_MS) * PERCENT)));
  const time = $derived(countdown(left, TEXT.units).short);
</script>

{#if ends !== null}
  <div class="mb-4">
    <div class="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
      <span class="font-semibold text-ink">{TEXT.meter.replace('{days}', String(TRIAL_DAYS))}</span>
      <span class="font-mono text-accent tabular-nums">{TEXT.meterLeft.replace('{time}', time)}</span>
    </div>
    <div class="h-2 border border-line-strong bg-surface tv:h-3" role="meter" aria-label={TEXT.meter.replace('{days}', String(TRIAL_DAYS))}
      aria-valuemin="0" aria-valuemax={PERCENT} aria-valuenow={Math.round(used)} aria-valuetext={TEXT.meterLeft.replace('{time}', time)}>
      <!-- Grows by scale, not width, so nothing reflows as it fills -->
      <div class="h-full origin-left bg-accent transition-transform duration-500 ease-(--ease-out-soft)" style:transform="scaleX({used / PERCENT})"></div>
    </div>
    <p class="mt-1.5 text-xs text-ink-faint">{TEXT.meterHint}</p>
  </div>
{/if}
