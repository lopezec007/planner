// Colour-coding: timeline bars, Matrix points and row tints (per-user
// preferences, see prefs.js), and the colours of Ongoing/Project items.
//
//   BAR_COLOR_MODES          [[mode, label], ...] for the Timeline picker
//   POINT_COLOR_MODES        the same for the Matrix (assignee, owner, parent)
//   barColor(item, mode)     CSS colour for an item's bar in that mode
//   barLegend(mode)          data for a legend, or null when none is needed
//   typeColor(type)          the Ongoing or Project colour from Settings
//   ownColor(parent)         an Ongoing's/Project's effective colour
//   parentColor(item)        the colour of the Ongoing/Project an item is under
//   rowTint(item, kind)      inline --row-color for a table/timeline row, or null
//   renderColorsMenu(slot, ctx)  the toolbar's Colours menu
//   typeChip(parent, opts)   an Ongoing's/Project's key as a chip in its type colour
//
// Every Ongoing and Project may carry a colour of its own (item.color, shared
// by everyone; picked with the swatch in its expanded details, see swatch.js
// and table.js detailRow). Two
// per-user preferences decide what shows: "parent_colors" (custom: a parent
// row uses its own colour when it has one, else the type colour from
// Settings; type: always the type colour) and "task_colors" (type: task rows
// take the Task tint from Settings; parent: their Ongoing/Project colour).
// The Timeline and Matrix have their own pickers with an "Ongoing / Project"
// mode that uses the same effective colour.
//
// Bar modes:
//   assignee / owner   that person's colour, else the "unassigned" setting
//   importance / urgency   the field's ramp colour (settings), neutral where
//                      the ramp leaves the value blank; parents have no level
//                      and are neutral too
//   combo              both at once, Eisenhower style: a bilinear blend in RGB
//                      between four corner colours (grey = neither, amber =
//                      urgent only, blue = important only, red = both)
//   parent             the Ongoing/Project colour (parents: their own), else neutral

import { state } from './state.js';
import { levelColor } from './cells.js';
import { prefs } from './prefs.js';
import { el, contrastText } from './util.js';
import { icon } from './icons.js';

export const BAR_COLOR_MODES = [
  ['assignee', 'Assignee'],
  ['owner', 'Owner'],
  ['importance', 'Importance'],
  ['urgency', 'Urgency'],
  ['combo', 'Importance × Urgency'],
  ['parent', 'Ongoing / Project'],
];

export const POINT_COLOR_MODES = [
  ['assignee', 'Assignee'],
  ['owner', 'Owner'],
  ['parent', 'Ongoing / Project'],
];

// ---- Ongoing / Project colours ----

/** The effective colour of an Ongoing or Project: its own when it has one and
 *  the "parent_colors" preference shows them, else the type colour from
 *  Settings ('' when that is none). Tasks and missing items give ''. */
export function ownColor(parent) {
  if (!parent || parent.type === 'task') return '';
  if (parent.color && prefs.get('parent_colors') !== 'type') return parent.color;
  return typeColor(parent.type);
}

/** The colour Settings gives the type ('ongoing' or 'project'); '' when it
 *  has none (or for any other type). */
export function typeColor(type) {
  const s = state.settings || {};
  return (type === 'ongoing' ? s.color_ongoing : type === 'project' ? s.color_project : '') || '';
}

/** An Ongoing's or Project's key as a chip that tells its type (app.css
 *  .type-chip): the type glyph (icons.js) before the key, on the type colour
 *  from Settings whatever the colour preferences and the item's own colour
 *  say, so two parents tinted in their own colours are still told apart. A
 *  neutral outline chip when Settings has no colour for the type. `label`
 *  replaces the key text (a new row's "N-?") and `keyClass` the class of
 *  the text span. The title names the type. */
export function typeChip(item, { label = item.key, keyClass = 'key-text' } = {}) {
  const color = typeColor(item.type);
  return el('span', {
    class: `type-chip${color ? '' : ' plain'}`,
    dataset: { type: item.type },
    style: color ? { background: color, color: contrastText(color) } : null,
    title: `${item.type === 'ongoing' ? 'Ongoing' : 'Project'} ${label}`,
  }, icon(item.type), el('span', { class: keyClass }, label));
}

/** The colour of the Ongoing/Project `item` belongs to (a parent: its own). */
export function parentColor(item) {
  return ownColor(item.type === 'task' ? state.itemsById.get(item.parent_id) : item);
}

/** The inline --row-color for a table or timeline row (see app.css), or null
 *  to leave the stylesheet's type tint: parent rows carry their effective
 *  colour; task rows their parent's when "task_colors" is parent. An unsaved
 *  new row takes exactly the tint a saved sibling would (its "new" mark is a
 *  separate outline, see edit.css). */
export function rowTint(item, kind) {
  if (kind === 'parent') return ownColor(item) || 'transparent';
  if (prefs.get('task_colors') === 'parent') return parentColor(item) || 'transparent';
  return null;
}

// Corners of the combo blend, as (urgency, importance).
export const COMBO_NEITHER = '#9aa3ad';   // urgency 0,  importance 0
export const COMBO_URGENT = '#f5a524';    // urgency 10, importance 0
export const COMBO_IMPORTANT = '#3b7dd8'; // urgency 0,  importance 10
export const COMBO_BOTH = '#e5484d';      // urgency 10, importance 10
export const COMBO_CORNERS = [
  { label: 'Neither', color: COMBO_NEITHER },
  { label: 'Urgent', color: COMBO_URGENT },
  { label: 'Important', color: COMBO_IMPORTANT },
  { label: 'Urgent & important', color: COMBO_BOTH },
];

const NEUTRAL_FALLBACK = '#9aa3ad'; // the server's default for color_unassigned

const normalize = (mode) => (BAR_COLOR_MODES.some(([m]) => m === mode) ? mode : 'assignee');

/** The "unassigned" setting colour (neutral grey by default). */
function neutral(fallback = NEUTRAL_FALLBACK) {
  return state.settings?.color_unassigned || fallback;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** Bilinear blend of the four corners at urgency u and importance i (0..10). */
export function comboColor(urgency, importance) {
  const u = clamp01(urgency / 10), i = clamp01(importance / 10);
  const c00 = hexToRgb(COMBO_NEITHER), c10 = hexToRgb(COMBO_URGENT);
  const c01 = hexToRgb(COMBO_IMPORTANT), c11 = hexToRgb(COMBO_BOTH);
  const out = [0, 1, 2].map((k) =>
    (1 - u) * (1 - i) * c00[k] + u * (1 - i) * c10[k] + (1 - u) * i * c01[k] + u * i * c11[k]);
  return `#${hex2(out[0])}${hex2(out[1])}${hex2(out[2])}`;
}

/** CSS colour for `item`'s bar in `mode` (unknown modes count as 'assignee'). */
export function barColor(item, mode) {
  switch (normalize(mode)) {
    case 'owner':
    case 'assignee': {
      const field = normalize(mode) === 'owner' ? 'owner_id' : 'assignee_id';
      const user = item[field] != null ? state.usersById.get(item[field]) : null;
      return user?.color || neutral('var(--accent)');
    }
    case 'importance':
    case 'urgency': {
      const field = normalize(mode);
      if (item.type !== 'task' || item[field] == null) return neutral();
      return levelColor(item[field], field) || neutral();
    }
    case 'combo':
      if (item.type !== 'task') return COMBO_NEITHER;
      return comboColor(item.urgency ?? 0, item.importance ?? 0);
    case 'parent':
      return parentColor(item) || neutral();
    default:
      return neutral('var(--accent)');
  }
}

/** Legend data: null for the person modes (the tooltip names the person);
 *  [{ value, color }] for 0..10 on a ramp; the four corners for combo. */
export function barLegend(mode) {
  switch (normalize(mode)) {
    case 'importance':
    case 'urgency': {
      const field = normalize(mode);
      const out = [];
      for (let v = 0; v <= 10; v++) out.push({ value: v, color: levelColor(v, field) || neutral() });
      return out;
    }
    case 'combo':
      return COMBO_CORNERS.map((c) => ({ ...c }));
    default:
      return null;
  }
}

// ---------------------------------------------------------------- Colours menu
//
// ctx = { parentColors, taskColors, setParentColors(mode), setTaskColors(mode) }

let open = false;
let listeners = false;

export function renderColorsMenu(slot, ctx) {
  const changed = ctx.parentColors === 'type' || ctx.taskColors === 'parent';
  const summary = [
    ctx.parentColors === 'type' ? 'Ongoing/Project rows in their type colours' : 'Ongoing/Project rows in their own colours',
    ctx.taskColors === 'parent' ? 'tasks in their Ongoing/Project colour' : 'tasks in the Task tint',
  ].join(', ');
  const btn = el('button', {
    type: 'button', id: 'btn-colors', class: changed ? 'active' : '', 'aria-expanded': open ? 'true' : 'false',
    'aria-controls': 'colors-panel', 'aria-label': 'Colours',
    title: `Colours: ${summary}. Your preference for how rows are tinted.`,
    onClick: () => setOpen(!open),
  }, icon('colors'));
  const panel = el('div', { class: 'sort-panel colors-panel', id: 'colors-panel', hidden: !open, role: 'group', 'aria-label': 'Colours' });
  const radios = (title, name, current, options, set) => {
    const box = el('div', { class: 'sort-order' }, el('div', { class: 'search-label' }, title));
    for (const [value, label] of options) {
      box.append(el('label', { class: 'sort-choice' },
        el('input', { type: 'radio', name, value, checked: current === value ? true : null, onChange: () => set(value) }), ` ${label}`));
    }
    return box;
  };
  panel.append(
    radios('Ongoing / Project rows', 'parent-colors', ctx.parentColors, [
      ['custom', 'Their own colour, when one is set'],
      ['type', 'Always the type colour from Settings'],
    ], ctx.setParentColors),
    radios('Task rows', 'task-colors', ctx.taskColors, [
      ['type', 'The Task tint from Settings'],
      ['parent', 'Their Ongoing / Project colour'],
    ], ctx.setTaskColors),
    el('p', { class: 'colors-note' }, 'Pick an Ongoing\u2019s or Project\u2019s colour in the Colour box of its expanded row (everyone sees it). The Timeline and Matrix have their own colour choice in the corner of the chart.'),
  );
  slot.replaceChildren(el('div', { class: 'menu-wrap' }, btn, panel));
  installListeners();

  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    btn.setAttribute('aria-expanded', v ? 'true' : 'false');
  }
}

function installListeners() {
  if (listeners) return;
  listeners = true;
  const close = () => {
    open = false;
    const p = document.getElementById('colors-panel'); if (p) p.hidden = true;
    const b = document.getElementById('btn-colors'); if (b) b.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('click', (e) => { if (open && !e.target.closest('.colors-slot')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });
}
