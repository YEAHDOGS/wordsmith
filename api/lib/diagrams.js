// Architecture diagrams for agents (/api/v1/diagrams and the MCP diagram tools). The app edits the same rows through
// sync; here an agent sends boxes and arrows by name and the server fills in ids, positions and sizes.
import { MAX_DIAGRAM_EDGES, MAX_DIAGRAM_NODES, cleanRow, isId, newRow } from '../../src/lib/models.js';
import { layout, liveEdges, toMermaid } from '../../src/lib/diagram.js';
import { resolveProject } from './agent.js';
import { HttpError } from './http.js';
import { toApi, upsertStatement } from './rows.js';

// Live diagrams per user: bounds the list query and what sync downloads.
const MAX_DIAGRAMS = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const MAX_ID = 64;
// Ids made from a title keep this much of it, leaving room for a "-2" style suffix.
const SLUG_LENGTH = 40;
const NODE_FIELDS = ['kind', 'title', 'text', 'color', 'x', 'y', 'w', 'h', 'inside'];

/** A list from the request, or a 400 naming the field. @param {Record<string, any>} input @param {string} field */
function listOf(input, field) {
  if (input[field] === undefined) return null;
  if (!Array.isArray(input[field])) throw new HttpError(BAD_REQUEST, `${field} must be a list`);
  return /** @type {any[]} */ (input[field]);
}

/** An id not in `taken`, made from a title: "API gateway" -> "api-gateway", then "api-gateway-2". @param {string} text @param {Set<string>} taken */
function freshId(text, taken) {
  const base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_LENGTH) || 'node';
  let id = base;
  for (let copy = 2; taken.has(id); copy++) id = `${base}-${copy}`;
  taken.add(id);
  return id;
}

/**
 * Merges boxes an agent sent into the stored ones. A box with a known id updates that box and keeps whatever it didn't
 * mention (so a retitle doesn't move it); a new one gets an id from its title when it has none.
 * @param {any[]} current @param {any[]} incoming
 */
function mergeNodes(current, incoming) {
  const nodes = current.map((node) => ({ ...node }));
  const taken = new Set(nodes.map((node) => node.id));
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') throw new HttpError(BAD_REQUEST, 'Each node must be an object: { title, kind?, text?, color?, id?, x?, y?, w?, h?, inside? }');
    const title = raw.title ?? raw.name ?? raw.label;
    const patch = Object.fromEntries(NODE_FIELDS.filter((field) => raw[field] !== undefined).map((field) => [field, raw[field]]));
    if (title !== undefined) patch.title = title;
    const known = nodes.find((node) => node.id === raw.id);
    if (known) {
      Object.assign(known, patch);
      continue;
    }
    if (raw.id !== undefined && !isId(raw.id)) throw new HttpError(BAD_REQUEST, `Node id "${raw.id}" must be letters, digits, - or _ (at most ${MAX_ID})`);
    if (raw.id !== undefined) taken.add(raw.id);
    nodes.push({ id: raw.id ?? freshId(title ?? raw.kind ?? '', taken), ...patch });
  }
  return nodes;
}

/**
 * Turns arrows an agent sent into stored ones. from and to name a box by id or, failing that, by title.
 * @param {any[]} nodes @param {any[]} current @param {any[]} incoming
 */
function mergeEdges(nodes, current, incoming) {
  const edges = current.map((edge) => ({ ...edge }));
  const taken = new Set(edges.map((edge) => edge.id));
  const find = (/** @type {unknown} */ ref) => {
    const text = String(ref ?? '').trim().toLowerCase();
    const node = nodes.find((candidate) => candidate.id === ref) ?? nodes.find((candidate) => String(candidate.title ?? '').trim().toLowerCase() === text);
    if (!node) throw new HttpError(BAD_REQUEST, `No node "${ref}" for an edge: use a node id or its exact title`);
    return node.id;
  };
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') throw new HttpError(BAD_REQUEST, 'Each edge must be an object: { from, to, label?, style? }');
    const from = find(raw.from);
    const to = find(raw.to);
    const known = edges.find((edge) => edge.id === raw.id) ?? edges.find((edge) => edge.from === from && edge.to === to);
    if (known) {
      Object.assign(known, { from, to }, raw.label !== undefined && { label: raw.label }, raw.style !== undefined && { style: raw.style });
      continue;
    }
    if (raw.id !== undefined && !isId(raw.id)) throw new HttpError(BAD_REQUEST, `Edge id "${raw.id}" must be letters, digits, - or _ (at most ${MAX_ID})`);
    if (raw.id !== undefined) taken.add(raw.id);
    edges.push({ id: raw.id ?? freshId(`${from}-${to}`.slice(0, SLUG_LENGTH), taken), from, to, label: raw.label ?? '', style: raw.style });
  }
  return edges;
}

/** A diagram as agents read it, with its project's name inlined. @param {Record<string, any>} diagram API-shaped @param {Map<string, string>} projects */
function present(diagram, projects) {
  return { ...diagram, project: diagram.project_id ? { id: diagram.project_id, name: projects.get(diagram.project_id) ?? '' } : null };
}

/** Project names by id. @param {Record<string, any>} env @param {string} userId @returns {Promise<Map<string, string>>} */
async function projectNames(env, userId) {
  const { results } = await env.DB.prepare('SELECT id, name FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(userId).all();
  return new Map(results.map((/** @type {any} */ row) => [row.id, row.name]));
}

/**
 * Diagrams, newest change first, without their boxes: { id, name, description, project, nodes (count), edges (count) }.
 * @param {Record<string, any>} env @param {string} userId @param {URLSearchParams} query project= narrows to one project
 */
export async function listDiagrams(env, userId, query) {
  const project = await resolveProject(env, userId, query.get('project'));
  const { results } = await env.DB.prepare(
    `SELECT * FROM diagrams WHERE user_id = ?1 AND deleted_at IS NULL AND (?2 IS NULL OR project_id = ?2) ORDER BY updated_at DESC LIMIT ?3`,
  ).bind(userId, project?.id ?? null, MAX_DIAGRAMS).all();
  const projects = await projectNames(env, userId);
  return results.map((/** @type {any} */ row) => {
    const diagram = present(toApi(row), projects);
    return { ...diagram, nodes: diagram.nodes.length, edges: diagram.edges.length };
  });
}

/** One live diagram row, API-shaped, or a 404. @param {Record<string, any>} env @param {string} userId @param {string} id */
async function load(env, userId, id) {
  const row = isId(id) ? await env.DB.prepare('SELECT * FROM diagrams WHERE user_id = ? AND id = ? AND deleted_at IS NULL').bind(userId, id).first() : null;
  if (!row) throw new HttpError(NOT_FOUND, 'Diagram not found');
  return toApi(row);
}

/** One diagram with its boxes and arrows, and the same thing as Mermaid source. @param {Record<string, any>} env @param {string} userId @param {string} id */
export async function getDiagram(env, userId, id) {
  const diagram = await load(env, userId, id);
  const projects = await projectNames(env, userId);
  return { ...present(diagram, projects), mermaid: toMermaid(/** @type {any} */ (diagram)) };
}

/**
 * Checks and saves a diagram: boxes without a position are laid out, arrows to missing boxes are dropped.
 * @param {Record<string, any>} env @param {string} userId @param {Record<string, any>} next the whole row
 * @param {Record<string, any> | null} before the stored row, or null for a new diagram
 */
async function save(env, userId, next, before) {
  if (next.nodes.length > MAX_DIAGRAM_NODES) throw new HttpError(BAD_REQUEST, `A diagram holds at most ${MAX_DIAGRAM_NODES} nodes`);
  if (next.edges.length > MAX_DIAGRAM_EDGES) throw new HttpError(BAD_REQUEST, `A diagram holds at most ${MAX_DIAGRAM_EDGES} edges`);
  let fields;
  try {
    const nodes = layout(next.nodes, next.edges);
    fields = cleanRow('diagrams', { project_id: next.project_id, name: next.name, description: next.description, nodes, edges: next.edges });
  } catch (error) {
    throw new HttpError(BAD_REQUEST, /** @type {Error} */ (error).message);
  }
  fields.edges = liveEdges(fields.nodes, fields.edges);
  const row = { ...next, ...fields, user_id: userId, updated_at: Date.now() };
  const upsert = upsertStatement(env, 'diagrams', row, before);
  if (upsert) await upsert.run();
  const { user_id: _owner, ...diagram } = row;
  return { ...present(diagram, await projectNames(env, userId)), mermaid: toMermaid(/** @type {any} */ (diagram)) };
}

/**
 * Creates a diagram: { name, project?, description?, nodes?, edges? }. Boxes need only a title; positions are optional.
 * @param {Record<string, any>} env @param {string} userId @param {unknown} input
 */
export async function createDiagram(env, userId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(BAD_REQUEST, 'Send a JSON object: { name, project?, description?, nodes?, edges? }');
  const body = /** @type {Record<string, any>} */ (input);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(BAD_REQUEST, 'name is required');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM diagrams WHERE user_id = ? AND deleted_at IS NULL').bind(userId).first();
  if (Number(count?.n) >= MAX_DIAGRAMS) throw new HttpError(BAD_REQUEST, `You can have at most ${MAX_DIAGRAMS} diagrams; delete one first`);
  const project = await resolveProject(env, userId, body.project);
  const nodes = mergeNodes([], listOf(body, 'nodes') ?? []);
  const edges = mergeEdges(nodes, [], listOf(body, 'edges') ?? []);
  return save(env, userId, { ...newRow('diagrams'), project_id: project?.id ?? null, name, description: body.description ?? '', nodes, edges }, null);
}

/**
 * Updates a diagram: { name?, description?, project?, nodes? (replaces every box), add_nodes? (adds, or updates by
 * id), remove_nodes? (ids or titles), edges? (replaces every arrow), add_edges?, remove_edges? (ids) }.
 * @param {Record<string, any>} env @param {string} userId @param {string} id @param {unknown} input
 */
export async function updateDiagram(env, userId, id, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(BAD_REQUEST, 'Send a JSON object');
  const body = /** @type {Record<string, any>} */ (input);
  const before = await load(env, userId, id);
  const next = { ...before };
  if (body.name !== undefined) next.name = typeof body.name === 'string' ? body.name.trim() : body.name;
  if (body.description !== undefined) next.description = body.description;
  if (body.project !== undefined) next.project_id = (await resolveProject(env, userId, body.project))?.id ?? null;

  const replaced = listOf(body, 'nodes');
  // A replacement keeps the position of every box whose id it repeats without one.
  let nodes = replaced ? mergeNodes(before.nodes.filter((/** @type {any} */ node) => replaced.some((sent) => sent?.id === node.id)), replaced) : before.nodes;
  nodes = mergeNodes(nodes, listOf(body, 'add_nodes') ?? []);
  const gone = (listOf(body, 'remove_nodes') ?? []).map((ref) => String(ref).trim().toLowerCase());
  nodes = nodes.filter((/** @type {any} */ node) => !gone.includes(node.id.toLowerCase()) && !gone.includes(String(node.title ?? '').trim().toLowerCase()));

  let edges = mergeEdges(nodes, [], listOf(body, 'edges') ?? before.edges.filter((/** @type {any} */ edge) => nodes.some((/** @type {any} */ node) => node.id === edge.from) && nodes.some((/** @type {any} */ node) => node.id === edge.to)));
  edges = mergeEdges(nodes, edges, listOf(body, 'add_edges') ?? []);
  const cut = (listOf(body, 'remove_edges') ?? []).map(String);
  edges = edges.filter((edge) => !cut.includes(edge.id));
  return save(env, userId, { ...next, nodes, edges }, before);
}

/** Deletes a diagram on every device (a tombstone, like any synced row). @param {Record<string, any>} env @param {string} userId @param {string} id */
export async function deleteDiagram(env, userId, id) {
  const before = await load(env, userId, id);
  const now = Date.now();
  await env.DB.prepare('UPDATE diagrams SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?').bind(now, now, userId, before.id).run();
  return { id: before.id, deleted_at: now };
}
