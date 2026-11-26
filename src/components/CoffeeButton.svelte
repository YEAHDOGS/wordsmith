<script>
  // Buy DOGS a coffee: a one-time thank you (COFFEE_PRICE_USD, a large pumpkin spice latte, plus tax), next to the
  // memberships on the paywall and in Settings. It opens DOGS's Buy Me a Coffee page (COFFEE_URL in src/lib/models.js),
  // in the system browser on the native apps. It unlocks nothing: only memberships do (api/functions/api/webhooks/bmc.js).
  import CupSoda from '@lucide/svelte/icons/cup-soda';
  import { openExternal } from '../lib/auth.svelte.js';
  import { IS_NATIVE } from '../lib/api.js';
  import { COFFEE_PRICE_USD, COFFEE_URL } from '../lib/models.js';
  import TEXT from './paywall.json';

  /** @type {{ class?: string, iconClass?: string }} */
  let { class: className = '', iconClass = 'size-4' } = $props();

  const label = TEXT.coffee.replace('{price}', COFFEE_PRICE_USD.toFixed(2));

  /** @param {MouseEvent} event */
  function open(event) {
    if (!IS_NATIVE) return;
    event.preventDefault();
    openExternal(COFFEE_URL);
  }
</script>

<a class={className} href={COFFEE_URL} target="_blank" rel="noopener noreferrer" title={TEXT.coffeeHint} onclick={open}>
  <CupSoda class={iconClass} />{label}
</a>
