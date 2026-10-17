// Matrix view: urgency (x) vs importance (y) scatter of visible tasks.
//
// renderMatrix(panel, handle, ctx)
//   panel   the right-hand container element
//   handle  the table handle from renderTable: rows [{ item, el, kind }]
//   ctx     { rerender() }
//
// Classic Eisenhower orientation: urgency runs 10 on the left to 0 on the
// right, importance 0 at the bottom to 10 at the top, so the urgent-and-
// important quadrant is top-left. The plot fills the panel's width and the
// remaining viewport height, so the plot area is generally not square; each
// axis uses its own pixel extent and is redrawn on panel or window resize.
//
// Only rows of kind 'task' are plotted (parents have no urgency/importance).
// Tasks sharing the same (urgency, importance) are spread evenly around the
// grid point, ordered by id, so the layout is deterministic and every point
// stays visibly attached to its integer value.
//
// Hovering a point shows a tooltip (title + rendered markdown description) and
// toggles .matrix-hover on the matching table row; hovering a table row
// highlights its point in return.

import { state, isClosed, STATUS_LABEL } from './state.js';
import { renderMarkdown } from './markdown.js';
import { el } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX = 10;
const MARGIN = { top: 14, right: 18, bottom: 46, left: 52 };
const POINT_R = 5;
const HIT_R = 13;
const MIN_PLOT = 320;      // minimum plot-area width and height (px)
const BOTTOM_GAP = 16;     // viewport margin kept below the plot (px)

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const level = (n) => (n == null ? 5 : Math.max(0, Math.min(MAX, Number(n))));

/** Jitter radius (px) so that n points spread evenly on a circle do not touch. */
function jitterRadius(n, cell) {
  if (n <= 1) return 0;
  const gap = POINT_R * 2 + 3; // diameter plus the surface ring
  const r = gap / (2 * Math.sin(Math.PI / n));
  // Keep the cluster inside ~40% of a cell so it still reads as the integer value.
  return Math.max(POINT_R + 4, Math.min(r, cell * 0.4));
}

/** Pixel scales for the plot area; half a cell of inner padding on each axis
 *  keeps points at 0 and 10 clear of the frame. The x axis is reversed
 *  (urgency 10 at the left). `cell` is the smaller of the two cell sizes and
 *  is what jitter is based on, so clusters stay inside a cell on both axes. */
function scales(plotW, plotH) {
  const cellX = plotW / (MAX + 1);
  const cellY = plotH / (MAX + 1);
  const padX = cellX / 2;
  const padY = cellY / 2;
  return {
    cell: Math.min(cellX, cellY),
    sx: (u) => MARGIN.left + padX + ((MAX - u) / MAX) * (plotW - 2 * padX),
    sy: (i) => MARGIN.top + padY + ((MAX - i) / MAX) * (plotH - 2 * padY),
  };
}

/** Lay out points: returns [{ item, row, x, y, angle }] in pixel coordinates. */
function layout(rows, plotW, plotH) {
  const { cell, sx, sy } = scales(plotW, plotH);
  const groups = new Map();
  for (const row of rows) {
    const k = `${level(row.item.urgency)},${level(row.item.importance)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.item.id - b.item.id);
    const n = group.length;
    const jr = jitterRadius(n, cell);
    // Deterministic start angle derived from the first id, so clusters at
    // different grid points do not all line up the same way.
    const start = -Math.PI / 2 + ((group[0].item.id * 0.61803) % 1) * ((2 * Math.PI) / Math.max(n, 1));
    group.forEach((row, k) => {
      const angle = n > 1 ? start + (k * 2 * Math.PI) / n : 0;
      const dx = n > 1 ? Math.cos(angle) * jr : 0;
      const dy = n > 1 ? Math.sin(angle) * jr : 0;
      out.push({
        item: row.item, row,
        x: sx(level(row.item.urgency)) + dx,
        y: sy(level(row.item.importance)) + dy,
        angle: n > 1 ? angle : 0,
      });
    });
  }
  return out;
}

function pointClass(item) {
  const cls = ['pt'];
  if (isClosed(item.status)) cls.push('closed');
  if (item.blocked) cls.push('blocked');
  return cls.join(' ');
}

function pointColor(item) {
  if (isClosed(item.status)) return null; // no highlighting on closed items
  const u = item.assignee_id != null ? state.usersById.get(item.assignee_id) : null;
  if (u) return u.color;
  return state.settings?.color_unassigned || null; // grey for no assignee (a setting)
}

function assigneeName(item) {
  if (item.assignee_id == null) return null;
  return state.usersById.get(item.assignee_id)?.name ?? `#${item.assignee_id}`;
}

// ---------------------------------------------------------------- tooltip

function createTooltip(panel) {
  const tip = el('div', { class: 'matrix-tip', role: 'tooltip', hidden: true });
  panel.append(tip);
  let hideTimer = null;
  let current = null;

  function fill(item) {
    const header = el('div', { class: 'tip-head' },
      el('span', { class: 'tip-key' }, item.key),
      el('span', { class: 'tip-title' }, item.title));
    const meta = el('div', { class: 'tip-meta' },
      el('span', {}, el('b', {}, String(level(item.urgency))), ' urgency'),
      el('span', {}, el('b', {}, String(level(item.importance))), ' importance'),
      el('span', {}, STATUS_LABEL[item.status] || item.status));
    const who = assigneeName(item);
    if (who) meta.append(el('span', {}, who));
    if (item.blocked) meta.append(el('span', { class: 'tip-blocked' }, 'Blocked'));
    tip.replaceChildren(header, meta);
    if (item.description && item.description.trim()) {
      const md = el('div', { class: 'md tip-desc' });
      md.innerHTML = renderMarkdown(item.description);
      tip.append(md);
    }
  }

  function place(anchor) {
    const pad = 8;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.maxHeight = `${Math.max(120, vh - 2 * pad)}px`;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.right + 10;
    if (left + tw > vw - pad) left = r.left - 10 - tw; // flip to the left
    if (left < pad) left = Math.max(pad, Math.min(vw - pad - tw, r.left));
    let top = r.top + r.height / 2 - th / 2;
    top = Math.max(pad, Math.min(vh - pad - th, top));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  return {
    show(item, anchor) {
      clearTimeout(hideTimer);
      hideTimer = null;
      if (current !== item) { fill(item); current = item; }
      tip.hidden = false;
      place(anchor);
    },
    // Deferred so that moving across the gap between two nearby points does
    // not blink the tooltip off and on.
    hide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { tip.hidden = true; current = null; }, 120);
    },
    el: tip,
  };
}

// ---------------------------------------------------------------- plot

function drawPlot(root, rows, width, height) {
  const plotW = Math.max(MIN_PLOT, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(MIN_PLOT, height - MARGIN.top - MARGIN.bottom);
  const W = plotW + MARGIN.left + MARGIN.right;
  const H = plotH + MARGIN.top + MARGIN.bottom;
  const { sx, sy } = scales(plotW, plotH);
  // Frame edges: x0/x1 are left/right, y0/y1 bottom/top (SVG y grows downward).
  const x0 = MARGIN.left, x1 = MARGIN.left + plotW, y0 = MARGIN.top + plotH, y1 = MARGIN.top;
  const halfW = plotW / 2, halfH = plotH / 2;

  const node = svg('svg', { class: 'matrix-plot', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Urgency versus importance matrix' });

  // Quadrants: the top-left (urgent and important) gets a faint red wash and
  // the bottom-right (neither) a grey one; the other two are told apart by
  // the urgency == importance diagonal (top-left to bottom-right) and the
  // emphasised midlines.
  const mid = MAX / 2;
  node.append(svg('rect', { class: 'plot-bg', x: x0, y: y1, width: plotW, height: plotH }));
  node.append(svg('rect', { class: 'quad quad-hot', x: x0, y: y1, width: halfW, height: halfH }));
  node.append(svg('rect', { class: 'quad quad-cold', x: sx(mid), y: sy(mid), width: halfW, height: halfH }));
  node.append(svg('line', { class: 'diagonal', x1: x0, y1: y1, x2: x1, y2: y0 }));

  const grid = svg('g', { class: 'grid' });
  const ticks = svg('g', { class: 'ticks' });
  for (let v = 0; v <= MAX; v++) {
    const major = v === mid || v === 0 || v === MAX;
    grid.append(svg('line', { class: major ? 'major' : '', x1: sx(v), y1: y0, x2: sx(v), y2: y1 }));
    grid.append(svg('line', { class: major ? 'major' : '', x1: x0, y1: sy(v), x2: x1, y2: sy(v) }));
    ticks.append(svg('text', { x: sx(v), y: y0 + 16, 'text-anchor': 'middle' }, v));
    ticks.append(svg('text', { x: x0 - 8, y: sy(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, v));
  }
  node.append(grid, ticks);

  node.append(
    svg('text', { class: 'axis-label', x: sx(mid), y: H - 8, 'text-anchor': 'middle' }, 'Urgency'),
    svg('text', { class: 'axis-label', x: 14, y: sy(mid), 'text-anchor': 'middle', transform: `rotate(-90 14 ${sy(mid)})` }, 'Importance'),
    svg('text', { class: 'quad-label', x: x0 + 6, y: y1 + 14, 'text-anchor': 'start' }, 'urgent & important'),
  );

  const points = svg('g', { class: 'points' });
  const pts = layout(rows, plotW, plotH);
  // Draw closed/blocked first so live points sit on top of muted ones.
  pts.sort((a, b) => Number(isClosed(a.item.status) || a.item.blocked) - Number(isClosed(b.item.status) || b.item.blocked));
  for (const p of pts) {
    const color = pointColor(p.item);
    const g = svg('g', {
      class: pointClass(p.item),
      dataset: { id: p.item.id, key: p.item.key },
      style: color ? `--pt: ${color}` : null,
    });
    // Label sits on the outward side of the jitter so clustered keys fan
    // out. Near the right edge (low urgency) it flips to the left of the
    // point; near the left edge (high urgency) it is forced to the right.
    const vertical = p.angle !== 0 && Math.abs(Math.cos(p.angle)) <= 0.2;
    const nearRight = p.x + POINT_R + 40 > x1;
    const nearLeft = p.x - POINT_R - 40 < x0;
    const left = nearRight || (Math.cos(p.angle) < -0.2 && !nearLeft);
    const lx = vertical ? p.x : p.x + (left ? -(POINT_R + 4) : POINT_R + 4);
    const ly = vertical ? p.y + (Math.sin(p.angle) < 0 ? -(POINT_R + 5) : POINT_R + 5) : p.y;
    g.append(
      svg('circle', { class: 'hit', cx: p.x, cy: p.y, r: HIT_R }),
      p.item.blocked ? svg('circle', { class: 'ring', cx: p.x, cy: p.y, r: POINT_R + 3.5 }) : null,
      svg('circle', { class: 'dot', cx: p.x, cy: p.y, r: POINT_R }),
      svg('text', {
        class: 'label', x: lx, y: ly,
        'text-anchor': vertical ? 'middle' : (left ? 'end' : 'start'),
        'dominant-baseline': vertical ? (Math.sin(p.angle) < 0 ? 'auto' : 'hanging') : 'middle',
      }, p.item.key),
    );
    points.append(g);
    p.g = g;
  }
  node.append(points);
  root.replaceChildren(node);
  return pts;
}

// ---------------------------------------------------------------- entry

export function renderMatrix(panel, handle, ctx) {
  // Tear down the observer and window listener left by a previous render.
  if (panel._matrixObserver) { panel._matrixObserver.disconnect(); panel._matrixObserver = null; }
  if (panel._matrixResize) { window.removeEventListener('resize', panel._matrixResize); panel._matrixResize = null; }
  for (const r of handle.rows) r.el.classList.remove('matrix-hover');

  const rows = handle.rows.filter((r) => r.kind === 'task' && r.item.type === 'task');
  const wrap = el('div', { class: 'matrix' });
  panel.replaceChildren(wrap);

  const plotRoot = el('div', { class: 'matrix-plot-wrap' });
  wrap.append(plotRoot);
  const tip = createTooltip(panel);

  let drawnW = -1, drawnH = -1;
  let pts = [];
  const byId = new Map();

  /** Height available to the SVG: from the panel's top edge (in document
   *  coordinates, so scrolling does not change it) to the viewport bottom. */
  function availableHeight() {
    const top = panel.getBoundingClientRect().top + window.scrollY;
    return Math.round(window.innerHeight - top - BOTTOM_GAP);
  }

  function draw() {
    const width = panel.clientWidth || 600;
    const height = availableHeight();
    if (width === drawnW && height === drawnH) return;
    drawnW = width;
    drawnH = height;
    pts = drawPlot(plotRoot, rows, width, height);
    byId.clear();
    for (const p of pts) {
      byId.set(p.item.id, p);
      p.g.addEventListener('pointerenter', () => {
        p.g.classList.add('hover');
        p.row.el.classList.add('matrix-hover');
        tip.show(p.item, p.g.querySelector('.dot'));
      });
      p.g.addEventListener('pointerleave', () => {
        p.g.classList.remove('hover');
        p.row.el.classList.remove('matrix-hover');
        tip.hide();
      });
      p.g.addEventListener('click', () => {
        p.row.el.scrollIntoView({ block: 'nearest' });
      });
    }
  }
  draw();

  // Table row hover highlights the point in return.
  for (const r of rows) {
    r.el.addEventListener('pointerenter', () => byId.get(r.item.id)?.g.classList.add('hover'));
    r.el.addEventListener('pointerleave', () => byId.get(r.item.id)?.g.classList.remove('hover'));
  }

  // Panel width changes come through the ResizeObserver; a viewport height
  // change alone does not resize the panel, so it needs the window listener.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => draw());
    ro.observe(panel);
    panel._matrixObserver = ro;
  }
  const onResize = () => draw();
  window.addEventListener('resize', onResize);
  panel._matrixResize = onResize;
}
