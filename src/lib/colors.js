// Class names for the theme tokens each model color and feature state maps to (see src/styles/theme.css).
// Written out in full so Tailwind can find them.

/** Card backgrounds per note color. */
export const TINT_BG = {
  default: 'bg-surface',
  red: 'bg-tint-red',
  orange: 'bg-tint-orange',
  yellow: 'bg-tint-yellow',
  green: 'bg-tint-green',
  teal: 'bg-tint-teal',
  blue: 'bg-tint-blue',
  purple: 'bg-tint-purple',
  pink: 'bg-tint-pink',
};

/** Solid dots for labels, projects and the color picker. */
export const DOT_BG = {
  default: 'bg-ink-faint',
  red: 'bg-dot-red',
  orange: 'bg-dot-orange',
  yellow: 'bg-dot-yellow',
  green: 'bg-dot-green',
  teal: 'bg-dot-teal',
  blue: 'bg-dot-blue',
  purple: 'bg-dot-purple',
  pink: 'bg-dot-pink',
};

/** Feature states: label, text color, soft background, and the dot color. */
export const STATE_STYLE = {
  requested: { label: 'Requested', text: 'text-requested', soft: 'bg-requested-soft', dot: 'bg-requested', border: 'border-requested' },
  in_progress: { label: 'In progress', text: 'text-progress', soft: 'bg-progress-soft', dot: 'bg-progress', border: 'border-progress' },
  complete: { label: 'Complete', text: 'text-complete', soft: 'bg-complete-soft', dot: 'bg-complete', border: 'border-complete' },
};

/** PR states. */
export const PR_STYLE = {
  open: 'text-progress',
  merged: 'text-complete',
  closed: 'text-ink-faint',
};
