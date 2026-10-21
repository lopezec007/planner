// Search and filter controls, including the Active / Backlog / Ideas filter
// templates (see filters.js PRESETS).
//
// The template buttons are toggles that combine: the selected ones give the
// union of their statuses and types, the largest "closed within" window, and
// hide empty Ongoing/Project rows only when every selected template does (so
// Active alone hides them, Active + Backlog keeps them). Which buttons are
// lit is derived from the criteria (currentPresets), so a change made in the
// Filters panel lights the templates it happens to equal, and nothing else.
//
// renderSearch(slot, ctx) renders controls into the toolbar slot and returns
// a function (groups) => groups that applies the current search/filter.
// It must call ctx.rerender() whenever the criteria change.
//
// app.js rebuilds the toolbar (and so calls renderSearch again) on every
// render, and keeps using the filter function returned by the FIRST call.
// All criteria therefore live in module-level state, never in the DOM, and
// the returned function reads that live state. Because every change triggers
// a full re-render that recreates the controls, focus and caret position are
// saved before each rerender and restored into the freshly mounted controls.
//
// Persistence: the criteria (everything but the search text) are saved as
// the "filters" preference (prefs.js) whenever they change, and app.js calls
// restoreFilters() after loading an account's preferences, so the filter
// settings survive a reload and follow the account.
//
// Semantics: an item matches on its own fields (the status filter never
// excludes Ongoing rows, which have no status; `recentDays` also admits items
// closed within that many days). A parent row is shown if it matches itself
// or any of its tasks match, and only matching tasks are shown;
// `hideEmptyParents` additionally drops parents with no matching tasks. With
// nothing active the groups pass through unchanged.

import { state, STATUSES, STATUS_LABEL, isBlocked, isClosed, withinLastDays } from './state.js';
import { PRESETS, PRESET_ORDER } from './filters.js';
import { el } from './util.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';

const TYPES = [['ongoing', 'Ongoing'], ['project', 'Project'], ['task', 'Task']];

function emptyCriteria() {
  return {
    text: '',
    types: new Set(),
    statuses: new Set(),
    recentDays: 0,  // also match items closed within this many days (0 = off)
    hideEmptyParents: false, // drop Ongoing/Project rows without matching tasks
    owner: '',      // '' any | 'none' | user id (string)
    assignee: '',   // '' any | 'none' | user id (string)
    blocked: '',    // '' any | 'yes' | 'no'
    endAfter: '',   // YYYY-MM-DD, inclusive
    endBefore: '',  // YYYY-MM-DD, inclusive
  };
}

/** Criteria for a combination of filter templates (unknown names such as
 *  'all' are ignored; none = no status/recent/type filters at all). */
function presetsCriteria(names) {
  const c = emptyCriteria();
  const used = names.filter((k) => PRESETS[k]);
  for (const k of used) {
    const p = PRESETS[k];
    for (const s of p.statuses) c.statuses.add(s);
    for (const t of p.types) c.types.add(t);
    c.recentDays = Math.max(c.recentDays, p.recentDays);
  }
  c.hideEmptyParents = used.length > 0 && used.every((k) => !!PRESETS[k].hideEmptyParents);
  return c;
}

/** Apply the combined status/recent/type filters of these templates, keeping
 *  any other criteria (owner, assignee, blocked, dates, text). */
export function applyPresets(names) {
  pinned.clear();
  const p = presetsCriteria(names);
  criteria.statuses = p.statuses;
  criteria.recentDays = p.recentDays;
  criteria.types = p.types;
  criteria.hideEmptyParents = p.hideEmptyParents;
}

/** Apply exactly one template (the #/active, #/backlog, #/ideas routes; 'all' = none). */
export function applyPreset(name) {
  applyPresets([name]);
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Every non-empty subset of PRESET_ORDER, in that order (7 for 3 templates). */
function presetCombinations() {
  const out = [];
  for (let bits = 1; bits < (1 << PRESET_ORDER.length); bits++) {
    out.push(PRESET_ORDER.filter((_, i) => bits & (1 << i)));
  }
  return out;
}

/** The templates whose combination is exactly in effect (a subset of
 *  PRESET_ORDER), or [] when the criteria match no combination. */
export function currentPresets() {
  for (const names of presetCombinations()) {
    const p = presetsCriteria(names);
    if (sameSet(criteria.statuses, p.statuses) && criteria.recentDays === p.recentDays && sameSet(criteria.types, p.types)
      && criteria.hideEmptyParents === p.hideEmptyParents) return names;
  }
  return [];
}

/** Toggle one template in the lit set and apply the combination. */
function togglePreset(name) {
  const on = new Set(currentPresets());
  if (on.has(name)) on.delete(name); else on.add(name);
  applyPresets(PRESET_ORDER.filter((k) => on.has(k)));
}

/** Default status for a new project/task under the current filters. */
export function newStatus() {
  const st = criteria.statuses;
  if (st.size === 1) return [...st][0];
  if (st.has('todo') || !st.size) return 'todo';
  return STATUSES.find((s) => st.has(s)) || 'todo';
}

/** Whether the type filter lets a newly created item of this type show. */
export function typeAllowed(type) {
  return !criteria.types.size || criteria.types.has(type);
}

// ---- persistence (the "filters" preference) ----

/** The criteria as stored in the preference (the search text is left out). */
function criteriaToPref(c) {
  return {
    types: [...c.types], statuses: [...c.statuses], recent_days: c.recentDays, hide_empty_parents: !!c.hideEmptyParents,
    owner: c.owner, assignee: c.assignee, blocked: c.blocked, end_after: c.endAfter, end_before: c.endBefore,
  };
}

function criteriaFromPref(p) {
  const c = emptyCriteria();
  c.types = new Set((p.types || []).filter((t) => TYPES.some(([v]) => v === t)));
  c.statuses = new Set((p.statuses || []).filter((s) => STATUSES.includes(s)));
  c.recentDays = Math.max(0, Number(p.recent_days) || 0);
  c.hideEmptyParents = !!p.hide_empty_parents;
  c.owner = String(p.owner ?? '');
  c.assignee = String(p.assignee ?? '');
  c.blocked = ['yes', 'no'].includes(p.blocked) ? p.blocked : '';
  c.endAfter = String(p.end_after ?? '');
  c.endBefore = String(p.end_before ?? '');
  return c;
}

/** Save the current criteria as the account's (or browser's) preference. */
export function persistFilters() {
  prefs.set('filters', criteriaToPref(criteria));
}

/** Replace the criteria with the stored preference (the Active template
 *  when none is stored); keeps the search text. Call after prefs.load(). */
export function restoreFilters() {
  const stored = prefs.get('filters');
  let next = null;
  if (stored) { try { next = criteriaFromPref(JSON.parse(stored)); } catch { next = null; } }
  if (!next) next = presetsCriteria(['active']);
  next.text = criteria.text;
  criteria = next;
  pinned.clear();
}

// ---- module state (survives re-renders) ----
let criteria = presetsCriteria(['active']); // the Active view is the starting point
// Items created in this session stay visible even when the filters would hide
// them (a new project has no tasks yet, say). Cleared when the criteria are
// replaced by a template or Clear.
const pinned = new Set();
export function pin(id) { pinned.add(id); }
let panelOpen = false;
let currentCtx = null;
let debounceTimer = null;
let pendingFocus = null; // { key, start, end } to restore after the next mount
let countEl = null;      // the "N items match" element of the latest mount
let panelEl = null;      // the filter panel of the latest mount
let listenersInstalled = false;

export function isActive() {
  const c = criteria;
  return !!(c.text.trim() || c.types.size || c.statuses.size || c.recentDays || c.hideEmptyParents || c.owner || c.assignee || c.blocked || c.endAfter || c.endBefore);
}

function activeFilterCount() {
  const c = criteria;
  return (c.types.size ? 1 : 0) + (c.statuses.size || c.recentDays ? 1 : 0) + (c.owner ? 1 : 0) + (c.assignee ? 1 : 0)
    + (c.blocked ? 1 : 0) + ((c.endAfter || c.endBefore) ? 1 : 0);
}

// ---- matching ----

function matches(it) {
  const c = criteria;
  const q = c.text.trim().toLowerCase();
  if (q) {
    const hay = `${it.key || ''}\n${it.title || ''}\n${it.description || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (c.types.size && !c.types.has(it.type)) return false;
  if (!statusMatches(it)) return false;
  if (c.owner) {
    if (c.owner === 'none' ? it.owner_id != null : String(it.owner_id) !== c.owner) return false;
  }
  if (c.assignee) {
    if (c.assignee === 'none' ? it.assignee_id != null : String(it.assignee_id) !== c.assignee) return false;
  }
  if (c.blocked && (c.blocked === 'yes') !== isBlocked(it)) return false;
  if (c.endAfter || c.endBefore) {
    if (!it.end_date) return false;
    if (c.endAfter && it.end_date < c.endAfter) return false;
    if (c.endBefore && it.end_date > c.endBefore) return false;
  }
  return true;
}

/** Status filter on the item's own status; Ongoing rows are never excluded. */
function statusMatches(it) {
  const c = criteria;
  if (!c.statuses.size && !c.recentDays) return true;
  if (it.type === 'ongoing') return true;
  if (c.statuses.has(it.status)) return true;
  if (c.recentDays && isClosed(it.status) && withinLastDays(it.closed_at, c.recentDays)) return true;
  return false;
}

function countLabel(n) {
  return n === 1 ? '1 item matches' : `${n} items match`;
}

function applyFilter(groups) {
  if (!isActive()) {
    if (countEl) { countEl.textContent = ''; countEl.hidden = true; }
    return groups;
  }
  const out = [];
  let n = 0;
  for (const g of groups) {
    const isPinned = pinned.has(g.parent.id);
    const parentMatch = matches(g.parent) || isPinned;
    const tasks = g.tasks.filter((t) => pinned.has(t.id) || matches(t));
    if (criteria.hideEmptyParents && !tasks.length && !isPinned) continue;
    if (parentMatch || tasks.length) {
      out.push({ parent: g.parent, tasks });
      n += (parentMatch ? 1 : 0) + tasks.length;
    }
  }
  if (countEl) { countEl.textContent = countLabel(n); countEl.hidden = false; }
  return out;
}

// ---- re-render plumbing ----

function rerender() {
  persistFilters();
  const a = document.activeElement;
  if (a && a.dataset && a.dataset.searchKey) {
    pendingFocus = { key: a.dataset.searchKey };
    if (a.tagName === 'INPUT' && a.type === 'text') {
      pendingFocus.start = a.selectionStart;
      pendingFocus.end = a.selectionEnd;
    }
  }
  if (currentCtx) currentCtx.rerender();
}

function restoreFocus(slot) {
  if (!pendingFocus) return;
  const { key, start, end } = pendingFocus;
  pendingFocus = null;
  const node = slot.querySelector(`[data-search-key="${key}"]`);
  if (!node) return;
  node.focus();
  if (start != null && node.type === 'text') {
    try { node.setSelectionRange(start, end); } catch {}
  }
}

function setPanel(open) {
  panelOpen = open;
  if (panelEl) panelEl.hidden = !open;
  const btn = document.getElementById('btn-filters');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener('click', (e) => {
    if (panelOpen && !e.target.closest('.search-slot')) setPanel(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) setPanel(false);
  });
}

// ---- controls ----

function toggleChip(label, key, selected, onToggle) {
  return el('button', {
    type: 'button', class: `search-chip${selected ? ' active' : ''}`, 'aria-pressed': selected ? 'true' : 'false',
    dataset: { searchKey: key }, onClick: () => { onToggle(); rerender(); },
  }, label);
}

function chipGroup(label, chips) {
  return el('div', { class: 'search-field' }, el('span', { class: 'search-label' }, label), el('div', { class: 'search-chips' }, chips));
}

function select(key, label, value, options, onChange) {
  const sel = el('select', { dataset: { searchKey: key }, 'aria-label': label, onChange: () => { onChange(sel.value); rerender(); } });
  for (const [v, text] of options) sel.append(el('option', { value: v, selected: v === value }, text));
  return el('label', { class: 'search-field' }, el('span', { class: 'search-label' }, label), sel);
}

function dateInput(key, label, value, onChange) {
  const inp = el('input', { type: 'date', value, dataset: { searchKey: key }, 'aria-label': label,
    onChange: () => { onChange(inp.value); rerender(); } });
  return el('label', { class: 'search-field' }, el('span', { class: 'search-label' }, label), inp);
}

function buildPanel() {
  const c = criteria;
  const userOpts = state.users.map((u) => [String(u.id), u.name]);
  const panel = el('div', { class: 'search-panel', id: 'search-panel', hidden: !panelOpen, role: 'group', 'aria-label': 'Filters' });
  panel.append(
    chipGroup('Type', TYPES.map(([v, text]) => toggleChip(text, `type:${v}`, c.types.has(v),
      () => { if (c.types.has(v)) c.types.delete(v); else c.types.add(v); }))),
    chipGroup('Status', [
      ...STATUSES.map((s) => toggleChip(STATUS_LABEL[s], `status:${s}`, c.statuses.has(s),
        () => { if (c.statuses.has(s)) c.statuses.delete(s); else c.statuses.add(s); })),
      el('label', { class: 'search-recent' }, 'or closed within',
        el('input', { type: 'number', min: 0, max: 365, value: c.recentDays || '', placeholder: '0', dataset: { searchKey: 'recentDays' }, 'aria-label': 'Closed within days',
          onChange: (e) => { c.recentDays = Math.max(0, Number(e.target.value) || 0); rerender(); } }),
        'days'),
    ]),
    el('div', { class: 'search-row' },
      select('owner', 'Owner', c.owner, [['', 'Any'], ['none', 'No owner'], ...userOpts], (v) => { c.owner = v; }),
      select('assignee', 'Assignee', c.assignee, [['', 'Any'], ['none', 'Unassigned'], ...userOpts], (v) => { c.assignee = v; }),
      select('blocked', 'Blocked', c.blocked, [['', 'Any'], ['yes', 'Blocked'], ['no', 'Not blocked']], (v) => { c.blocked = v; }),
    ),
    el('div', { class: 'search-row' },
      dateInput('endAfter', 'End on/after', c.endAfter, (v) => { c.endAfter = v; }),
      dateInput('endBefore', 'End on/before', c.endBefore, (v) => { c.endBefore = v; }),
    ),
    el('label', { class: 'search-check' },
      el('input', { type: 'checkbox', checked: c.hideEmptyParents ? true : null, dataset: { searchKey: 'hideEmpty' },
        onChange: (e) => { c.hideEmptyParents = e.target.checked; rerender(); } }),
      ' Hide Ongoing and Project rows with no matching tasks'),
  );
  return panel;
}

export function renderSearch(slot, ctx) {
  currentCtx = ctx;
  installListeners();
  slot.classList.add('search-slot');

  const text = el('input', {
    type: 'search', id: 'search-text', class: 'search-text', placeholder: 'Search…', title: 'Search key, title and description',
    value: criteria.text, autocomplete: 'off', dataset: { searchKey: 'text' }, 'aria-label': 'Search',
    onInput: () => {
      criteria.text = text.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(rerender, 150);
    },
    onKeydown: (e) => { if (e.key === 'Escape') { text.value = ''; criteria.text = ''; rerender(); } },
  });

  const lit = new Set(currentPresets());
  const presets = el('div', { class: 'group search-presets', role: 'group', 'aria-label': 'Filter templates' });
  for (const k of PRESET_ORDER) {
    const on = lit.has(k);
    const others = PRESET_ORDER.filter((o) => o !== k).map((o) => PRESETS[o].title).join(' or ');
    presets.append(el('button', {
      type: 'button', class: `search-preset${on ? ' active' : ''}`, dataset: { preset: k, searchKey: `preset:${k}` },
      'aria-pressed': on ? 'true' : 'false', 'aria-label': PRESETS[k].title,
      title: `${PRESETS[k].title}: ${PRESETS[k].hint}. ${on ? 'Click to turn it off' : `Click to turn it on; combine it with ${others}`}.`,
      onClick: () => { togglePreset(k); rerender(); },
    }, icon(k)));
  }

  const nActive = activeFilterCount();
  const filtersBtn = el('button', {
    type: 'button', id: 'btn-filters', class: nActive ? 'active' : '', 'aria-expanded': panelOpen ? 'true' : 'false',
    'aria-controls': 'search-panel', dataset: { searchKey: 'filters' }, 'aria-label': 'Filters',
    title: nActive ? `Filters: ${nActive} in effect. Type, status, owner, assignee, blocked and end date.` : 'Filters: type, status, owner, assignee, blocked and end date',
    onClick: () => setPanel(!panelOpen),
  }, icon('filter'), nActive ? el('span', { class: 'search-badge' }, String(nActive)) : null);

  const clearBtn = el('button', {
    type: 'button', id: 'btn-search-clear', disabled: !isActive(), title: 'Clear the search and every filter (show everything)', 'aria-label': 'Clear',
    onClick: () => { clearTimeout(debounceTimer); criteria = emptyCriteria(); pinned.clear(); rerender(); },
  }, icon('clear'));

  countEl = el('span', { class: 'search-count', id: 'search-count', 'aria-live': 'polite', hidden: true });
  panelEl = buildPanel();

  slot.replaceChildren(
    el('div', { class: 'search-controls' }, text, presets, el('div', { class: 'menu-wrap search-filters-wrap' }, filtersBtn, panelEl), clearBtn, countEl),
  );
  restoreFocus(slot);

  return applyFilter;
}
