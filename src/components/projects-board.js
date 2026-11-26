// The Projects page's logic (ProjectsBoard.svelte): what each project's card shows, the eight orders the cards can
// take, and the choices (order, direction, thumbnail size) this device remembers. No requests: everything is read
// from what the store already holds.
import { COLORS, FEATURE_STATES, attachmentKind } from '../lib/models.js';
import { plainText } from '../lib/markdown.js';

const PREFS_KEY = 'ws_projects_board';
const DESCRIPTION_CHARS = 160;
// Orders: created (date made), month (month made, under month headings), updated (the project's own last change),
// touched (the last change to the project or anything in it), description, name (alphabetical), theme (the project's
// color, under color headings), tag (its most used label, under label headings).
export const SORTS = /** @type {const} */ (['touched', 'updated', 'created', 'month', 'name', 'description', 'theme', 'tag']);
/** Orders that start newest first; the rest start A to Z. */
const NEWEST_FIRST = new Set(['touched', 'updated', 'created', 'month']);
/** Orders that put the cards under headings. */
const GROUPED = new Set(['month', 'theme', 'tag']);
// Thumbnail widths, in rem: the slider's stops. The grid fits as many columns of at least this width as there is room for.
export const SIZES = [6.5, 9, 12, 16, 21, 28];
const DEFAULT_SIZE = 2;
// Below this stop a card shows its name alone: the description and counts don't fit.
export const DETAIL_FROM_SIZE = 2;
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** @typedef {{ sort: typeof SORTS[number], descending: boolean, size: number }} BoardPrefs */
/** @typedef {{ project: any, description: string, counts: Record<string, number>, touched: number, tag: any, cover: any }} ProjectCard */

/** Whether an order starts newest (or Z) first. @param {string} sort */
export const startsDescending = (sort) => NEWEST_FIRST.has(sort);

/** This device's saved choices, or the defaults. @returns {BoardPrefs} */
export function loadPrefs() {
  /** @type {Partial<BoardPrefs>} */
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  const sort = SORTS.includes(/** @type {any} */ (saved.sort)) ? /** @type {typeof SORTS[number]} */ (saved.sort) : SORTS[0];
  return {
    sort,
    descending: typeof saved.descending === 'boolean' ? saved.descending : startsDescending(sort),
    size: Number.isInteger(saved.size) && Number(saved.size) >= 0 && Number(saved.size) < SIZES.length ? Number(saved.size) : DEFAULT_SIZE,
  };
}

/** @param {BoardPrefs} prefs */
export function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * One card per live project: its counts per state, when it was last touched, its most used label and its newest image.
 * @param {{ projects: any[], notes: any[], labels: any[], attachments: any[] }} store
 * @returns {ProjectCard[]}
 */
export function projectCards(store) {
  /** @type {Map<string, ProjectCard & { tags: Map<string, number> }>} */
  const cards = new Map();
  for (const project of store.projects) {
    if (project.deleted_at) continue;
    cards.set(project.id, {
      project,
      description: plainText(project.description, DESCRIPTION_CHARS),
      counts: Object.fromEntries(FEATURE_STATES.map((state) => [state, 0])),
      touched: project.updated_at || project.created_at || 0,
      tag: null,
      cover: null,
      tags: new Map(),
    });
  }
  /** @type {Map<string, string>} note id -> project id, for the attachments below */
  const noteProject = new Map();
  for (const note of store.notes) {
    const card = note.deleted_at ? undefined : cards.get(note.project_id);
    if (!card) continue;
    noteProject.set(note.id, note.project_id);
    card.touched = Math.max(card.touched, note.updated_at || 0);
    if (note.archived) continue;
    if (note.kind === 'feature' && note.state in card.counts) card.counts[note.state] += 1;
    for (const id of note.label_ids || []) card.tags.set(id, (card.tags.get(id) || 0) + 1);
  }
  for (const file of store.attachments) {
    const card = file.deleted_at ? undefined : cards.get(noteProject.get(file.note_id) || '');
    if (!card || attachmentKind(file.type) !== 'image') continue;
    if (!card.cover || file.created_at > card.cover.created_at) card.cover = file;
  }
  const labels = new Map(store.labels.filter((label) => !label.deleted_at).map((label) => [label.id, label]));
  return [...cards.values()].map(({ tags, ...card }) => {
    // The most used label wins; a tie goes to the name that comes first.
    const used = [...tags].map(([id, count]) => ({ label: labels.get(id), count })).filter((entry) => entry.label);
    used.sort((a, b) => b.count - a.count || collator.compare(a.label.name, b.label.name));
    return { ...card, tag: used[0]?.label ?? null };
  });
}

/** Cards matching the search box: name, description and repo. @param {ProjectCard[]} cards @param {string} query */
export function searchCards(cards, query) {
  const text = query.trim().toLowerCase();
  if (!text) return cards;
  return cards.filter(({ project }) => [project.name, project.description, project.repo].some((field) => String(field || '').toLowerCase().includes(text)));
}

/** The first day of the month a moment falls in, in local time. @param {number} ms */
function monthStart(ms) {
  const date = new Date(ms || 0);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** Empty text sorts after everything else, whichever way the order runs. @param {string} a @param {string} b @param {number} way */
function compareText(a, b, way) {
  if (!a || !b) return Number(!a) - Number(!b);
  return collator.compare(a, b) * way;
}

/**
 * The cards in order, under headings where the order has them (one group with no heading otherwise).
 * @param {ProjectCard[]} cards
 * @param {BoardPrefs} prefs
 * @param {{ colors: Record<string, string>, noTag: string }} text heading words
 * @returns {{ key: string, heading: string, cards: ProjectCard[] }[]}
 */
export function arrange(cards, { sort, descending }, text) {
  const way = descending ? -1 : 1;
  const byName = (/** @type {ProjectCard} */ a, /** @type {ProjectCard} */ b) => collator.compare(a.project.name, b.project.name);
  /** @type {Record<string, (a: ProjectCard, b: ProjectCard) => number>} */
  const orders = {
    touched: (a, b) => (a.touched - b.touched) * way,
    updated: (a, b) => (a.project.updated_at - b.project.updated_at) * way,
    created: (a, b) => (a.project.created_at - b.project.created_at) * way,
    month: (a, b) => (monthStart(a.project.created_at) - monthStart(b.project.created_at)) * way,
    name: (a, b) => byName(a, b) * way,
    description: (a, b) => compareText(a.description, b.description, way),
    theme: (a, b) => (COLORS.indexOf(a.project.color) - COLORS.indexOf(b.project.color)) * way,
    tag: (a, b) => compareText(a.tag?.name || '', b.tag?.name || '', way),
  };
  const sorted = [...cards].sort((a, b) => orders[sort](a, b) || byName(a, b));
  if (!GROUPED.has(sort)) return [{ key: 'all', heading: '', cards: sorted }];
  /** @type {Record<string, (card: ProjectCard) => { key: string, heading: string }>} */
  const headings = {
    month: (card) => ({ key: String(monthStart(card.project.created_at)), heading: monthFormat.format(card.project.created_at || 0) }),
    theme: (card) => ({ key: card.project.color, heading: text.colors[card.project.color] || text.colors.default }),
    tag: (card) => ({ key: card.tag?.id || '', heading: card.tag?.name || text.noTag }),
  };
  /** @type {{ key: string, heading: string, cards: ProjectCard[] }[]} */
  const groups = [];
  for (const card of sorted) {
    const { key, heading } = headings[sort](card);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.cards.push(card);
    else groups.push({ key, heading, cards: [card] });
  }
  return groups;
}
