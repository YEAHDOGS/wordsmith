// Timestamp formatting. Every interaction carries a time; lists show it relative, hover/timeline shows it exact.

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
const exact = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "3 min. ago", "yesterday". @param {number | null | undefined} ms */
export function ago(ms) {
  if (!ms) return '';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return 'just now';
  if (abs < HOUR) return relative.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return relative.format(Math.round(diff / HOUR), 'hour');
  if (abs < WEEK) return relative.format(Math.round(diff / DAY), 'day');
  return dayFormat.format(ms);
}

/** Full local date and time, to the second. @param {number | null | undefined} ms */
export function fullTime(ms) {
  return ms ? exact.format(ms) : '';
}

/** Day heading for the timeline. @param {number} ms */
export function dayLabel(ms) {
  return dayFormat.format(ms);
}

/** Time of day for timeline rows. @param {number} ms */
export function clockTime(ms) {
  return clock.format(ms);
}

/** "2h 15m" between two moments, for lead time and cycle time. @param {number | null} from @param {number | null} to */
export function duration(from, to) {
  if (!from || !to || to < from) return '';
  const ms = to - from;
  if (ms < MINUTE) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ${Math.round((ms % HOUR) / MINUTE)}m`;
  return `${Math.floor(ms / DAY)}d ${Math.round((ms % DAY) / HOUR)}h`;
}
