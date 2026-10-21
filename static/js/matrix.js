// Matrix view: urgency (x) vs importance (y) scatter of visible tasks.
//
// renderMatrix(panel, handle, ctx)
//   panel   the right-hand container element
//   handle  the table handle from renderTable: rows [{ item, el, kind }]
//   ctx     { rerender(), onChanged(), pointColor, setPointColor(mode),
//             labelMode, setLabelMode(mode) }
//           pointColor is the point colouring mode (a preference: assignee,
//           owner or the task's Ongoing/Project, see colors.js) picked with
//           the dropdown above the plot; setPointColor persists a new one.
//           labelMode ('key' | 'title', a preference) picks what each point
//           is labelled with, via the Keys | Titles toggle beside it.
//
// Classic Eisenhower orientation: urgency runs 10 on the left to 0 on the
// right, importance 0 at the bottom to 10 at the top, so the urgent-and-
// important quadrant is top-left. The panel is sticky under the title bar
// (app.css), so the plot fills the panel's width and the viewport height
// left below that sticky position; the plot area is generally not square,
// each axis uses its own pixel extent, and it is redrawn on panel or window
// resize.
//
// Only rows of kind 'task' are plotted (parents have no urgency/importance).
// Tasks sharing the same (urgency, importance) are spread evenly around the
// grid point, ordered by id, so the layout is deterministic and every point
// stays visibly attached to its integer value. Labels sit on the outward
// side of the jitter and flip to the other side of the point when their
// estimated width would run past the frame; titles are cut at LABEL_MAX
// characters with an ellipsis (the tooltip has the full title).
//
// Hovering a point shows the shared item tooltip (tooltip.js: title, values
// and the rendered description) and toggles .matrix-hover on the matching
// table row; hovering a table row highlights its point in return.
//
// Dependencies between two plotted tasks are drawn as a thin straight line
// from the blocker's dot to the blocked dot (shortened to the dots' edges,
// arrowhead at the blocked end) in a group beneath the points. Lines from an
// open blocker use the alert colour; hovering a point lights up its lines.

import { state, isClosed, isBlocked, dependencyEdges } from './state.js';
import { api } from './api.js';
import { el, toast } from './util.js';
import { itemTooltip } from './tooltip.js';
import { POINT_COLOR_MODES, parentColor } from './colors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX = 10;
const MARGIN = { top: 14, right: 18, bottom: 46, left: 52 };
const POINT_R = 5;
const HIT_R = 13;
const MIN_PLOT = 320;      // minimum plot-area width and height (px)
const BOTTOM_GAP = 16;     // viewport margin kept below the plot (px)
const MIN_DEP_LEN = 6;     // shortest dependency line worth drawing (px)
const LABEL_MAX = 28;      // title labels longer than this are cut with an ellipsis
const LABEL_CHAR_W = 6;    // estimated label width per character (10px font), px
const LABEL_GAP = 4;       // space between a dot's edge and its label (px)
const LABEL_MODES = [['key', 'Keys', 'Label the points with task keys'], ['title', 'Titles', 'Label the points with task titles']];

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
    // Inverses (unrounded) for dragging points.
    ux: (x) => MAX - ((x - MARGIN.left - padX) / (plotW - 2 * padX)) * MAX,
    iy: (y) => MAX - ((y - MARGIN.top - padY) / (plotH - 2 * padY)) * MAX,
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

/** The text a point is labelled with in `mode`: the key, or the title cut
 *  at LABEL_MAX characters. */
function labelText(item, mode) {
  if (mode !== 'title') return item.key;
  const t = item.title || item.key;
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1).trimEnd()}…` : t;
}

/** Estimated rendered width of a label (px), for the edge-flip decision. */
const labelWidth = (text) => text.length * LABEL_CHAR_W + LABEL_GAP;

function pointClass(item) {
  const cls = ['pt'];
  if (isClosed(item.status)) cls.push('closed');
  if (isBlocked(item)) cls.push('blocked');
  return cls.join(' ');
}

/** The dot colour in `mode`: the assignee's or owner's colour, or the
 *  task's Ongoing/Project colour; grey (the "unassigned" setting) when there
 *  is none. Closed items are not highlighted. */
function pointColor(item, mode) {
  if (isClosed(item.status)) return null;
  const neutral = state.settings?.color_unassigned || null;
  if (mode === 'parent') return parentColor(item) || neutral;
  const field = mode === 'owner' ? 'owner_id' : 'assignee_id';
  const u = item[field] != null ? state.usersById.get(item[field]) : null;
  return u ? u.color : neutral;
}

// ---------------------------------------------------------------- dependencies

function arrowMarker(id, cls) {
  return svg('marker', {
    id, class: cls, viewBox: '0 0 8 6', refX: 8, refY: 3, markerWidth: 7, markerHeight: 5,
    markerUnits: 'userSpaceOnUse', orient: 'auto',
  }, svg('path', { d: 'M0 0 L8 3 L0 6 Z' }));
}

/** Group of dependency lines between plotted points, drawn beneath the points.
 *  Each line runs from the edge of the blocker's dot to the edge of the
 *  blocked dot and is recorded on both points (p.lines) for hover lighting. */
function drawDependencies(pts) {
  const byId = new Map(pts.map((p) => [p.item.id, p]));
  const g = svg('g', { class: 'deps' },
    svg('defs', {}, arrowMarker('mx-dep-arrow', 'dep-arrow'), arrowMarker('mx-dep-arrow-open', 'dep-arrow open')));
  for (const { blocker, blocked } of dependencyEdges()) {
    const a = byId.get(blocker.id), b = byId.get(blocked.id);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2 * POINT_R + MIN_DEP_LEN) continue; // dots overlap: nothing to draw between them
    const ux = dx / len, uy = dy / len;
    const open = !isClosed(blocker.status);
    const line = svg('line', {
      class: `dep${open ? ' open' : ''}`,
      x1: a.x + ux * POINT_R, y1: a.y + uy * POINT_R,
      x2: b.x - ux * POINT_R, y2: b.y - uy * POINT_R,
      'marker-end': `url(#${open ? 'mx-dep-arrow-open' : 'mx-dep-arrow'})`,
      dataset: { blocker: blocker.id, blocked: blocked.id },
    });
    a.lines.push(line);
    b.lines.push(line);
    g.append(line);
  }
  return g;
}

// ---------------------------------------------------------------- plot

function drawPlot(root, rows, width, height, colorMode, labelMode) {
  const plotW = Math.max(MIN_PLOT, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(MIN_PLOT, height - MARGIN.top - MARGIN.bottom);
  const W = plotW + MARGIN.left + MARGIN.right;
  const H = plotH + MARGIN.top + MARGIN.bottom;
  const { sx, sy, ux, iy } = scales(plotW, plotH);
  // Frame edges: x0/x1 are left/right, y0/y1 bottom/top (SVG y grows downward).
  const x0 = MARGIN.left, x1 = MARGIN.left + plotW, y0 = MARGIN.top + plotH, y1 = MARGIN.top;
  const halfW = plotW / 2, halfH = plotH / 2;

  const node = svg('svg', { class: 'matrix-plot', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Urgency versus importance matrix' });

  // Quadrants: the top-left (urgent and important) gets a faint red wash and
  // the bottom-right (neither) a grey one; the emphasised midlines separate
  // the other two.
  const mid = MAX / 2;
  node.append(svg('rect', { class: 'plot-bg', x: x0, y: y1, width: plotW, height: plotH }));
  node.append(svg('rect', { class: 'quad quad-hot', x: x0, y: y1, width: halfW, height: halfH }));
  node.append(svg('rect', { class: 'quad quad-cold', x: sx(mid), y: sy(mid), width: halfW, height: halfH }));

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

  const pts = layout(rows, plotW, plotH);
  // Draw closed/blocked first so live points sit on top of muted ones.
  pts.sort((a, b) => Number(isClosed(a.item.status) || isBlocked(a.item)) - Number(isClosed(b.item.status) || isBlocked(b.item)));
  for (const p of pts) p.lines = [];
  node.append(drawDependencies(pts));

  const points = svg('g', { class: 'points' });
  for (const p of pts) {
    const color = pointColor(p.item, colorMode);
    const g = svg('g', {
      class: pointClass(p.item),
      dataset: { id: p.item.id, key: p.item.key },
      style: color ? `--pt: ${color}` : null,
    });
    // Label sits on the outward side of the jitter so clustered labels fan
    // out. When it would run past the right edge (low urgency) it flips to
    // the left of the point; when it would run past the left edge (high
    // urgency) it is forced to the right. The reach depends on the label's
    // length, so long titles flip where short keys would still fit.
    const text = labelText(p.item, labelMode);
    const reach = POINT_R + labelWidth(text);
    const vertical = p.angle !== 0 && Math.abs(Math.cos(p.angle)) <= 0.2;
    const nearRight = p.x + reach > x1;
    const nearLeft = p.x - reach < x0;
    const left = nearRight || (Math.cos(p.angle) < -0.2 && !nearLeft);
    const lx = vertical ? p.x : p.x + (left ? -(POINT_R + LABEL_GAP) : POINT_R + LABEL_GAP);
    const ly = vertical ? p.y + (Math.sin(p.angle) < 0 ? -(POINT_R + 5) : POINT_R + 5) : p.y;
    g.append(
      svg('circle', { class: 'hit', cx: p.x, cy: p.y, r: HIT_R }),
      isBlocked(p.item) ? svg('circle', { class: 'ring', cx: p.x, cy: p.y, r: POINT_R + 3.5 }) : null,
      svg('circle', { class: 'dot', cx: p.x, cy: p.y, r: POINT_R }),
      svg('text', {
        class: `label ${labelMode === 'title' ? 'title' : 'key'}`, x: lx, y: ly,
        'text-anchor': vertical ? 'middle' : (left ? 'end' : 'start'),
        'dominant-baseline': vertical ? (Math.sin(p.angle) < 0 ? 'auto' : 'hanging') : 'middle',
      }, text),
    );
    points.append(g);
    p.g = g;
  }
  node.append(points);
  root.replaceChildren(node);
  return { pts, inv: { ux, iy }, svg: node };
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

  // Point colouring mode (a preference), in a strip above the plot.
  const colorMode = POINT_COLOR_MODES.some(([m]) => m === ctx.pointColor) ? ctx.pointColor : 'assignee';
  const colorSel = el('select', { id: 'matrix-color', class: 'matrix-color', 'aria-label': 'Colour points by', title: 'Colour points by' });
  for (const [m, label] of POINT_COLOR_MODES) colorSel.append(el('option', { value: m, selected: m === colorMode ? true : null }, label));
  colorSel.addEventListener('change', () => ctx.setPointColor?.(colorSel.value));
  // Point labels (a preference): a Keys | Titles toggle beside the picker.
  const labelMode = ctx.labelMode === 'title' ? 'title' : 'key';
  const labelsGroup = el('div', { class: 'matrix-labels', role: 'group', 'aria-label': 'Point labels' });
  for (const [m, label, title] of LABEL_MODES) {
    labelsGroup.append(el('button', {
      type: 'button', class: m === labelMode ? 'active' : '', dataset: { labels: m },
      'aria-pressed': m === labelMode ? 'true' : 'false', title,
      onClick: () => { if (m !== labelMode) ctx.setLabelMode?.(m); },
    }, label));
  }
  const controls = el('div', { class: 'matrix-controls', role: 'group', 'aria-label': 'Matrix controls' }, colorSel, labelsGroup);
  const plotRoot = el('div', { class: 'matrix-plot-wrap' });
  wrap.append(controls, plotRoot);
  const tip = itemTooltip();

  let drawnW = -1, drawnH = -1;
  let dragging = false;
  let pts = [];
  const byId = new Map();

  /** Height available to the SVG: from the panel's top edge to the viewport
   *  bottom. A sticky panel sits at its CSS top offset once the page has
   *  scrolled, so that offset is used (and scrolling does not change it); a
   *  panel in the flow is measured in document coordinates. */
  function availableHeight() {
    const cs = getComputedStyle(panel);
    const top = cs.position === 'sticky' ? parseFloat(cs.top) || 0 : panel.getBoundingClientRect().top + window.scrollY;
    return Math.round(window.innerHeight - top - BOTTOM_GAP - controls.offsetHeight);
  }

  /** Highlight a point and the dependency lines attached to it. */
  function setHover(p, on) {
    if (!p) return;
    p.g.classList.toggle('hover', on);
    for (const l of p.lines) l.classList.toggle('lit', on);
  }

  function draw() {
    const width = panel.clientWidth || 600;
    const height = availableHeight();
    if (width === drawnW && height === drawnH) return;
    drawnW = width;
    drawnH = height;
    const res = drawPlot(plotRoot, rows, width, height, colorMode, labelMode);
    pts = res.pts;
    const { ux, iy } = res.inv;
    const svgNode = res.svg;
    byId.clear();
    for (const p of pts) {
      byId.set(p.item.id, p);
      let dragged = false;
      p.g.addEventListener('pointerenter', () => {
        if (dragging) return;
        setHover(p, true);
        p.row.el.classList.add('matrix-hover');
        tip.show(p.item, p.g.querySelector('.dot'));
      });
      p.g.addEventListener('pointerleave', () => {
        if (dragging) return;
        setHover(p, false);
        p.row.el.classList.remove('matrix-hover');
        tip.hide();
      });
      p.g.addEventListener('click', () => {
        if (dragged) { dragged = false; return; }
        p.row.el.scrollIntoView({ block: 'nearest' });
      });
      // Drag a point to change its urgency (x) and importance (y); the value
      // snaps to the nearest integer on release.
      p.g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const ctm = svgNode.getScreenCTM();
        const scale = ctm ? ctm.a : 1;
        const start = { x: e.clientX, y: e.clientY };
        let dx = 0, dy = 0;
        dragging = true;
        p.g.setPointerCapture(e.pointerId);
        p.g.classList.add('dragging');
        tip.hide();
        for (const l of p.lines) l.classList.add('moving');
        const onMove = (ev) => {
          dx = (ev.clientX - start.x) / scale;
          dy = (ev.clientY - start.y) / scale;
          if (!dragged && Math.hypot(dx, dy) > 3) dragged = true;
          if (dragged) p.g.setAttribute('transform', `translate(${dx} ${dy})`);
        };
        const onUp = async () => {
          p.g.removeEventListener('pointermove', onMove);
          p.g.removeEventListener('pointerup', onUp);
          p.g.removeEventListener('pointercancel', onUp);
          dragging = false;
          p.g.classList.remove('dragging');
          for (const l of p.lines) l.classList.remove('moving');
          if (!dragged) return;
          const u = Math.max(0, Math.min(MAX, Math.round(ux(p.x + dx))));
          const i = Math.max(0, Math.min(MAX, Math.round(iy(p.y + dy))));
          if (u === level(p.item.urgency) && i === level(p.item.importance)) {
            p.g.removeAttribute('transform');
            dragged = false;
            return;
          }
          try {
            await api.updateItem(p.item.id, { urgency: u, importance: i });
            await ctx.onChanged();
          } catch (err) {
            toast(err.message);
            p.g.removeAttribute('transform');
          }
        };
        p.g.addEventListener('pointermove', onMove);
        p.g.addEventListener('pointerup', onUp);
        p.g.addEventListener('pointercancel', onUp);
      });
    }
  }
  draw();

  // Table row hover highlights the point in return.
  for (const r of rows) {
    r.el.addEventListener('pointerenter', () => setHover(byId.get(r.item.id), true));
    r.el.addEventListener('pointerleave', () => setHover(byId.get(r.item.id), false));
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
