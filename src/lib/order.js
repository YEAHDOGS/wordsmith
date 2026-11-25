// The one rule for the order of tickets, shared by the app (board, notes list, drag and drop) and the Worker (agent
// API, claim queue). Plain JS: the Worker imports it too.
//
// A queue runs: the top stack first, then by priority (highest first), then by hand-placed order.
// - The top stack holds every ticket since it was created, newest first: a new ticket always lands first, whatever
//   its priority. It stays there until it is dragged somewhere else.
// - Below the stack, tickets run by priority, then by notes.position (lower first), then by age.
// Both live in notes.position (REAL): stack positions sit at or below TOP_LIMIT, far under any hand-placed position
// (those are millisecond-timestamp sized), so one number says both where a ticket is and whether it is in the stack.

/** Gap left between two neighbouring positions. */
export const POSITION_STEP = 1024;
/** Positions at or below this are in the top stack. Timestamps in milliseconds stay under 1e13 for centuries. */
export const TOP_LIMIT = -1e14;
// The first ticket ever stacked starts here, leaving room under TOP_LIMIT to drop others after the stack's last one.
const TOP_START = TOP_LIMIT * 2;
/** The run every stacked ticket sorts in, above the highest level. */
export const TOP_RUN = Infinity;

/**
 * Sort key for hand-placed order: the stored position, else one implied by age in the same number space (features
 * oldest first, the plain notes of the sample data newest first).
 * @param {any} note
 */
export function orderKey(note) {
  return note.position ?? (note.kind === 'feature' ? note.created_at : -note.created_at);
}

/** Whether a ticket sits in the top stack. @param {any} note */
export function onTop(note) {
  return typeof note.position === 'number' && note.position <= TOP_LIMIT;
}

/**
 * Queue order: the top stack (newest first), then highest priority, then hand-placed order. The Requested columns,
 * the notes list's priority order and (as QUEUE_ORDER_SQL) the agent API all use it.
 * @param {any} a @param {any} b
 */
export function compareQueue(a, b) {
  return compareLevel(a, b, 'priority_level');
}

/**
 * Queue order by any level field (priority_level, difficulty): the top stack, then the highest level, then hand-placed order.
 * @param {any} a @param {any} b @param {string} field
 */
export function compareLevel(a, b, field) {
  const [topA, topB] = [onTop(a), onTop(b)];
  if (topA !== topB) return topA ? -1 : 1;
  // Two devices offline can hand out the same stack position: the newer ticket wins, the same on every device.
  if (topA) return a.position - b.position || b.created_at - a.created_at;
  return (b[field] ?? 0) - (a[field] ?? 0) || orderKey(a) - orderKey(b) || a.created_at - b.created_at;
}

/**
 * The position that puts a new ticket first: one step above the top stack.
 * @param {(number | null | undefined)[]} positions the positions of the owner's live notes (others are ignored)
 */
export function topPosition(positions) {
  let top = TOP_START;
  for (const position of positions) if (typeof position === 'number' && position <= TOP_LIMIT && position < top) top = position;
  return top - POSITION_STEP;
}

/** compareQueue as an SQL ORDER BY over the notes table. */
export const QUEUE_ORDER_SQL = `(COALESCE(position, 0) <= ${TOP_LIMIT}) DESC, CASE WHEN COALESCE(position, 0) <= ${TOP_LIMIT} THEN 0 ELSE priority_level END DESC, COALESCE(position, created_at) ASC, CASE WHEN COALESCE(position, 0) <= ${TOP_LIMIT} THEN -created_at ELSE created_at END ASC`;
