// Shared class strings for the Settings cards (Settings, AppearanceSettings, InstallApp), so they stay identical.

/** One card in the 1px grid. min-w-0 lets long content wrap instead of widening the grid column. */
export const CARD = 'min-w-0 bg-app p-4 sm:p-6 tv:p-10';
export const HEADING = 'mb-1 text-fluid-lg font-bold tracking-tight';
export const SUBHEADING = 'mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase';
export const HINT = 'mb-4 text-fluid-sm text-ink-muted';
export const BUTTON = 'spring press inline-flex items-center gap-2 border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent disabled:opacity-40';
/** Inner boxes (code, lists, notices) follow the corner style too. */
export const BOX = 'rounded-ui-sm border border-line bg-surface';
