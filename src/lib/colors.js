// Class names for the theme tokens each model color and feature state maps to (see src/styles/theme.css).
// Written out in full so Tailwind can find them.
import { STATE_LABELS } from './models.js';

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

/** Lit difficulty dots on note cards (LevelDots), one color per level: 1 trivial green up to 5 epic red. */
export const DIFFICULTY_DOT = ['', 'bg-dot-green', 'bg-dot-blue', 'bg-dot-orange', 'bg-dot-purple', 'bg-dot-red'];

/** Text in a project's color: the project chip on note cards. Default projects keep muted ink. */
export const DOT_TEXT = {
  default: 'text-ink-muted',
  red: 'text-dot-red',
  orange: 'text-dot-orange',
  yellow: 'text-dot-yellow',
  green: 'text-dot-green',
  teal: 'text-dot-teal',
  blue: 'text-dot-blue',
  purple: 'text-dot-purple',
  pink: 'text-dot-pink',
};

/** Left rail in a note group's color, beside its indented notes on the notes page and the board. */
export const RAIL_BORDER = {
  default: 'border-line-strong',
  red: 'border-dot-red',
  orange: 'border-dot-orange',
  yellow: 'border-dot-yellow',
  green: 'border-dot-green',
  teal: 'border-dot-teal',
  blue: 'border-dot-blue',
  purple: 'border-dot-purple',
  pink: 'border-dot-pink',
};

/** Feature states: label, text color, soft background, and the dot color. */
export const STATE_STYLE = {
  requested: { label: STATE_LABELS.requested, text: 'text-requested', soft: 'bg-requested-soft', dot: 'bg-requested', border: 'border-requested' },
  in_progress: { label: STATE_LABELS.in_progress, text: 'text-progress', soft: 'bg-progress-soft', dot: 'bg-progress', border: 'border-progress' },
  complete: { label: STATE_LABELS.complete, text: 'text-complete', soft: 'bg-complete-soft', dot: 'bg-complete', border: 'border-complete' },
};

/** PR states. */
export const PR_STYLE = {
  open: 'text-progress',
  merged: 'text-complete',
  closed: 'text-ink-faint',
};
