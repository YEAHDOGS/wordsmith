// The ticket calendar's model: every ticket lands on each day it moved (created, started, completed, and each PR
// merge), keyed by the local date (YYYY-MM-DD) so a ticket shows on the day it happened where you are. The month grid
// is always six weeks, so changing months never reflows the page.

export const EVENT_KINDS = ['created', 'started', 'completed', 'merged'];
const DAYS_PER_WEEK = 7;
const GRID_DAYS = 6 * DAYS_PER_WEEK;
// Intl week info numbers days 1 (Monday) to 7 (Sunday); Date.getDay() numbers them 0 (Sunday) to 6.
const SUNDAY = 7;
// A known Sunday, to name the weekdays in the visitor's language.
const REFERENCE_SUNDAY = new Date(2026, 0, 4);

/** @typedef {{ kind: string, at: number, note: any, pr?: any }} CalendarEvent */
/** @typedef {{ key: string, day: number, inMonth: boolean, date: Date }} CalendarDay */

/** Local "YYYY-MM-DD" for a moment. @param {number | Date} when */
export function dayKey(when) {
  const date = new Date(when);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The visitor's first day of the week as a Date.getDay() number; Sunday where the browser can't say. */
export function firstWeekday() {
  try {
    const locale = /** @type {any} */ (new Intl.Locale(navigator.language));
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    return (info?.firstDay ?? SUNDAY) % DAYS_PER_WEEK;
  } catch {
    return SUNDAY % DAYS_PER_WEEK;
  }
}

/**
 * Weekday names in grid order, narrow (phones) and short (wider screens).
 * @param {number} first Date.getDay() number of the first column
 */
export function weekdayNames(first) {
  const narrow = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
  const short = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
    const date = new Date(REFERENCE_SUNDAY);
    date.setDate(date.getDate() + ((first + index) % DAYS_PER_WEEK));
    return { narrow: narrow.format(date), short: short.format(date) };
  });
}

/**
 * The six weeks shown for a month, starting on the visitor's first weekday.
 * @param {number} year @param {number} month 0-11 @param {number} first Date.getDay() number of the first column
 * @returns {CalendarDay[]}
 */
export function monthDays(year, month, first) {
  const offset = (new Date(year, month, 1).getDay() - first + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return Array.from({ length: GRID_DAYS }, (_, index) => {
    const date = new Date(year, month, 1 - offset + index);
    return { key: dayKey(date), day: date.getDate(), inMonth: date.getMonth() === month, date };
  });
}

/**
 * Every live ticket's dated moments, grouped by local day and sorted by time within each day.
 * @param {any[]} notes
 * @returns {Map<string, CalendarEvent[]>}
 */
export function ticketDays(notes) {
  /** @type {Map<string, CalendarEvent[]>} */
  const days = new Map();
  /** @param {CalendarEvent} event */
  const add = (event) => {
    const key = dayKey(event.at);
    const list = days.get(key);
    if (list) list.push(event);
    else days.set(key, [event]);
  };
  for (const note of notes) {
    if (note.deleted_at) continue;
    if (note.created_at) add({ kind: 'created', at: note.created_at, note });
    if (note.started_at) add({ kind: 'started', at: note.started_at, note });
    if (note.completed_at) add({ kind: 'completed', at: note.completed_at, note });
    for (const pr of note.pull_requests ?? []) if (pr.merged_at) add({ kind: 'merged', at: pr.merged_at, note, pr });
  }
  for (const list of days.values()) list.sort((a, b) => a.at - b.at);
  return days;
}

/** The same day moved by `days`, crossing months as needed. @param {string} key @param {number} days */
export function shiftDay(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  return dayKey(new Date(year, month - 1, day + days));
}
