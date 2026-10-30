<script>
  import { autosize, LINE_BREAKS } from '../lib/autosize.js';
  import { MAX_TITLE } from '../lib/models.js';

  /** @type {{ value: string, onchange: () => void, onnext: () => void }} */
  let { value = $bindable(), onchange, onnext } = $props();
  const TYPOGRAPHY = 'w-full min-w-0 text-left text-fluid-xl font-bold leading-tight tracking-tight text-ink';
  let editing = $state(false);

  /** Focus after the editable field replaces the preview. @param {HTMLTextAreaElement} node */
  function focus(node) {
    node.focus({ preventScroll: true });
    node.setSelectionRange(value.length, value.length);
  }
</script>

<div class="min-w-0 shrink-0">
  {#if editing}
    <textarea bind:value rows="1" maxlength={MAX_TITLE} aria-label="Title" placeholder="Title"
      use:autosize={value} {@attach focus}
      oninput={() => { value = value.replace(LINE_BREAKS, ' '); onchange(); }}
      onblur={() => (editing = false)}
      onkeydown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); onnext(); }
      }}
      class="{TYPOGRAPHY} block resize-none overflow-hidden bg-transparent placeholder:text-ink-faint focus:outline-none"></textarea>
  {:else}
    <button type="button" class="{TYPOGRAPHY} block focus-visible:outline-2 focus-visible:outline-accent"
      aria-label="Edit title" onclick={() => (editing = true)}>
      <span class="line-clamp-2 break-words [overflow-wrap:anywhere] {value ? '' : 'text-ink-faint'}">{value || 'Title'}</span>
    </button>
  {/if}
</div>
