<script>
  // Equal-width segmented radio group whose highlight slides between options (transform only, so nothing reflows).
  // Arrow keys move the choice, for keyboards and TV remotes; only the chosen option is in the tab order.

  /** Arrow key -> how far the choice moves. */
  const KEY_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const FULL_WIDTH_PERCENT = 100;

  /** @type {{ options: readonly string[], value: string, labels: Record<string, string>, label: string, onselect: (option: any) => void }} */
  let { options, value, labels, label, onselect } = $props();

  const index = $derived(Math.max(0, options.indexOf(value)));

  /** @param {KeyboardEvent & { currentTarget: HTMLElement }} event */
  function onkeydown(event) {
    const step = KEY_STEPS[/** @type {keyof typeof KEY_STEPS} */ (event.key)];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onselect(options[next]);
    event.currentTarget.querySelectorAll('button')[next]?.focus();
  }
</script>

<div class="relative grid rounded-ui border border-line bg-app p-0.5" style:grid-template-columns="repeat({options.length}, minmax(0, 1fr))"
  role="radiogroup" aria-label={label} tabindex="-1" {onkeydown}>
  <span aria-hidden="true" class="absolute inset-y-0.5 left-0.5 rounded-ui-sm bg-accent-soft transition-transform duration-150 ease-spring"
    style:width="calc((100% - 0.25rem) / {options.length})" style:transform="translateX({index * FULL_WIDTH_PERCENT}%)"></span>
  {#each options as option (option)}
    <button type="button" role="radio" aria-checked={value === option} tabindex={value === option ? 0 : -1}
      class="spring press relative truncate px-2 py-2 text-sm {value === option ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'}"
      onclick={() => onselect(option)}>{labels[option]}</button>
  {/each}
</div>
