// Svelte action: a textarea that grows to fit its text, so a one-line field (a note's title, its status) wraps onto
// more lines on a narrow screen instead of hiding the rest of the line or widening the page. It re-measures on
// typing, when the bound value changes, and when its width changes (rotation, window resize).

/** @param {HTMLTextAreaElement} node */
function fit(node) {
  node.style.height = 'auto';
  node.style.height = `${node.scrollHeight}px`;
}

/**
 * @param {HTMLTextAreaElement} node
 * @param {unknown} [value] the bound value: passing it re-measures when it changes from outside (a sync, an undo)
 */
export function autosize(node, value) {
  let width = 0;
  let frame;
  const scheduleFit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => fit(node));
  };
  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    scheduleFit();
  });
  const oninput = scheduleFit;
  node.addEventListener('input', oninput);
  observer.observe(node);
  scheduleFit();
  return {
    update: scheduleFit,
    destroy() {
      observer.disconnect();
      node.removeEventListener('input', oninput);
      cancelAnimationFrame(frame);
    },
  };
}

/** Line breaks (with the spaces around them) in a one-line field: pasted ones are replaced with a single space. */
export const LINE_BREAKS = /\s*[\r\n]+\s*/g;
