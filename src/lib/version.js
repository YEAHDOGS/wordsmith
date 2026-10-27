// The running build's version and the pull request it shipped with, baked in at build time by vite.config.js
// from scripts/version.js. Anything bundled without Vite (the Worker, tests) sees the dev fallbacks instead.
/* global __APP_VERSION__, __LATEST_PR__ */

const DEV_VERSION = '1.0.0.dev';

/** Four-part app version without the "v", e.g. "1.0.0.01". @type {string} */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : DEV_VERSION;

/** The most recently merged pull request into master, or null offline. @type {{ number: number, title: string, url: string } | null} */
export const LATEST_PR = typeof __LATEST_PR__ === 'object' ? __LATEST_PR__ : null;
