<script>
  // Demo mode is read-only. The store refuses every write (store.blockedInDemo); this stops typing and dropping in
  // any field but search before it starts, and says why whenever something was refused. Fields turn readOnly on focus
  // too: phone keyboards compose text through input events that can't be cancelled.
  import { fly } from 'svelte/transition';
  import { backOut, cubicIn } from 'svelte/easing';
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import { store } from '../lib/store.svelte.js';

  const NOTICE = 'The demo is read-only. Sign in to make changes.';
  const NOTICE_MS = 2_600;
  const NOTICE_IN = { y: 12, duration: 200, easing: backOut };
  const NOTICE_OUT = { y: 8, duration: 140, easing: cubicIn };
  // Fields that only read (search) keep working.
  const READ_FIELDS = 'input[type="search"]';
  // Keys that would edit a field; a readOnly field ignores them silently, so the notice says why.
  const EDIT_KEYS = ['Backspace', 'Delete', 'Enter'];

  let shown = $state(false);

  $effect(() => {
    if (!store.refusedAt) return;
    shown = true;
    const timer = setTimeout(() => (shown = false), NOTICE_MS);
    return () => clearTimeout(timer);
  });

  /** @param {FocusEvent} event */
  function lock(event) {
    const field = /** @type {HTMLElement} */ (event.target);
    if (!store.demo || field.matches(READ_FIELDS)) return;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.readOnly = true;
  }

  /** Lifts the notice into the top layer, above an open modal note editor (browsers without popovers keep z-50). @param {HTMLElement} node */
  function topLayer(node) {
    node.showPopover?.();
  }

  /** @param {KeyboardEvent} event */
  function explain(event) {
    const field = /** @type {HTMLElement} */ (event.target);
    const editing = (event.key.length === 1 && !event.ctrlKey && !event.metaKey) || EDIT_KEYS.includes(event.key);
    if (store.demo && editing && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.readOnly && !field.matches(READ_FIELDS)) store.blockedInDemo();
  }

  /** @param {Event} event */
  function refuse(event) {
    if (!store.demo || /** @type {Element} */ (event.target).closest?.(READ_FIELDS)) return;
    event.preventDefault();
    store.blockedInDemo();
  }
</script>

<svelte:window onfocusincapture={lock} onkeydowncapture={explain} onbeforeinputcapture={refuse} ondropcapture={refuse} />

{#if shown}
  <p role="status" popover="manual" {@attach topLayer} class="pointer-events-none fixed inset-x-0 top-auto bottom-20 z-50 m-0 mx-auto flex w-fit max-w-[calc(100vw-1rem)] items-center gap-2 border border-accent bg-surface-raised px-3 py-2 text-sm text-ink shadow-lg md:bottom-6 tv:text-xl"
    in:fly={NOTICE_IN} out:fly={NOTICE_OUT}>
    <FlaskConical class="size-4 shrink-0 text-accent" />{NOTICE}
  </p>
{/if}
