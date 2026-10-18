// Table columns: which can be hidden, their widths, and the Columns menu.
//
//   COLUMNS                      ordered column definitions
//   visibleColumns(mode, flat, hidden) -> [name...] of the columns to render
//   gridTemplate(cols, flat)     the grid-template-columns value for them
//   renderColumnsMenu(slot, ctx) ctx = { hidden (Set), flat, enabled, setHidden(names) }
//
// The title (and, in Flat, the task title) and the action buttons always
// show; everything else can be hidden from the menu. Hidden columns are a
// preference (prefs.js "hidden_cols").

import { el } from './util.js';
import { icon } from './icons.js';

// name -> { label, width, flat (width in Flat), title-only presence, hidable }
export const COLUMNS = [
  { name: 'toggle', width: '28px', titleOnly: true },
  { name: 'pkey', label: 'Ongoing / Project key', width: '72px', flatOnly: true, titleOnly: true, group: 'parent' },
  { name: 'key', label: 'Key', width: '92px', flatWidth: '72px', titleOnly: true, hidable: true },
  { name: 'ptitle', label: 'Ongoing / Project', width: 'minmax(150px, 0.8fr)', titleOnlyWidth: 'minmax(140px, 0.8fr)', flatOnly: true, titleOnly: true, group: 'parent' },
  { name: 'title', label: 'Title', width: 'minmax(220px, 1fr)', flatWidth: 'minmax(200px, 1.2fr)', titleOnlyWidth: 'minmax(200px, 1fr)', flatTitleOnlyWidth: 'minmax(180px, 1.2fr)', titleOnly: true },
  { name: 'status', label: 'Status', width: '110px', hidable: true },
  { name: 'owner', label: 'Owner', width: '136px', hidable: true },
  { name: 'assignee', label: 'Assignee', width: '136px', hidable: true },
  { name: 'start', label: 'Start', width: '150px', hidable: true },
  { name: 'end', label: 'End', width: '150px', hidable: true },
  { name: 'urgency', label: 'Urgency', width: '44px', hidable: true },
  { name: 'importance', label: 'Importance', width: '44px', hidable: true },
  { name: 'blocked', label: 'Blocked', width: '80px', hidable: true },
  { name: 'actions', width: '96px' },
];

/** The hidable entries as shown in the menu: Flat adds the parent columns
 *  (hidden together under the name "parent"). */
export function hidableColumns(flat) {
  const out = [];
  if (flat) out.push({ name: 'parent', label: 'Ongoing / Project' });
  for (const c of COLUMNS) if (c.hidable) out.push({ name: c.name, label: c.label });
  return out;
}

export function normalizeHidden(list) {
  const valid = new Set(['parent', ...COLUMNS.filter((c) => c.hidable).map((c) => c.name)]);
  return new Set((Array.isArray(list) ? list : []).filter((n) => valid.has(n)));
}

/** Names of the columns to render, in order. */
export function visibleColumns(mode, flat, hidden) {
  return COLUMNS.filter((c) => {
    if (mode === 'title-only' && !c.titleOnly) return false;
    if (c.flatOnly && !flat) return false;
    if (hidden.has(c.name) || (c.group && hidden.has(c.group))) return false;
    return true;
  }).map((c) => c.name);
}

export function gridTemplate(names, mode, flat) {
  return names.map((n) => {
    const c = COLUMNS.find((x) => x.name === n);
    if (mode === 'title-only' && flat && c.flatTitleOnlyWidth) return c.flatTitleOnlyWidth;
    if (mode === 'title-only' && c.titleOnlyWidth) return c.titleOnlyWidth;
    if (flat && c.flatWidth) return c.flatWidth;
    return c.width;
  }).join(' ');
}

// ---- toolbar menu ----

let open = false;
let listeners = false;

export function renderColumnsMenu(slot, ctx) {
  const options = hidableColumns(ctx.flat);
  const hiddenHere = options.filter((o) => ctx.hidden.has(o.name)).length;
  const btn = el('button', {
    type: 'button', id: 'btn-columns', class: hiddenHere ? 'active' : '', 'aria-expanded': open ? 'true' : 'false',
    'aria-controls': 'columns-panel', 'aria-label': 'Columns', disabled: ctx.enabled ? null : true,
    title: ctx.enabled ? (hiddenHere ? `Columns: ${hiddenHere} hidden` : 'Columns: choose which to show') : 'Columns apply to the Table view',
    onClick: () => setOpen(!open),
  }, icon('columns'), hiddenHere ? el('span', { class: 'search-badge', id: 'columns-badge' }, String(hiddenHere)) : null);
  const panel = el('div', { class: 'sort-panel columns-panel', id: 'columns-panel', hidden: !open || !ctx.enabled, role: 'group', 'aria-label': 'Columns' });
  for (const o of options) {
    panel.append(el('label', { class: 'sort-choice' },
      el('input', { type: 'checkbox', dataset: { column: o.name }, checked: ctx.hidden.has(o.name) ? null : true,
        onChange: (e) => {
          const next = new Set(ctx.hidden);
          if (e.target.checked) next.delete(o.name); else next.add(o.name);
          ctx.setHidden([...next]);
        } }),
      ` ${o.label}`));
  }
  if (hiddenHere) {
    panel.append(el('button', { type: 'button', class: 'columns-all', onClick: () => ctx.setHidden([...ctx.hidden].filter((n) => !options.some((o) => o.name === n))) }, 'Show all'));
  }
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
    const p = document.getElementById('columns-panel'); if (p) p.hidden = true;
    const b = document.getElementById('btn-columns'); if (b) b.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('click', (e) => { if (open && !e.target.closest('.columns-slot')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });
}
