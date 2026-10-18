// Sorting: the column order, the comparator, and the Sort menu in the toolbar.
//
// The sort is a list of { key, dir } applied in order; an empty list is the
// user-defined order (drag and drop, sort_order). Clicking a column header
// (table.js) appends that column ascending, flips it to descending on the
// second click and removes it on the third, so headers clicked in sequence
// build a multi-column sort. The menu shows the same list, lets the direction
// be flipped or a column removed, resets to user-defined, and holds the
// "blocked items last" switch, which sinks blocked items whatever the sort.
//
//   SORT_COLUMNS                 key -> { label, parentOnly?, flatOnly? }
//   compareItems(sort, blockedLast) -> comparator for sibling items
//   renderSortMenu(slot, ctx)    ctx = { sort, blockedLast, flat, setSort(keys), setBlockedLast(on) }
//   toggleSort(sort, key)        the header-click rule, returns the new list

import { state, STATUSES, isBlocked } from './state.js';
import { el } from './util.js';
import { icon } from './icons.js';

export const SORT_COLUMNS = {
  parent: { label: 'Ongoing / Project', flatOnly: true },
  key: { label: 'Key' },
  title: { label: 'Title' },
  status: { label: 'Status' },
  owner: { label: 'Owner' },
  assignee: { label: 'Assignee' },
  start: { label: 'Start' },
  end: { label: 'End' },
  urgency: { label: 'Urgency' },
  importance: { label: 'Importance' },
  blocked: { label: 'Blocked' },
};

const MAX_KEYS = 6;

/** Sanitise a stored sort list: known keys, valid directions, no duplicates. */
export function normalizeSort(sort) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(sort) ? sort : []) {
    if (!s || !SORT_COLUMNS[s.key] || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' });
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}

/** Header click: add ascending, then descending, then remove. */
export function toggleSort(sort, key) {
  const cur = normalizeSort(sort);
  const i = cur.findIndex((s) => s.key === key);
  if (i < 0) return cur.length >= MAX_KEYS ? cur : [...cur, { key, dir: 'asc' }];
  if (cur[i].dir === 'asc') return cur.map((s, j) => (j === i ? { key, dir: 'desc' } : s));
  return cur.filter((s) => s.key !== key);
}

// ---- comparator ----

const userName = (id) => (id == null ? null : (state.usersById.get(id)?.name ?? `#${id}`));
const parentOf = (it) => (it.parent_id != null ? state.itemsById.get(it.parent_id) : null);
const KEY_TYPE_ORDER = { ongoing: 0, project: 1, task: 2 };

/** The sortable value of an item for a column; null sorts last in both directions. */
function value(it, key) {
  switch (key) {
    case 'parent': { const p = parentOf(it); return p ? [KEY_TYPE_ORDER[p.type] ?? 9, p.num] : null; }
    case 'key': return [KEY_TYPE_ORDER[it.type] ?? 9, it.num];
    case 'title': return it.title || '';
    case 'status': return it.status ? STATUSES.indexOf(it.status) : null;
    case 'owner': return userName(it.owner_id);
    case 'assignee': return userName(it.assignee_id);
    case 'start': return it.start_date || null;
    case 'end': return it.end_date || null;
    case 'urgency': return it.urgency ?? null;
    case 'importance': return it.importance ?? null;
    case 'blocked': return isBlocked(it) ? 1 : 0;
    default: return null;
  }
}

function cmpValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;  // missing values last, whatever the direction
  if (b == null) return -1;
  if (Array.isArray(a)) return (a[0] - b[0]) || (a[1] - b[1]);
  if (typeof a === 'string') return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return a - b;
}

/** The user-defined order: by parent (in the parents' own order) for tasks
 *  of different parents, then sort_order, then id. */
function userOrder(a, b) {
  if ((a.parent_id ?? null) !== (b.parent_id ?? null)) {
    const pa = parentOf(a), pb = parentOf(b);
    if (pa && pb && pa.sort_order !== pb.sort_order) return pa.sort_order - pb.sort_order;
  }
  return (a.sort_order - b.sort_order) || (a.id - b.id);
}

/** Comparator for items in one sibling group (or every task, in Flat). Ties
 *  fall back to the user-defined order, so the sort is stable. */
export function compareItems(sort, blockedLast) {
  const keys = normalizeSort(sort);
  return (a, b) => {
    if (blockedLast) {
      const d = Number(isBlocked(a)) - Number(isBlocked(b));
      if (d) return d;
    }
    for (const { key, dir } of keys) {
      const va = value(a, key), vb = value(b, key);
      let d = cmpValues(va, vb);
      if (d && dir === 'desc' && va != null && vb != null) d = -d;
      if (d) return d;
    }
    return userOrder(a, b);
  };
}

/** Sort a list of items in place with the current rules. */
export function sortItems(items, sort, blockedLast) {
  return items.sort(compareItems(sort, blockedLast));
}

// ---- toolbar menu ----

let open = false;
let listeners = false;

const ARROW = { asc: '↑', desc: '↓' };

export function renderSortMenu(slot, ctx) {
  const sort = normalizeSort(ctx.sort).filter((s) => ctx.flat || !SORT_COLUMNS[s.key].flatOnly);
  const active = sort.length > 0;
  const summary = active ? sort.map((s) => `${SORT_COLUMNS[s.key].label} ${ARROW[s.dir]}`).join(', ') : 'User-defined';

  const btn = el('button', {
    type: 'button', id: 'btn-sort', class: active || ctx.blockedLast ? 'active' : '', 'aria-expanded': open ? 'true' : 'false',
    'aria-controls': 'sort-panel', 'aria-label': 'Sort',
    title: `Sort: ${summary}${ctx.blockedLast ? ' (blocked last)' : ''}. Click column headers to sort by them, in order.`,
    onClick: () => setOpen(!open),
  }, icon('sort'), active ? el('span', { class: 'search-badge', id: 'sort-badge' }, String(sort.length)) : null);

  const panel = el('div', { class: 'sort-panel', id: 'sort-panel', hidden: !open, role: 'group', 'aria-label': 'Sort' });

  // Order: user-defined or the list of columns in effect.
  const orderBox = el('div', { class: 'sort-order' });
  orderBox.append(el('label', { class: 'sort-choice' },
    el('input', { type: 'radio', name: 'sort-mode', value: 'user', checked: active ? null : true, onChange: () => ctx.setSort([]) }),
    ' User-defined (drag rows to reorder)'));
  const listLabel = el('label', { class: 'sort-choice' },
    el('input', { type: 'radio', name: 'sort-mode', value: 'columns', checked: active ? true : null, disabled: active ? null : true }),
    ' By column' + (active ? ':' : ' (click a column header)'));
  orderBox.append(listLabel);
  if (active) {
    const list = el('ol', { class: 'sort-list' });
    sort.forEach((s, i) => {
      list.append(el('li', { class: 'sort-item', dataset: { sortKey: s.key } },
        el('span', { class: 'sort-item-label' }, SORT_COLUMNS[s.key].label),
        el('button', {
          type: 'button', class: 'icon sort-dir', title: s.dir === 'asc' ? 'Ascending: click for descending' : 'Descending: click for ascending',
          'aria-label': `${SORT_COLUMNS[s.key].label}: ${s.dir === 'asc' ? 'ascending' : 'descending'}`,
          onClick: () => ctx.setSort(sort.map((x, j) => (j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x))),
        }, ARROW[s.dir]),
        el('button', {
          type: 'button', class: 'icon sort-remove', title: 'Remove from the sort', 'aria-label': `Remove ${SORT_COLUMNS[s.key].label}`,
          onClick: () => ctx.setSort(sort.filter((_, j) => j !== i)),
        }, '×')));
    });
    orderBox.append(list);
  }
  // Columns that can still be added.
  const addable = Object.entries(SORT_COLUMNS).filter(([k, c]) => (ctx.flat || !c.flatOnly) && !sort.some((s) => s.key === k));
  if (addable.length && sort.length < MAX_KEYS) {
    const add = el('select', { class: 'sort-add', 'aria-label': 'Add a sort column' }, el('option', { value: '' }, active ? '+ then by…' : '+ sort by…'));
    for (const [k, c] of addable) add.append(el('option', { value: k }, c.label));
    add.addEventListener('change', () => { if (add.value) ctx.setSort([...sort, { key: add.value, dir: 'asc' }]); });
    orderBox.append(add);
  }
  panel.append(orderBox);

  panel.append(el('label', { class: 'search-check sort-blocked' },
    el('input', { type: 'checkbox', id: 'sort-blocked-last', checked: ctx.blockedLast ? true : null, onChange: (e) => ctx.setBlockedLast(e.target.checked) }),
    ' Blocked items last, whatever the sort'));

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
    const p = document.getElementById('sort-panel'); if (p) p.hidden = true;
    const b = document.getElementById('btn-sort'); if (b) b.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('click', (e) => { if (open && !e.target.closest('.sort-slot')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });
}
