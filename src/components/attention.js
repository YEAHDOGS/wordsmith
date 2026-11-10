// What the "Needs you" view (Attention.svelte) shows: only notes waiting on the owner. An agent asked something
// (notes.ask), or work in progress has an open pull request to review. Complete, archived, deleted and snoozed notes
// never show, so nothing quietly in progress ever does. Order: priority, then the project's place in the sidebar,
// then whoever has waited longest.
import { store } from '../lib/store.svelte.js';
import { navOrder } from '../lib/nav-order.js';

const OPTION = /^\s*([1-9])[.)]\s+(.+)$/;
const HOUR_MS = 3_600_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;
const WEEK_DAYS = 7;
const OWNER_PREFIX = '**Owner:**';

/** @typedef {{ note: any, reason: 'question' | 'review', question: string, options: { key: string, text: string }[] }} Attention */

/** Snooze choices, each with its wake time from a given moment. */
export const SNOOZES = [
  { key: 'hour', label: 'In an hour', wake: (/** @type {Date} */ now) => now.getTime() + HOUR_MS },
  { key: 'evening', label: 'This evening', wake: (/** @type {Date} */ now) => at(now, now.getHours() >= EVENING_HOUR ? 1 : 0, EVENING_HOUR) },
  { key: 'tomorrow', label: 'Tomorrow morning', wake: (/** @type {Date} */ now) => at(now, 1, MORNING_HOUR) },
  { key: 'week', label: 'Next week', wake: (/** @type {Date} */ now) => at(now, WEEK_DAYS, MORNING_HOUR) },
];

/** A local time some days from now, on the hour. @param {Date} now @param {number} days @param {number} hour */
function at(now, days, hour) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

/** Splits an ask into its question and its one-key options ("1. ..." lines). @param {string} ask */
export function parseAsk(ask) {
  const lines = ask.split('\n');
  const options = lines.map((line) => OPTION.exec(line)).filter((match) => match !== null).map((match) => ({ key: match[1], text: match[2].trim() }));
  return { question: lines.filter((line) => !OPTION.test(line)).join('\n').trim(), options };
}

/**
 * Everything waiting on the owner at `now`, most important first.
 * @param {number} now
 * @returns {Attention[]}
 */
export function needsYou(now) {
  const order = navOrder(store);
  const rank = (/** @type {string | null} */ projectId) => {
    const index = projectId ? order.indexOf(`project/${projectId}`) : -1;
    return index < 0 ? order.length : index;
  };
  /** @type {Attention[]} */
  const items = [];
  for (const note of store.notes) {
    if (note.deleted_at || note.archived || note.state === 'complete' || (note.snoozed_until ?? 0) > now) continue;
    const review = note.state === 'in_progress' && note.pull_requests.some((/** @type {any} */ pr) => pr.state === 'open');
    if (!note.ask && !review) continue;
    items.push({ note, reason: note.ask ? 'question' : 'review', ...parseAsk(note.ask || '') });
  }
  return items.sort((a, b) => b.note.priority_level - a.note.priority_level || rank(a.note.project_id) - rank(b.note.project_id) || a.note.updated_at - b.note.updated_at);
}

/** The owner's answer: appended to the body where the agent reads it, and the question closes. @param {any} note @param {string} text */
export function answer(note, text) {
  store.update('notes', note.id, { body: `${note.body}\n\n${OWNER_PREFIX} ${text}`.trim(), ask: '' });
}
