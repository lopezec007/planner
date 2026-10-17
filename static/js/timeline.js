// Timeline view: Gantt-style timeline rendered beside the title-only table.
//
// renderTimeline(panel, handle, ctx)
//   panel   the right-hand container element
//   handle  the table handle from renderTable: rows [{ item, el, kind }] in
//           display order; bars are aligned to each row's actual bounding box
//           (so expanded description rows are accounted for).
//   ctx     { rerender() } to redraw after data changes
//
// Layout: a horizontally scrollable canvas (native scrollbar, shift+wheel,
// drag to pan) covering a wide date range; zoom (ctrl+wheel or the +/- buttons)
// changes the pixels-per-day scale. The axis is the same height as the table's
// header row and has two tiers: the major unit (month/year, a sticky label that
// stays in view while scrolling) above the minor unit (days/weeks/months).
// View state (zoom and scroll position) is kept in memory for the session only.
//
// Dependencies: every edge whose two items both have a bar is drawn as a
// rounded orthogonal connector from the end of the blocker's bar to the start
// of the blocked bar, with an arrowhead at the blocked end. The connectors
// live in one SVG overlay in canvas coordinates, so they zoom and scroll with
// the bars. Open blockers (not done/cancelled) use the alert colour.

import { el, toast } from './util.js';
import { api } from './api.js';
import { state, isClosed, isBlocked, dependencyEdges, parseYMD, today, daysFromToday, addDays } from './state.js';

const DAY_MS = 86400000;
const MAX_PPD = 80;        // max pixels per day
const ZOOM_STEP = 1.35;    // factor per +/- click
const SHORT_FADE_DAYS = 3; // soft edge width for non-firm dates
const MISSING_FADE_DAYS = 14; // tail length for a missing start or end date
const DEP_PAD = 10;        // connector stub length beyond a bar edge (px)
const DEP_RADIUS = 6;      // connector corner radius (px)
const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Session view state (not persisted): pixels per day and the day offset
// (relative to today, fractional) shown at the left edge of the viewport.
let view = null;
let cleanup = null;

// ---------------------------------------------------------------- dates

/** YYYY-MM-DD of today shifted by n calendar months. */
function addMonths(s, n) {
  const d = parseYMD(s);
  d.setMonth(d.getMonth() + n);
  return d;
}

function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

// ---------------------------------------------------------------- axis ticks

function tickUnits(ppd) {
  if (ppd >= 16) return ['month', 'day'];
  if (ppd >= 3.2) return ['month', 'week'];
  if (ppd >= 0.9) return ['year', 'month'];
  return ['year', 'quarter'];
}

/** First day of the week, 0 = Sunday ... 6 = Saturday (a setting). */
const weekStart = () => Number(state.settings?.week_start ?? 6);

function snap(d, unit) {
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() - weekStart() + 7) % 7));
  else if (unit === 'month') d.setDate(1);
  else if (unit === 'quarter') d.setMonth(d.getMonth() - (d.getMonth() % 3), 1);
  else if (unit === 'year') d.setMonth(0, 1);
}

function step(d, unit) {
  const n = new Date(d);
  if (unit === 'day') n.setDate(n.getDate() + 1);
  else if (unit === 'week') n.setDate(n.getDate() + 7);
  else if (unit === 'month') n.setMonth(n.getMonth() + 1);
  else if (unit === 'quarter') n.setMonth(n.getMonth() + 3);
  else n.setFullYear(n.getFullYear() + 1);
  return n;
}

function tickLabel(unit, d, width) {
  switch (unit) {
    case 'day':
      if (width >= 44) return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
      return String(d.getDate());
    case 'week':
      if (width >= 54) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
      return String(d.getDate());
    case 'month':
      if (width >= 110) return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
      if (width >= 64) return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (width >= 26) return MONTHS[d.getMonth()];
      return MONTHS[d.getMonth()][0];
    case 'quarter':
      return width >= 22 ? `Q${Math.floor(d.getMonth() / 3) + 1}` : '';
    default:
      return String(d.getFullYear());
  }
}

/** Yield { start, end } day offsets (relative to base) for each unit boundary in [from, to). */
function* ticks(unit, base, from, to) {
  let d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + from);
  snap(d, unit);
  while (true) {
    const start = daysBetween(base, d);
    if (start >= to) return;
    const n = step(d, unit);
    yield { start, end: daysBetween(base, n), date: d };
    d = n;
  }
}

// ---------------------------------------------------------------- dependency connectors

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, String(v));
  }
  node.append(...children);
  return node;
}

const px = (n) => Math.round(n * 100) / 100;

/** SVG path data for an orthogonal polyline with rounded corners. The path
 *  starts exactly at the first point and ends exactly at the last. */
function roundedPath(points, r) {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  let d = `M${px(pts[0][0])} ${px(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [cx, cy] = pts[i], [bx, by] = pts[i + 1];
    const inLen = Math.hypot(cx - ax, cy - ay), outLen = Math.hypot(bx - cx, by - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const ix = cx + ((ax - cx) / inLen) * rr, iy = cy + ((ay - cy) / inLen) * rr;
    const ox = cx + ((bx - cx) / outLen) * rr, oy = cy + ((by - cy) / outLen) * rr;
    d += ` L${px(ix)} ${px(iy)} Q${px(cx)} ${px(cy)} ${px(ox)} ${px(oy)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${px(lx)} ${px(ly)}`;
}

/** Route from the end of the blocker bar (a) to the start of the blocked bar (b).
 *  Each bar is { x0, x1, yc, rowTop, rowBottom }. When the blocked bar starts
 *  after the blocker ends the connector is a simple elbow through the gap;
 *  otherwise it steps out past the blocker's end, runs back along the edge of
 *  the blocker's row, and comes in from the left of the blocked bar. */
function connectorPoints(a, b) {
  const gap = b.x0 - a.x1;
  if (gap >= 2 * DEP_PAD) {
    const mx = a.x1 + gap / 2;
    return [[a.x1, a.yc], [mx, a.yc], [mx, b.yc], [b.x0, b.yc]];
  }
  const ym = b.yc > a.yc ? a.rowBottom : a.rowTop;
  return [[a.x1, a.yc], [a.x1 + DEP_PAD, a.yc], [a.x1 + DEP_PAD, ym], [b.x0 - DEP_PAD, ym], [b.x0 - DEP_PAD, b.yc], [b.x0, b.yc]];
}

function arrowMarker(id, cls) {
  return svg('marker', {
    id, class: cls, viewBox: '0 0 8 6', refX: 8, refY: 3, markerWidth: 8, markerHeight: 6,
    markerUnits: 'userSpaceOnUse', orient: 'auto',
  }, svg('path', { d: 'M0 0 L8 3 L0 6 Z' }));
}

/** The SVG overlay with one connector per edge whose bars are both drawn
 *  (`geom` maps item id to bar geometry). */
function drawDependencies(geom, width, height) {
  const node = svg('svg', { class: 'timeline-deps', width, height, 'aria-hidden': 'true' },
    svg('defs', {}, arrowMarker('tl-dep-arrow', 'timeline-dep-arrow'), arrowMarker('tl-dep-arrow-open', 'timeline-dep-arrow open')));
  for (const { blocker, blocked } of dependencyEdges()) {
    const a = geom.get(blocker.id), b = geom.get(blocked.id);
    if (!a || !b) continue;
    const open = !isClosed(blocker.status);
    node.append(svg('path', {
      class: `timeline-dep${open ? ' open' : ''}`,
      d: roundedPath(connectorPoints(a, b), DEP_RADIUS),
      'marker-end': `url(#${open ? 'tl-dep-arrow-open' : 'tl-dep-arrow'})`,
      dataset: { blocker: blocker.id, blocked: blocked.id },
    }));
  }
  return node;
}

// ---------------------------------------------------------------- render

export function renderTimeline(panel, handle, ctx) {
  if (cleanup) { cleanup(); cleanup = null; }

  const T = today();
  const base = parseYMD(T);
  const rows = handle.rows;

  // Date range covered by the canvas (day offsets from today), generous so
  // that scrolling has room and every dated item is reachable.
  let rangeStart = -365, rangeEnd = 730;
  for (const r of rows) {
    for (const s of [r.item.start_date, r.item.end_date]) {
      const d = daysFromToday(s);
      if (d == null) continue;
      rangeStart = Math.min(rangeStart, d - 60);
      rangeEnd = Math.max(rangeEnd, d + 60);
    }
  }
  const rangeDays = rangeEnd - rangeStart;

  // The window the spec asks for by default: one month before today through
  // three months after. "Today" recentres to the same proportions.
  const winStart = daysBetween(base, addMonths(T, -1));
  const winEnd = daysBetween(base, addMonths(T, 3));
  const winFrac = -winStart / (winEnd - winStart); // today's position within the window

  // ---- skeleton: wrapper, scroll container, canvas (appended before
  // measuring so positions are taken relative to the real canvas box) ----
  const plan = el('div', { class: 'timeline' });
  const scroll = el('div', { class: 'timeline-scroll' });
  const canvas = el('div', { class: 'timeline-canvas' });
  const tooltip = el('div', { class: 'timeline-tooltip', hidden: true });
  const controls = el('div', { class: 'timeline-controls', role: 'group', 'aria-label': 'Timeline zoom' });
  const btnOut = el('button', { type: 'button', class: 'icon', title: 'Zoom out', 'aria-label': 'Zoom out', dataset: { plan: 'zoom-out' } }, '−');
  const btnIn = el('button', { type: 'button', class: 'icon', title: 'Zoom in', 'aria-label': 'Zoom in', dataset: { plan: 'zoom-in' } }, '+');
  const btnToday = el('button', { type: 'button', title: 'Scroll to today', dataset: { plan: 'today' } }, 'Today');
  controls.append(btnOut, btnIn, btnToday);
  scroll.append(canvas);
  plan.append(scroll, controls, tooltip);
  panel.replaceChildren(plan);

  const viewportW = () => Math.max(scroll.clientWidth, 50);

  const minPpd = () => viewportW() / rangeDays;
  const clampPpd = (p) => Math.min(MAX_PPD, Math.max(minPpd(), p));

  if (!view) {
    view = { ppd: viewportW() / (winEnd - winStart), leftDay: winStart };
  }
  view.ppd = clampPpd(view.ppd);

  const x = (day) => (day - rangeStart) * view.ppd;

  // Table geometry: the axis is level with the table's header rows, and the
  // canvas spans the table's full height. The header rows are not part of
  // the handle contract, so they are found by DOM query.
  const table = panel.parentElement?.querySelector('.table') || rows[0]?.el.closest('.table');
  const headers = table ? [...table.querySelectorAll(':scope > .row.header')] : [];

  function draw() {
    canvas.replaceChildren();
    const canvasTop = canvas.getBoundingClientRect().top;
    const tableRect = table?.getBoundingClientRect();
    // The axis is exactly as tall as the table's header row; its two tiers
    // split that height.
    const axisH = headers.length ? headers[headers.length - 1].getBoundingClientRect().bottom - canvasTop : 36;
    const tier1 = Math.round(axisH / 2);
    let height = tableRect ? tableRect.bottom - 1 - canvasTop : axisH;
    const W = Math.ceil(rangeDays * view.ppd);
    const vw = viewportW();
    const ppd = view.ppd;

    // Row bands and bars (positions from the rows' real bounding boxes).
    const bands = [];
    const bars = [];
    const geom = new Map(); // item id -> bar geometry for the dependency connectors
    const longFade = Math.max(MISSING_FADE_DAYS * ppd, 24); // tail for a missing date
    const shortFade = Math.max(SHORT_FADE_DAYS * ppd, 6);
    for (const r of rows) {
      const it = r.item;
      const rect = r.el.getBoundingClientRect();
      const top = rect.top - canvasTop;
      const h = rect.height;
      height = Math.max(height, top + h);
      const band = el('div', {
        class: `timeline-row ${r.kind} ${it.type}${isClosed(it.status) ? ' closed' : ''}`,
        dataset: { id: it.id },
        style: { top: `${top}px`, height: `${h}px` },
      });
      bands.push(band);
      const barH = Math.max(8, Math.round(Math.min(r.kind === 'parent' ? 18 : 14, h * 0.55)));

      if (!it.start_date && !it.end_date) {
        if (it.type !== 'ongoing') {
          band.classList.add('empty-dates');
          band.title = 'Click to set a start date here; drag to set start and end';
          band.addEventListener('pointerdown', (ev) => startCreateDrag(ev, band, it, top + (h - barH) / 2, barH));
        }
        continue;
      }
      const s = daysFromToday(it.start_date);
      const e = daysFromToday(it.end_date);
      let x0, x1, fadeL, fadeR;
      if (s != null) { x0 = x(s); fadeL = it.start_firm ? 0 : shortFade; }
      if (e != null) { x1 = x(e + 1); fadeR = it.end_firm ? 0 : shortFade; }
      // A missing date fades in/out over two weeks, unless dependencies pin
      // it: no start -> from the latest end among its blockers; no end -> to
      // the earliest start among the items it blocks.
      if (s == null) {
        const ends = (it.blocked_by || []).map((id) => state.itemsById.get(id)).filter((b) => b?.end_date).map((b) => daysFromToday(b.end_date));
        const dep = ends.length ? x(Math.max(...ends) + 1) : null;
        if (dep != null && dep < x1 - 4) { x0 = dep; fadeL = x1 - x0; }
        else { x0 = x1 - longFade; fadeL = longFade; }
      }
      if (e == null) {
        const starts = (it.blocks || []).map((id) => state.itemsById.get(id)).filter((b) => b?.start_date).map((b) => daysFromToday(b.start_date));
        const dep = starts.length ? x(Math.min(...starts)) : null;
        if (dep != null && dep > x0 + 4) { x1 = dep; fadeR = x1 - x0; }
        else { x1 = x0 + longFade; fadeR = longFade; }
      }
      if (x1 < x0 + 4) x1 = x0 + 4;
      // Clamp to the canvas; the mask is offset so the fade stays put.
      let clipL = 0, clipR = 0;
      if (x0 < 0) { clipL = -x0; x0 = 0; }
      if (x1 > W) { clipR = x1 - W; x1 = W; }
      if (x1 <= x0) continue;
      const mask = `linear-gradient(to right, transparent ${-clipL}px, #000 ${fadeL - clipL}px, #000 calc(100% - ${fadeR - clipR}px), transparent calc(100% + ${clipR}px))`;
      const user = it.assignee_id != null ? state.usersById.get(it.assignee_id) : null;
      const cls = ['timeline-bar', r.kind];
      if (isClosed(it.status)) cls.push('closed');
      if (isBlocked(it)) cls.push('blocked');
      if (s == null) cls.push('no-start');
      if (e == null) cls.push('no-end');
      // The wrapper carries the geometry; the bar inside it carries the mask
      // (so the remove buttons beside it are not faded).
      const wrap = el('div', {
        class: 'timeline-barwrap',
        style: { left: `${x0}px`, width: `${x1 - x0}px`, top: `${top + (h - barH) / 2}px`, height: `${barH}px` },
      });
      const bar = el('div', {
        class: cls.join(' '),
        dataset: { id: it.id, key: it.key, fadeL: fadeL.toFixed(1), fadeR: fadeR.toFixed(1) },
        style: {
          background: user ? user.color : (state.settings?.color_unassigned || 'var(--accent)'),
          maskImage: mask, webkitMaskImage: mask,
        },
      });
      wrap.append(bar);
      for (const which of ['start', 'end']) {
        if (!it[`${which}_date`]) continue;
        const btn = el('button', {
          type: 'button', class: `timeline-x ${which}`, title: `Remove ${which} date`, 'aria-label': `Remove ${which} date of ${it.key}`,
          dataset: { remove: which, id: it.id },
        }, '×');
        btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        btn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          try { await api.updateItem(it.id, { [`${which}_date`]: null }); await ctx.onChanged(); } catch (err) { toast(err.message); }
        });
        wrap.append(btn);
      }
      bar.addEventListener('mouseenter', () => { if (!barDrag) showTip(it, user); });
      bar.addEventListener('mousemove', (e) => { if (!barDrag) { const z = zoneFor(bar, it, e); bar.style.cursor = cursorFor(z); setTipHint(hintFor(z, it)); moveTip(e); } });
      bar.addEventListener('mouseleave', hideTip);
      bar.addEventListener('pointerdown', (e) => startBarDrag(e, wrap, bar, it));
      bars.push(wrap);
      geom.set(it.id, { x0, x1, yc: top + h / 2, rowTop: top, rowBottom: top + h });
    }

    canvas.style.width = `${W}px`;
    canvas.style.height = `${height}px`;
    canvas.dataset.ppd = ppd.toFixed(3);

    // Axis background (level with the header rows) and tick columns.
    const [majorU, minorU] = tickUnits(ppd);
    canvas.dataset.units = `${majorU}/${minorU}`;
    canvas.append(el('div', { class: 'timeline-axis', style: { height: `${axisH}px` } },
      el('div', { class: 'timeline-axis-tier', style: { height: `${tier1}px` } })));
    const tickEls = [];
    const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const t of ticks(majorU, base, rangeStart, rangeEnd)) {
      const left = x(t.start), w = (t.end - t.start) * ppd;
      tickEls.push(el('div', {
        class: `timeline-tick major ${majorU}`,
        dataset: { date: ymdOf(t.date) },
        style: { left: `${left}px`, width: `${w}px`, top: '0px' },
      }, el('span', { class: 'timeline-tick-label', style: { height: `${tier1}px`, lineHeight: `${tier1}px` } }, tickLabel(majorU, t.date, w))));
    }
    for (const t of ticks(minorU, base, rangeStart, rangeEnd)) {
      const left = x(t.start), w = (t.end - t.start) * ppd;
      tickEls.push(el('div', {
        class: `timeline-tick minor ${minorU}`,
        dataset: { date: ymdOf(t.date) },
        style: { left: `${left}px`, width: `${w}px`, top: `${tier1}px` },
      }, el('span', { class: 'timeline-tick-label', style: { height: `${axisH - tier1}px`, lineHeight: `${axisH - tier1}px` } }, tickLabel(minorU, t.date, w))));
    }
    canvas.append(el('div', { class: 'timeline-rows', style: { top: '0px' } }, ...bands));
    canvas.append(...tickEls);
    canvas.append(...bars);
    canvas.append(drawDependencies(geom, W, height));

    // Today marker.
    canvas.append(el('div', { class: 'timeline-today', style: { left: `${x(0)}px` } },
      el('span', { class: 'timeline-today-label' }, 'Today')));

    scroll.scrollLeft = Math.round((view.leftDay - rangeStart) * ppd);
    btnIn.disabled = ppd >= MAX_PPD - 1e-6;
    btnOut.disabled = ppd <= minPpd() + 1e-6;
  }

  // ---- editing dates on the timeline ----
  // Bars: the middle moves every date the item has; an 8px edge resizes an
  // existing start/end; the faded region of a missing date is a "create"
  // zone: drag (or click) there to pin that date. Empty rows: click sets a
  // start date at that day, drag sets start and end. The × buttons shown on
  // hover remove a date.
  const EDGE = 8;
  let barDrag = null;
  const dayAt = (clientX) => Math.floor((clientX - canvas.getBoundingClientRect().left) / view.ppd) + rangeStart;
  const dayYmd = (d) => addDays(T, d);

  function zoneFor(bar, it, e) {
    const r = bar.getBoundingClientRect();
    const px = e.clientX - r.left;
    const fadeL = Number(bar.dataset.fadeL) || 0, fadeR = Number(bar.dataset.fadeR) || 0;
    if (!it.start_date && px < fadeL * 0.6) return 'create-start';
    if (!it.end_date && px > r.width - fadeR * 0.6) return 'create-end';
    if (it.start_date && px <= EDGE) return 'start';
    if (it.end_date && px >= r.width - EDGE) return 'end';
    return 'move';
  }
  const cursorFor = (z) => (z === 'move' ? 'grab' : z === 'create-start' ? 'w-resize' : z === 'create-end' ? 'e-resize' : 'ew-resize');
  function hintFor(z, it) {
    switch (z) {
      case 'create-start': return 'Click or drag here to set the start date';
      case 'create-end': return 'Click or drag here to set the end date';
      case 'start': return 'Drag to change the start date';
      case 'end': return 'Drag to change the end date';
      default: return it.start_date && it.end_date ? 'Drag to move both dates' : 'Drag to move the date';
    }
  }

  function startBarDrag(e, wrap, bar, it) {
    if (e.button !== 0) return;
    e.stopPropagation(); // not a pan
    e.preventDefault();
    hideTip();
    const zone = zoneFor(bar, it, e);
    const left0 = parseFloat(wrap.style.left), width0 = parseFloat(wrap.style.width);
    const sDay = daysFromToday(it.start_date), eDay = daysFromToday(it.end_date);
    barDrag = { zone, x: e.clientX, days: 0, day: null, moved: false };
    bar.setPointerCapture(e.pointerId);
    wrap.classList.add('editing');
    bar.style.cursor = zone === 'move' ? 'grabbing' : cursorFor(zone);
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - barDrag.x) > 2) barDrag.moved = true;
      if (zone === 'create-start' || zone === 'create-end') {
        let day = dayAt(ev.clientX);
        if (zone === 'create-start' && eDay != null) day = Math.min(day, eDay);
        if (zone === 'create-end' && sDay != null) day = Math.max(day, sDay);
        barDrag.day = day;
        if (zone === 'create-start') { wrap.style.left = `${x(day)}px`; wrap.style.width = `${Math.max(4, left0 + width0 - x(day))}px`; }
        else wrap.style.width = `${Math.max(4, x(day + 1) - left0)}px`;
        return;
      }
      let days = Math.round((ev.clientX - barDrag.x) / view.ppd);
      // Keep start <= end while resizing.
      if (zone === 'start' && eDay != null) days = Math.min(days, eDay - sDay);
      if (zone === 'end' && sDay != null) days = Math.max(days, sDay - eDay);
      barDrag.days = days;
      const dx = days * view.ppd;
      if (zone === 'move') wrap.style.left = `${left0 + dx}px`;
      else if (zone === 'start') { wrap.style.left = `${left0 + dx}px`; wrap.style.width = `${Math.max(4, width0 - dx)}px`; }
      else wrap.style.width = `${Math.max(4, width0 + dx)}px`;
    };
    const onUp = async (ev) => {
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
      const { days, moved } = barDrag;
      let { day } = barDrag;
      barDrag = null;
      wrap.classList.remove('editing');
      const patch = {};
      if (zone === 'create-start' || zone === 'create-end') {
        if (day == null) { // a click: pin the date where it was clicked
          day = dayAt(ev.clientX);
          if (zone === 'create-start' && eDay != null) day = Math.min(day, eDay);
          if (zone === 'create-end' && sDay != null) day = Math.max(day, sDay);
        }
        patch[zone === 'create-start' ? 'start_date' : 'end_date'] = dayYmd(day);
      } else {
        if (!days || !moved) { draw(); return; }
        if (zone !== 'end' && it.start_date) patch.start_date = addDays(it.start_date, days);
        if (zone !== 'start' && it.end_date) patch.end_date = addDays(it.end_date, days);
      }
      try {
        await api.updateItem(it.id, patch);
        await ctx.onChanged();
      } catch (err) {
        toast(err.message);
        draw();
      }
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);
  }

  /** Empty row: click sets a start date, drag sets start and end. */
  function startCreateDrag(e, band, it, top, barH) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const day0 = dayAt(e.clientX);
    let a = day0, b = day0, moved = false;
    const ghost = el('div', { class: 'timeline-ghost', style: { top: `${top}px`, height: `${barH}px`, left: `${x(day0)}px`, width: `${view.ppd}px` } });
    canvas.append(ghost);
    band.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const d = dayAt(ev.clientX);
      if (d !== day0) moved = true;
      a = Math.min(day0, d); b = Math.max(day0, d);
      ghost.style.left = `${x(a)}px`;
      ghost.style.width = `${(b - a + 1) * view.ppd}px`;
    };
    const onUp = async () => {
      band.removeEventListener('pointermove', onMove);
      band.removeEventListener('pointerup', onUp);
      band.removeEventListener('pointercancel', onUp);
      ghost.remove();
      const patch = moved ? { start_date: dayYmd(a), end_date: dayYmd(b) } : { start_date: dayYmd(day0) };
      try {
        await api.updateItem(it.id, patch);
        await ctx.onChanged();
      } catch (err) {
        toast(err.message);
      }
    };
    band.addEventListener('pointermove', onMove);
    band.addEventListener('pointerup', onUp);
    band.addEventListener('pointercancel', onUp);
  }

  // ---- tooltip ----
  function fmtDate(d, firm) {
    if (!d) return 'none';
    return firm ? `${d} (firm)` : d;
  }
  function showTip(it, user) {
    tooltip.replaceChildren(
      el('div', { class: 'timeline-tip-title' }, el('span', { class: 'key' }, it.key), ' ', it.title),
      el('div', { class: 'timeline-tip-dates' }, `Start: ${fmtDate(it.start_date, it.start_firm)}  ·  End: ${fmtDate(it.end_date, it.end_firm)}`),
    );
    if (user) tooltip.append(el('div', { class: 'timeline-tip-who' }, `Assignee: ${user.name}`));
    tooltip.append(el('div', { class: 'timeline-tip-hint' }));
    tooltip.hidden = false;
  }
  function setTipHint(text) {
    const h = tooltip.querySelector('.timeline-tip-hint');
    if (h) h.textContent = text;
  }
  function moveTip(e) {
    const pr = plan.getBoundingClientRect();
    let left = e.clientX - pr.left + 14;
    let top = e.clientY - pr.top + 14;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    if (left + tw > pr.width - 4) left = Math.max(4, e.clientX - pr.left - tw - 10);
    if (top + th > pr.height - 4) top = Math.max(4, e.clientY - pr.top - th - 10);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function hideTip() { tooltip.hidden = true; }

  // ---- zoom / pan ----
  // Zoom keeping the day under viewport x (px from the left edge) fixed.
  function zoomTo(ppd, anchorX) {
    const next = clampPpd(ppd);
    if (Math.abs(next - view.ppd) < 1e-9) return;
    const anchorDay = view.leftDay + anchorX / view.ppd;
    view.ppd = next;
    view.leftDay = anchorDay - anchorX / next;
    draw();
  }
  btnIn.addEventListener('click', () => zoomTo(view.ppd * ZOOM_STEP, viewportW() / 2));
  btnOut.addEventListener('click', () => zoomTo(view.ppd / ZOOM_STEP, viewportW() / 2));
  btnToday.addEventListener('click', () => {
    view.leftDay = -(viewportW() / view.ppd) * winFrac;
    scroll.scrollTo({ left: (view.leftDay - rangeStart) * view.ppd, behavior: 'smooth' });
  });

  scroll.addEventListener('scroll', () => {
    // Ignore bogus events from a detached or not-yet-laid-out container
    // (they report scrollLeft 0 and would reset the shared view state).
    if (!scroll.isConnected || scroll.scrollWidth <= scroll.clientWidth) return;
    view.leftDay = scroll.scrollLeft / view.ppd + rangeStart;
  }, { passive: true });

  scroll.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
      zoomTo(view.ppd * factor, e.clientX - scroll.getBoundingClientRect().left);
      return;
    }
    // Plain wheel (either axis) scrolls the timeline sideways.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewportW() : 1;
    scroll.scrollLeft += (e.deltaY + e.deltaX) * unit;
  }, { passive: false });

  // Drag to pan.
  let drag = null;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, left: scroll.scrollLeft, moved: false };
    scroll.setPointerCapture(e.pointerId);
  });
  scroll.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    scroll.classList.add('dragging');
    scroll.scrollLeft = drag.left - dx;
  });
  const endDrag = () => { drag = null; scroll.classList.remove('dragging'); };
  scroll.addEventListener('pointerup', endDrag);
  scroll.addEventListener('pointercancel', endDrag);

  // Redraw when the panel or table changes size (window resize, title wrap).
  let lastSize = '';
  const ro = new ResizeObserver(() => {
    if (!panel.isConnected) return; // torn down; do not touch the shared view state
    if (!panel.isConnected) { ro.disconnect(); return; }
    const size = `${scroll.clientWidth}x${table?.offsetHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    view.ppd = clampPpd(view.ppd);
    draw();
  });
  ro.observe(panel);
  if (table) ro.observe(table);
  cleanup = () => ro.disconnect();

  draw();
  lastSize = `${scroll.clientWidth}x${table?.offsetHeight}`;
}
