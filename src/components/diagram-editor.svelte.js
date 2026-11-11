// State and gestures of the design canvas (DiagramCanvas.svelte): the view (pan, zoom), what is selected, and
// the one gesture in flight (panning, moving boxes, resizing one, pulling an arrow, pinching). Boxes being dragged
// live in a draft and reach the store once, when the gesture ends, so a drag is one sync write and one undo step.
import { store } from '../lib/store.svelte.js';
import { bounds, center, contains, liveEdges, snap } from '../lib/diagram.js';
import { DIAGRAM_GRID, EDGE_STYLES, MAX_DIAGRAM_EDGES, MAX_DIAGRAM_EXTENT, MAX_DIAGRAM_NODES, MAX_NODE_SIZE, MIN_NODE_SIZE, NODE_SIZE, ZONE_SIZE } from '../lib/models.js';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;
// Wheel zoom: how much one pixel of wheel travel scales the view.
const WHEEL_ZOOM = 0.0015;
const FIT_PADDING = 48;
const MAX_UNDO = 50;
// A pointer that travels less than this is a tap, not a drag.
const TAP_SLOP = 4;
// A new box that would land exactly on another steps aside by this much.
const STAGGER = DIAGRAM_GRID * 2;
const KEY_NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** @typedef {import('../lib/diagram.js').DiagramNode} DiagramNode */
/** @typedef {import('../lib/diagram.js').DiagramEdge} DiagramEdge */
/** @typedef {import('../lib/diagram.js').Point} Point */

/** @param {any} value */
const plain = (value) => JSON.parse(JSON.stringify(value));
/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class DiagramEditor {
  /** The diagram's id. */ id = '';
  pan = $state({ x: 0, y: 0 });
  zoom = $state(1);
  /** Ids of the selected boxes. @type {string[]} */ selected = $state([]);
  /** Id of the selected arrow ('' = none). */ selectedEdge = $state('');
  /** Boxes as they are mid-drag; null when nothing is being dragged. @type {DiagramNode[] | null} */ draft = $state(null);
  /** An arrow being pulled from a box to the pointer. @type {{ from: string, to: Point } | null} */ link = $state(null);
  /** Tap-to-connect: on while the Connect tool is armed; connectFrom is the first box tapped. */ connecting = $state(false);
  connectFrom = $state('');
  canUndo = $state(false);
  /** Why the last action did nothing ('limit', or 'taken': the arrow already exists), for the status line. */ notice = $state('');

  /** @type {{ nodes: DiagramNode[], edges: DiagramEdge[] }[]} */ #undo = [];
  /** What the last commit edited ("<id>:<field>" while typing in one field), so a run of keystrokes is one undo step. */ #merge = '';
  /** The drawing as this editor last left it. If it is something else now, an agent or another device changed it. */ #left = '';
  /** @type {any} the gesture in flight */ #gesture = null;
  /** Pointers on the canvas, for pinch. @type {Map<number, Point>} */ #pointers = new Map();
  /** The canvas viewport element, set by the canvas. @type {HTMLElement | null} */ element = null;

  /** @param {string} id */
  constructor(id) {
    this.id = id;
  }

  /** Where the viewport is on screen right now, measured on demand so it is never stale after a resize or scroll. */
  get viewport() {
    return this.element?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
  }

  get diagram() {
    return store.find('diagrams', this.id);
  }

  /** @returns {DiagramNode[]} */
  get nodes() {
    return this.draft ?? this.diagram?.nodes ?? [];
  }

  /** Arrows whose boxes exist. @returns {DiagramEdge[]} */
  get edges() {
    return liveEdges(this.nodes, this.diagram?.edges ?? []);
  }

  /** @param {string} id */
  node(id) {
    return this.nodes.find((node) => node.id === id);
  }

  /** Screen point -> canvas point. @param {{ clientX: number, clientY: number }} event @returns {Point} */
  toWorld(event) {
    const box = this.viewport;
    return { x: (event.clientX - box.left - this.pan.x) / this.zoom, y: (event.clientY - box.top - this.pan.y) / this.zoom };
  }

  /**
   * Saves boxes and arrows as one undo step. Commits that share a merge key and follow each other (typing in a field)
   * fold into one step.
   * @param {DiagramNode[]} nodes @param {DiagramEdge[]} [edges] @param {string} [merge]
   */
  commit(nodes, edges = this.diagram?.edges ?? [], merge = '') {
    const current = this.diagram;
    if (!current) return;
    this.#forgetIfChangedElsewhere();
    if (!merge || merge !== this.#merge) this.#undo.push(plain({ nodes: current.nodes, edges: current.edges }));
    this.#merge = merge;
    if (this.#undo.length > MAX_UNDO) this.#undo.shift();
    this.canUndo = true;
    const saved = store.update('diagrams', this.id, { nodes: plain(nodes), edges: liveEdges(nodes, plain(edges)) });
    this.#left = JSON.stringify([saved?.nodes, saved?.edges]);
  }

  /**
   * Undo steps are whole earlier drawings. Once someone else's boxes have arrived, going back to one would delete
   * them, so the steps taken before that are dropped.
   */
  #forgetIfChangedElsewhere() {
    const current = this.diagram;
    if (!this.#undo.length || !current || JSON.stringify([current.nodes, current.edges]) === this.#left) return;
    this.#undo = [];
    this.#merge = '';
    this.canUndo = false;
  }

  undo() {
    this.#forgetIfChangedElsewhere();
    const last = this.#undo.pop();
    this.#merge = '';
    this.canUndo = this.#undo.length > 0;
    if (!last) return;
    const saved = store.update('diagrams', this.id, last);
    this.#left = JSON.stringify([saved?.nodes, saved?.edges]);
    this.selected = this.selected.filter((id) => last.nodes.some((node) => node.id === id));
    this.selectedEdge = '';
  }

  /** @param {string[]} ids */
  select(ids) {
    this.selected = ids;
    this.selectedEdge = '';
  }

  /** @param {string} id */
  selectEdge(id) {
    this.selected = [];
    this.selectedEdge = id;
  }

  /**
   * Adds a box of a kind, centered on a canvas point (the middle of the view when none is given), and selects it.
   * @param {string} kind @param {Point} [at]
   */
  addNode(kind, at) {
    if (this.nodes.length >= MAX_DIAGRAM_NODES) {
      this.notice = 'limit';
      return;
    }
    const size = kind === 'zone' ? ZONE_SIZE : NODE_SIZE;
    const { width, height } = this.viewport;
    const point = at ?? { x: (width / 2 - this.pan.x) / this.zoom, y: (height / 2 - this.pan.y) / this.zoom };
    let x = snap(point.x - size.w / 2);
    let y = snap(point.y - size.h / 2);
    while (this.nodes.some((node) => node.x === x && node.y === y)) {
      x += STAGGER;
      y += STAGGER;
    }
    const node = { id: crypto.randomUUID(), kind, title: '', text: '', color: 'default', x, y, ...size };
    this.commit([...this.nodes, node]);
    this.select([node.id]);
    return node;
  }

  /** Changes fields of one box. @param {string} id @param {Partial<DiagramNode>} patch @param {string} [field] set while typing, to fold the keystrokes into one undo step */
  patchNode(id, patch, field = '') {
    this.commit(this.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)), undefined, field && `${id}:${field}`);
  }

  /** Changes fields of one arrow. @param {string} id @param {Partial<DiagramEdge>} patch @param {string} [field] */
  patchEdge(id, patch, field = '') {
    this.commit(this.nodes, (this.diagram?.edges ?? []).map((/** @type {DiagramEdge} */ edge) => (edge.id === id ? { ...edge, ...patch } : edge)), field && `${id}:${field}`);
  }

  /** Turns an arrow round, unless its boxes already have one that way (the status line says so). @param {string} id */
  reverseEdge(id) {
    const edges = this.diagram?.edges ?? [];
    const edge = edges.find((/** @type {DiagramEdge} */ candidate) => candidate.id === id);
    if (!edge) return;
    if (edges.some((/** @type {DiagramEdge} */ other) => other.from === edge.to && other.to === edge.from)) {
      this.notice = 'taken';
      return;
    }
    this.patchEdge(id, { from: edge.to, to: edge.from });
  }

  /** Joins two boxes with an arrow (once per direction) and selects it. @param {string} from @param {string} to */
  connect(from, to) {
    const edges = this.diagram?.edges ?? [];
    if (from === to || !this.node(from) || !this.node(to)) return;
    const existing = edges.find((/** @type {DiagramEdge} */ edge) => edge.from === from && edge.to === to);
    if (existing) return this.selectEdge(existing.id);
    if (edges.length >= MAX_DIAGRAM_EDGES) {
      this.notice = 'limit';
      return;
    }
    const edge = { id: crypto.randomUUID(), from, to, label: '', style: EDGE_STYLES[0] };
    this.commit(this.nodes, [...edges, edge]);
    this.selectEdge(edge.id);
  }

  /** Deletes the selected boxes (and their arrows) or the selected arrow. */
  removeSelection() {
    const edges = this.diagram?.edges ?? [];
    if (this.selectedEdge) this.commit(this.nodes, edges.filter((/** @type {DiagramEdge} */ edge) => edge.id !== this.selectedEdge));
    else if (this.selected.length) this.commit(this.nodes.filter((node) => !this.selected.includes(node.id)));
    this.selected = [];
    this.selectedEdge = '';
  }

  /** A copy of each selected box, one step down and right, selected in their place. */
  duplicateSelection() {
    const picked = this.nodes.filter((node) => this.selected.includes(node.id));
    if (!picked.length) return;
    if (this.nodes.length + picked.length > MAX_DIAGRAM_NODES) {
      this.notice = 'limit';
      return;
    }
    const copies = picked.map((node) => ({ ...plain(node), id: crypto.randomUUID(), x: node.x + STAGGER, y: node.y + STAGGER }));
    this.commit([...this.nodes, ...copies]);
    this.select(copies.map((node) => node.id));
  }

  /** Scales the view around a point inside the viewport (its middle when none is given). @param {number} next @param {Point} [around] viewport pixels */
  zoomTo(next, around) {
    const box = this.viewport;
    around ??= { x: box.width / 2, y: box.height / 2 };
    const zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const ratio = zoom / this.zoom;
    this.pan = { x: around.x - (around.x - this.pan.x) * ratio, y: around.y - (around.y - this.pan.y) * ratio };
    this.zoom = zoom;
  }

  zoomIn() {
    this.zoomTo(this.zoom * ZOOM_STEP);
  }

  zoomOut() {
    this.zoomTo(this.zoom / ZOOM_STEP);
  }

  /** Shows every box, as large as fits (never past 100%). */
  fit() {
    const box = bounds(this.nodes);
    const { width, height } = this.viewport;
    if (!box || !width || !height) {
      this.zoom = 1;
      this.pan = { x: width / 2, y: height / 2 };
      return;
    }
    this.zoom = clamp(Math.min((width - FIT_PADDING * 2) / box.w, (height - FIT_PADDING * 2) / box.h, 1), MIN_ZOOM, MAX_ZOOM);
    this.pan = { x: width / 2 - (box.x + box.w / 2) * this.zoom, y: height / 2 - (box.y + box.h / 2) * this.zoom };
  }

  /** Wheel: zoom around the pointer. @param {WheelEvent} event */
  wheel(event) {
    event.preventDefault();
    const box = this.viewport;
    this.zoomTo(this.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM), { x: event.clientX - box.left, y: event.clientY - box.top });
  }

  /**
   * A pointer went down on the canvas. `target` says what is under it.
   * @param {PointerEvent} event
   * @param {{ node?: string, edge?: string, handle?: 'link' | 'resize' }} target
   */
  down(event, target) {
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.#pointers.size === 2) return this.#startPinch();
    const at = this.toWorld(event);
    const start = { x: event.clientX, y: event.clientY };
    if (target.edge) {
      this.selectEdge(target.edge);
      this.#gesture = null;
      return;
    }
    if (!target.node) {
      this.#gesture = { type: 'pan', start, pan: { ...this.pan }, moved: false };
      return;
    }
    if (this.connecting && !target.handle) {
      this.#gesture = { type: 'tap', node: target.node };
      return;
    }
    if (target.handle === 'link') {
      this.link = { from: target.node, to: at };
      this.#gesture = { type: 'link' };
      return;
    }
    // Shift or Ctrl adds to (or takes from) the selection; a plain press on an unselected box selects only it.
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) this.select(this.selected.includes(target.node) ? this.selected.filter((id) => id !== target.node) : [...this.selected, target.node]);
    else if (!this.selected.includes(target.node)) this.select([target.node]);
    else this.selectedEdge = '';
    if (target.handle === 'resize') {
      const node = /** @type {DiagramNode} */ (this.node(target.node));
      this.#gesture = { type: 'resize', id: node.id, at, size: { w: node.w, h: node.h }, moved: false };
      return;
    }
    // Moving a zone carries the boxes sitting inside it.
    const moving = new Set(this.selected);
    for (const zone of this.nodes.filter((node) => node.kind === 'zone' && moving.has(node.id))) {
      for (const node of this.nodes) if (node.kind !== 'zone' && contains(zone, center(node))) moving.add(node.id);
    }
    this.#gesture = { type: 'move', at, origin: new Map(this.nodes.filter((node) => moving.has(node.id)).map((node) => [node.id, { x: node.x, y: node.y }])), moved: false, start };
  }

  /** @param {PointerEvent} event */
  move(event) {
    if (this.#pointers.has(event.pointerId)) this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = this.#gesture;
    if (!gesture) return;
    if (gesture.type === 'pinch') return this.#pinch();
    const at = this.toWorld(event);
    if (gesture.type === 'pan') {
      const dx = event.clientX - gesture.start.x;
      const dy = event.clientY - gesture.start.y;
      if (Math.hypot(dx, dy) > TAP_SLOP) gesture.moved = true;
      this.pan = { x: gesture.pan.x + dx, y: gesture.pan.y + dy };
      return;
    }
    if (gesture.type === 'link' && this.link) {
      this.link = { from: this.link.from, to: at };
      return;
    }
    if (gesture.type === 'move') {
      if (!gesture.moved && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) <= TAP_SLOP) return;
      gesture.moved = true;
      const dx = snap(at.x - gesture.at.x);
      const dy = snap(at.y - gesture.at.y);
      this.draft = this.nodes.map((node) => {
        const origin = gesture.origin.get(node.id);
        return origin ? { ...node, x: clamp(origin.x + dx, -MAX_DIAGRAM_EXTENT, MAX_DIAGRAM_EXTENT), y: clamp(origin.y + dy, -MAX_DIAGRAM_EXTENT, MAX_DIAGRAM_EXTENT) } : node;
      });
      return;
    }
    if (gesture.type === 'resize') {
      gesture.moved = true;
      const w = clamp(snap(gesture.size.w + at.x - gesture.at.x), MIN_NODE_SIZE, MAX_NODE_SIZE);
      const h = clamp(snap(gesture.size.h + at.y - gesture.at.y), MIN_NODE_SIZE, MAX_NODE_SIZE);
      this.draft = this.nodes.map((node) => (node.id === gesture.id ? { ...node, w, h } : node));
    }
  }

  /**
   * A pointer came up. `over` is the box under it, for finishing an arrow.
   * @param {PointerEvent} event @param {string} [over]
   */
  up(event, over) {
    this.#pointers.delete(event.pointerId);
    const gesture = this.#gesture;
    this.#gesture = null;
    if (!gesture) return;
    if (gesture.type === 'pan' && !gesture.moved) {
      this.select([]);
      this.connectFrom = '';
    }
    if (gesture.type === 'tap') {
      if (!this.connectFrom) this.connectFrom = gesture.node;
      else {
        this.connect(this.connectFrom, gesture.node);
        this.connectFrom = '';
        this.connecting = false;
      }
    }
    if (gesture.type === 'link') {
      const from = this.link?.from;
      this.link = null;
      if (from && over) this.connect(from, over);
    }
    if ((gesture.type === 'move' || gesture.type === 'resize') && gesture.moved && this.draft) {
      const nodes = this.draft;
      this.draft = null;
      this.commit(nodes);
    }
    this.draft = null;
  }

  /** A pointer was taken away mid-gesture (a call, a system swipe): drop the gesture without saving. @param {PointerEvent} event */
  cancel(event) {
    this.#pointers.delete(event.pointerId);
    this.#gesture = null;
    this.draft = null;
    this.link = null;
  }

  #startPinch() {
    const [a, b] = [...this.#pointers.values()];
    this.draft = null;
    this.link = null;
    this.#gesture = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom };
  }

  #pinch() {
    const [a, b] = [...this.#pointers.values()];
    if (!a || !b) return;
    const box = this.viewport;
    const middle = { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top };
    this.zoomTo(this.#gesture.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / this.#gesture.distance), middle);
  }

  /** Arms or disarms tap-to-connect, starting from the selected box when there is exactly one. */
  toggleConnect() {
    this.connecting = !this.connecting;
    this.connectFrom = this.connecting && this.selected.length === 1 ? this.selected[0] : '';
  }

  /**
   * Keyboard on the canvas: Delete removes, arrows nudge by one grid step, Escape lets go, Ctrl/Cmd+Z undoes,
   * Ctrl/Cmd+D duplicates. Returns true when the key was used.
   * @param {KeyboardEvent} event
   */
  key(event) {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') return this.undo(), true;
    if (command && event.key.toLowerCase() === 'd' && this.selected.length) return this.duplicateSelection(), true;
    if (event.key === 'Escape') {
      this.select([]);
      this.connecting = false;
      this.connectFrom = '';
      return true;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && (this.selected.length || this.selectedEdge)) return this.removeSelection(), true;
    const step = KEY_NUDGE[/** @type {keyof typeof KEY_NUDGE} */ (event.key)];
    if (!step || !this.selected.length) return false;
    this.commit(this.nodes.map((node) => (this.selected.includes(node.id) ? { ...node, x: node.x + step[0] * DIAGRAM_GRID, y: node.y + step[1] * DIAGRAM_GRID } : node)));
    return true;
  }
}
