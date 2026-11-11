// Design diagrams (the Design page), the parts with no DOM: grid snapping, where an arrow leaves and enters a box, automatic
// layout for boxes that come without a position (agents usually send none), and a Mermaid export.
// Shared by the canvas (src/components/DiagramCanvas.svelte) and the Worker (api/lib/diagrams.js).
import { DIAGRAM_GRID, NODE_SIZE, ZONE_SIZE } from './models.js';

// Automatic layout: columns left to right in the direction the arrows point, rows down each column.
const LAYOUT_GAP_X = 100;
const LAYOUT_GAP_Y = 40;
const LAYOUT_ORIGIN = 40;
// A zone drawn around boxes that were laid out automatically keeps this much room around them; the top is taller
// because the zone's name sits there.
const ZONE_PADDING = 40;
const ZONE_HEADER = 60;
// How far an arrow's curve pulls away from the side it leaves, as a share of the gap, within these bounds.
const CURVE_PULL = 0.5;
const MIN_CURVE = 30;
const MAX_CURVE = 160;
const MERMAID_SHAPES = { database: ['[(', ')]'], storage: ['[(', ')]'], queue: ['[[', ']]'], client: ['([', '])'], external: ['{{', '}}'], agent: ['((', '))'] };
const MERMAID_DEFAULT_SHAPE = ['[', ']'];

/** @typedef {{ id: string, kind: string, title: string, text: string, color: string, x: number, y: number, w: number, h: number }} DiagramNode */
/** @typedef {{ id: string, from: string, to: string, label: string, style: string }} DiagramEdge */
/** @typedef {{ x: number, y: number }} Point */

/** The nearest grid line. @param {number} value */
export const snap = (value) => Math.round(value / DIAGRAM_GRID) * DIAGRAM_GRID;

/** @param {DiagramNode} node @returns {Point} */
export const center = (node) => ({ x: node.x + node.w / 2, y: node.y + node.h / 2 });

/** True when a point is inside a box. @param {DiagramNode} node @param {Point} point */
export const contains = (node, point) => point.x >= node.x && point.x <= node.x + node.w && point.y >= node.y && point.y <= node.y + node.h;

/** Arrows whose two ends both still exist, each pair of boxes joined at most once per direction. @param {DiagramNode[]} nodes @param {DiagramEdge[]} edges */
export function liveEdges(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}>${edge.to}`;
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The curve of an arrow between two boxes: it leaves and enters by the sides facing each other (left and right when
 * the boxes sit side by side, top and bottom when stacked), so it never crosses its own boxes.
 * @param {DiagramNode} from @param {DiagramNode} to
 * @returns {{ path: string, middle: Point }} an SVG path and the point its label sits on
 */
export function edgeCurve(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Sideways when the gap between the boxes is wider than it is tall, measured edge to edge.
  const sideways = Math.abs(dx) - (from.w + to.w) / 2 >= Math.abs(dy) - (from.h + to.h) / 2;
  const sign = Math.sign(sideways ? dx : dy) || 1;
  const start = sideways ? { x: a.x + sign * from.w / 2, y: a.y } : { x: a.x, y: a.y + sign * from.h / 2 };
  const end = sideways ? { x: b.x - sign * to.w / 2, y: b.y } : { x: b.x, y: b.y - sign * to.h / 2 };
  const gap = Math.abs(sideways ? end.x - start.x : end.y - start.y);
  const pull = sign * Math.min(MAX_CURVE, Math.max(MIN_CURVE, gap * CURVE_PULL));
  const c1 = sideways ? { x: start.x + pull, y: start.y } : { x: start.x, y: start.y + pull };
  const c2 = sideways ? { x: end.x - pull, y: end.y } : { x: end.x, y: end.y - pull };
  return {
    path: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
    // The curve is symmetric, so its midpoint is halfway between its ends.
    middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

/** The box around a set of boxes, or null when there are none. @param {DiagramNode[]} nodes */
export function bounds(nodes) {
  if (!nodes.length) return null;
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  return { x: left, y: top, w: Math.max(...nodes.map((node) => node.x + node.w)) - left, h: Math.max(...nodes.map((node) => node.y + node.h)) - top };
}

/**
 * Places every box that has no position: columns follow the arrows left to right (a box sits one column after the
 * furthest box that points at it), rows stack down each column. Boxes that already have a position stay put, and new
 * ones start below them. A zone without a position wraps the boxes listed in `inside`, or everything placed here.
 * @param {(Partial<DiagramNode> & { id: string, inside?: string })[]} nodes `inside` names the zone a box belongs in
 * @param {{ from: string, to: string }[]} edges
 * @returns {DiagramNode[]}
 */
export function layout(nodes, edges) {
  const placed = (/** @type {any} */ node) => Number.isFinite(node.x) && Number.isFinite(node.y);
  const sized = nodes.map((node) => {
    const size = node.kind === 'zone' ? ZONE_SIZE : NODE_SIZE;
    return { ...node, w: node.w || size.w, h: node.h || size.h };
  });
  const loose = sized.filter((node) => !placed(node) && node.kind !== 'zone');
  const looseIds = new Set(loose.map((node) => node.id));
  // Column of each box: longest chain of arrows leading to it. Capped at the box count, so a cycle can't loop forever.
  /** @type {Map<string, number>} */
  const column = new Map(loose.map((node) => [node.id, 0]));
  const links = edges.filter((edge) => looseIds.has(edge.from) && looseIds.has(edge.to) && edge.from !== edge.to);
  for (let pass = 0; pass < loose.length; pass++) {
    let moved = false;
    for (const { from, to } of links) {
      const next = /** @type {number} */ (column.get(from)) + 1;
      if (next > /** @type {number} */ (column.get(to)) && next < loose.length) {
        column.set(to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const fixed = bounds(/** @type {DiagramNode[]} */ (sized.filter(placed)));
  const top = fixed ? snap(fixed.y + fixed.h + ZONE_HEADER) : LAYOUT_ORIGIN;
  const columns = [...new Set(column.values())].sort((a, b) => a - b);
  let x = fixed ? snap(fixed.x) : LAYOUT_ORIGIN;
  for (const index of columns) {
    const members = loose.filter((node) => column.get(node.id) === index);
    let y = top;
    for (const node of members) {
      Object.assign(node, { x: snap(x), y: snap(y) });
      y += node.h + LAYOUT_GAP_Y;
    }
    x += Math.max(...members.map((node) => node.w)) + LAYOUT_GAP_X;
  }
  const zones = sized.filter((node) => node.kind === 'zone' && !placed(node));
  // A lone zone nobody was put in wraps everything placed here. With several zones that would stack them all around
  // the same boxes, so a memberless zone then keeps its default size, set down beside the others.
  let emptyX = LAYOUT_ORIGIN;
  for (const zone of zones) {
    const members = sized.filter((node) => node.kind !== 'zone' && placed(node) && (node.inside === zone.id || (zones.length === 1 && !sized.some((other) => other.inside === zone.id) && looseIds.has(node.id))));
    const box = bounds(/** @type {DiagramNode[]} */ (members));
    if (box) Object.assign(zone, { x: snap(box.x - ZONE_PADDING), y: snap(box.y - ZONE_HEADER), w: snap(box.w + ZONE_PADDING * 2), h: snap(box.h + ZONE_HEADER + ZONE_PADDING) });
    else {
      Object.assign(zone, { x: snap(emptyX), y: top });
      emptyX += zone.w + LAYOUT_GAP_X;
    }
  }
  return /** @type {DiagramNode[]} */ (sized.map(({ inside: _inside, ...node }) => node));
}

/** Text safe inside a Mermaid label. @param {string} text */
const mermaidText = (text) => `"${String(text).replace(/"/g, '#quot;').replace(/\s+/g, ' ').trim() || ' '}"`;

/**
 * The diagram as Mermaid flowchart source, for READMEs and agents. Zones become subgraphs holding the boxes whose
 * centers they cover.
 * @param {{ name?: string, nodes: DiagramNode[], edges: DiagramEdge[] }} diagram
 */
export function toMermaid(diagram) {
  const ids = new Map(diagram.nodes.map((node, index) => [node.id, `n${index}`]));
  const boxes = diagram.nodes.filter((node) => node.kind !== 'zone');
  const zones = diagram.nodes.filter((node) => node.kind === 'zone');
  const line = (/** @type {DiagramNode} */ node) => {
    const [open, close] = MERMAID_SHAPES[/** @type {keyof typeof MERMAID_SHAPES} */ (node.kind)] ?? MERMAID_DEFAULT_SHAPE;
    return `${ids.get(node.id)}${open}${mermaidText(node.title || node.kind)}${close}`;
  };
  const homed = new Set();
  const lines = ['flowchart LR'];
  for (const zone of zones) {
    lines.push(`  subgraph ${ids.get(zone.id)}[${mermaidText(zone.title || 'Zone')}]`);
    for (const node of boxes.filter((box) => !homed.has(box.id) && contains(zone, center(box)))) {
      homed.add(node.id);
      lines.push(`    ${line(node)}`);
    }
    lines.push('  end');
  }
  for (const node of boxes.filter((box) => !homed.has(box.id))) lines.push(`  ${line(node)}`);
  for (const edge of liveEdges(diagram.nodes, diagram.edges)) {
    const arrow = edge.style === 'dashed' ? '-.->' : '-->';
    lines.push(`  ${ids.get(edge.from)} ${arrow}${edge.label ? `|${mermaidText(edge.label)}|` : ''} ${ids.get(edge.to)}`);
  }
  return lines.join('\n');
}
