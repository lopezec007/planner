// Search and filter controls for the Everything page.
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
// Semantics: an item matches on its own fields. A parent row is shown if it
// matches itself or any of its tasks match; only matching tasks are shown.
// With nothing active the groups pass through unchanged.

import { state, STATUSES, STATUS_LABEL, isBlocked } from './state.js';
import { el } from './util.js';

const TYPES = [['ongoing', 'Ongoing'], ['project', 'Project'], ['task', 'Task']];

function emptyCriteria() {
  return {
    text: '',
    types: new Set(),
    statuses: new Set(),
    owner: '',      // '' any | 'none' | user id (string)
    assignee: '',   // '' any | 'none' | user id (string)
    blocked: '',    // '' any | 'yes' | 'no'
    endAfter: '',   // YYYY-MM-DD, inclusive
    endBefore: '',  // YYYY-MM-DD, inclusive
  };
}

// ---- module state (survives re-renders) ----
let criteria = emptyCriteria();
let panelOpen = false;
let currentCtx = null;
let debounceTimer = null;
let pendingFocus = null; // { key, start, end } to restore after the next mount
let countEl = null;      // the "N items match" element of the latest mount
let panelEl = null;      // the filter panel of the latest mount
let listenersInstalled = false;

export function isActive() {
  const c = criteria;
  return !!(c.text.trim() || c.types.size || c.statuses.size || c.owner || c.assignee || c.blocked || c.endAfter || c.endBefore);
}

function activeFilterCount() {
  const c = criteria;
  return (c.types.size ? 1 : 0) + (c.statuses.size ? 1 : 0) + (c.owner ? 1 : 0) + (c.assignee ? 1 : 0)
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
  if (c.statuses.size && !c.statuses.has(it.status)) return false; // Ongoing has no status
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
    const parentMatch = matches(g.parent);
    const tasks = g.tasks.filter(matches);
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
    chipGroup('Status', STATUSES.map((s) => toggleChip(STATUS_LABEL[s], `status:${s}`, c.statuses.has(s),
      () => { if (c.statuses.has(s)) c.statuses.delete(s); else c.statuses.add(s); }))),
    el('div', { class: 'search-row' },
      select('owner', 'Owner', c.owner, [['', 'Any'], ['none', 'No owner'], ...userOpts], (v) => { c.owner = v; }),
      select('assignee', 'Assignee', c.assignee, [['', 'Any'], ['none', 'Unassigned'], ...userOpts], (v) => { c.assignee = v; }),
      select('blocked', 'Blocked', c.blocked, [['', 'Any'], ['yes', 'Blocked'], ['no', 'Not blocked']], (v) => { c.blocked = v; }),
    ),
    el('div', { class: 'search-row' },
      dateInput('endAfter', 'End on/after', c.endAfter, (v) => { c.endAfter = v; }),
      dateInput('endBefore', 'End on/before', c.endBefore, (v) => { c.endBefore = v; }),
    ),
  );
  return panel;
}

export function renderSearch(slot, ctx) {
  currentCtx = ctx;
  installListeners();
  slot.classList.add('search-slot');

  const text = el('input', {
    type: 'search', id: 'search-text', class: 'search-text', placeholder: 'Search key, title, description…',
    value: criteria.text, autocomplete: 'off', dataset: { searchKey: 'text' }, 'aria-label': 'Search',
    onInput: () => {
      criteria.text = text.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(rerender, 150);
    },
    onKeydown: (e) => { if (e.key === 'Escape') { text.value = ''; criteria.text = ''; rerender(); } },
  });

  const nActive = activeFilterCount();
  const filtersBtn = el('button', {
    type: 'button', id: 'btn-filters', class: nActive ? 'active' : '', 'aria-expanded': panelOpen ? 'true' : 'false',
    'aria-controls': 'search-panel', dataset: { searchKey: 'filters' },
    onClick: () => setPanel(!panelOpen),
  }, 'Filters ▾', nActive ? el('span', { class: 'search-badge' }, String(nActive)) : null);

  const clearBtn = el('button', {
    type: 'button', id: 'btn-search-clear', disabled: !isActive(), title: 'Clear search and filters',
    onClick: () => { clearTimeout(debounceTimer); criteria = emptyCriteria(); rerender(); },
  }, 'Clear');

  countEl = el('span', { class: 'search-count', id: 'search-count', 'aria-live': 'polite', hidden: true });
  panelEl = buildPanel();

  slot.replaceChildren(
    el('div', { class: 'search-controls' }, text, el('div', { class: 'menu-wrap search-filters-wrap' }, filtersBtn, panelEl), clearBtn, countEl),
  );
  restoreFocus(slot);

  return applyFilter;
}
