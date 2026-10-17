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

import { el } from './util.js';
import { state, isClosed, parseYMD, today, daysFromToday } from './state.js';

const DAY_MS = 86400000;
const MAX_PPD = 80;        // max pixels per day
const ZOOM_STEP = 1.35;    // factor per +/- click
const SHORT_FADE_DAYS = 3; // soft edge width for non-firm dates
const MISSING_FADE_DAYS = 14; // tail length for a missing start or end date
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
    const longFade = Math.max(MISSING_FADE_DAYS * ppd, 24); // tail for a missing date
    const shortFade = Math.max(SHORT_FADE_DAYS * ppd, 6);
    for (const r of rows) {
      const it = r.item;
      const rect = r.el.getBoundingClientRect();
      const top = rect.top - canvasTop;
      const h = rect.height;
      height = Math.max(height, top + h);
      bands.push(el('div', {
        class: `timeline-row ${r.kind} ${it.type}${isClosed(it.status) ? ' closed' : ''}`,
        dataset: { id: it.id },
        style: { top: `${top}px`, height: `${h}px` },
      }));

      if (!it.start_date && !it.end_date) continue;
      const s = daysFromToday(it.start_date);
      const e = daysFromToday(it.end_date);
      let x0, x1, fadeL, fadeR;
      if (s != null) { x0 = x(s); fadeL = it.start_firm ? 0 : shortFade; }
      if (e != null) { x1 = x(e + 1); fadeR = it.end_firm ? 0 : shortFade; }
      if (s == null) { x0 = x1 - longFade; fadeL = longFade; }
      if (e == null) { x1 = x0 + longFade; fadeR = longFade; }
      if (x1 < x0 + 4) x1 = x0 + 4;
      // Clamp to the canvas; the mask is offset so the fade stays put.
      let clipL = 0, clipR = 0;
      if (x0 < 0) { clipL = -x0; x0 = 0; }
      if (x1 > W) { clipR = x1 - W; x1 = W; }
      if (x1 <= x0) continue;
      const barH = Math.max(8, Math.round(Math.min(r.kind === 'parent' ? 18 : 14, h * 0.55)));
      const mask = `linear-gradient(to right, transparent ${-clipL}px, #000 ${fadeL - clipL}px, #000 calc(100% - ${fadeR - clipR}px), transparent calc(100% + ${clipR}px))`;
      const user = it.assignee_id != null ? state.usersById.get(it.assignee_id) : null;
      const cls = ['timeline-bar', r.kind];
      if (isClosed(it.status)) cls.push('closed');
      if (it.blocked) cls.push('blocked');
      if (s == null) cls.push('no-start');
      if (e == null) cls.push('no-end');
      const bar = el('div', {
        class: cls.join(' '),
        dataset: { id: it.id, key: it.key },
        style: {
          left: `${x0}px`, width: `${x1 - x0}px`,
          top: `${top + (h - barH) / 2}px`, height: `${barH}px`,
          background: user ? user.color : (state.settings?.color_unassigned || 'var(--accent)'),
          maskImage: mask, webkitMaskImage: mask,
        },
      });
      bar.addEventListener('mouseenter', () => showTip(it, user));
      bar.addEventListener('mousemove', moveTip);
      bar.addEventListener('mouseleave', hideTip);
      bars.push(bar);
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

    // Today marker.
    canvas.append(el('div', { class: 'timeline-today', style: { left: `${x(0)}px` } },
      el('span', { class: 'timeline-today-label' }, 'Today')));

    scroll.scrollLeft = Math.round((view.leftDay - rangeStart) * ppd);
    btnIn.disabled = ppd >= MAX_PPD - 1e-6;
    btnOut.disabled = ppd <= minPpd() + 1e-6;
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
    tooltip.hidden = false;
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
    view.leftDay = scroll.scrollLeft / view.ppd + rangeStart;
  }, { passive: true });

  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain / shift wheel: native scrolling
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
    zoomTo(view.ppd * factor, e.clientX - scroll.getBoundingClientRect().left);
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
