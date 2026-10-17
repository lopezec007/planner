// Application shell: hash router, toolbar, page rendering.
//
// There is one planner page (all items, narrowed by the search/filter
// controls, which start on the Active template) and a Settings page reached
// from the gear at the far left. Routes: #/ and #/settings. The old
// #/active, #/backlog, #/ideas and #/all (or #/everything) apply that filter
// template and then drop back to #/.

import { api } from './api.js';
import { state, load } from './state.js';
import { allGroups } from './filters.js';
import { renderTable, expandableIds } from './table.js';
import { renderTimeline } from './timeline.js';
import { renderMatrix } from './matrix.js';
import { renderSettings } from './settings.js';
import { renderSearch, applyPreset, newStatus, typeAllowed } from './search.js';
import { el, toast, contrastText } from './util.js';
import { beginNew, discardNew } from './cells.js';

const main = document.getElementById('main');
const toolbar = document.getElementById('toolbar');
const settingsBtn = document.getElementById('btn-settings');

const VIEWS = ['table', 'timeline', 'matrix'];
const LEGACY_FILTER_ROUTES = { active: 'active', backlog: 'backlog', ideas: 'ideas', all: 'all', everything: 'all', home: 'active' };

// UI state for the planner page, surviving re-renders.
const ui = { view: 'table', expanded: new Set(), searchFilter: null };
let narrow = false; // table-view width constraint for very wide windows
try {
  ui.view = VIEWS.includes(localStorage.getItem('planner.view')) ? localStorage.getItem('planner.view') : 'table';
  narrow = localStorage.getItem('planner.narrow') === '1';
} catch {}
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

function route() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (hash === 'settings' || hash === 'users') return { page: 'settings' };
  if (hash in LEGACY_FILTER_ROUTES) {
    applyPreset(LEGACY_FILTER_ROUTES[hash]);
    history.replaceState(null, '', '#/');
  }
  return { page: 'main' };
}

async function reload() {
  try {
    await load();
  } catch (e) {
    toast(`Failed to load: ${e.message}`);
    return;
  }
  applySettings();
  render();
}

// Row tint colours come from Settings; an empty colour means no tint.
function applySettings() {
  const root = document.documentElement.style;
  const s = state.settings || {};
  root.setProperty('--row-ongoing', s.color_ongoing || 'transparent');
  root.setProperty('--row-project', s.color_project || 'transparent');
  root.setProperty('--row-task', s.color_task || 'transparent');
  for (const [key, v] of [['warn', s.hl_warn_color], ['alert', s.hl_alert_color]]) {
    if (!v) continue;
    root.setProperty(`--hl-${key}`, v);
    root.setProperty(`--hl-${key}-fg`, contrastText(v));
  }
}

// ---------------------------------------------------------------- actions

// Every field edits in place (see cells.js). These actions add a new row,
// delete, and reload after any change.
const actions = {
  onNew(type) {
    if (beginNew({ type, status: newStatus() })) render();
  },
  onAddTask(parent) {
    if (beginNew({ type: 'task', parentId: parent.id, status: newStatus() })) render();
  },
  onChanged: reload,
  async onDelete(item) {
    const extra = item.type === 'task' ? '' : ' and all of its tasks';
    if (!confirm(`Delete ${item.key} "${item.title}"${extra}?`)) return;
    try { await api.deleteItem(item.id); await reload(); } catch (e) { toast(e.message); }
  },
};

// ---------------------------------------------------------------- render

/** "v0.9.0" with the release date (and build) on mouseover. */
function versionBadge() {
  const v = state.version || {};
  const title = v.version ? `Version ${v.version}, released ${v.date}${v.build && v.build !== 'dev' ? ` (build ${v.build})` : ''}` : '';
  return el('span', { class: 'version', id: 'app-version', title }, v.version ? `v${v.version}` : '');
}

settingsBtn.addEventListener('click', () => { location.hash = '#/settings'; });

function render() {
  const r = route();
  settingsBtn.classList.toggle('active', r.page === 'settings');
  if (r.page === 'settings') {
    toolbar.replaceChildren(
      el('button', { type: 'button', id: 'btn-back', title: 'Back to the items', onClick: () => { location.hash = '#/'; } }, '← Items'),
      el('div', { class: 'spacer' }), versionBadge());
    renderSettings(main, { reload });
    return;
  }

  // ---- toolbar ----
  toolbar.replaceChildren();
  if (typeAllowed('ongoing')) {
    toolbar.append(el('button', { class: 'primary', type: 'button', id: 'btn-new-ongoing', onClick: () => actions.onNew('ongoing') }, 'New Ongoing'));
  }
  toolbar.append(el('button', { class: 'primary', type: 'button', id: 'btn-new-project', onClick: () => actions.onNew('project') }, 'New Project'));

  toolbar.append(
    el('button', { type: 'button', id: 'btn-expand-all', onClick: () => { for (const id of expandableIds(currentGroups)) ui.expanded.add(id); render(); } }, 'Expand all'),
    el('button', { type: 'button', id: 'btn-collapse-all', onClick: () => { ui.expanded.clear(); render(); } }, 'Collapse all'),
  );

  const searchSlot = el('div', { class: 'search-slot' });
  toolbar.append(searchSlot);
  toolbar.append(el('div', { class: 'spacer' }));

  if (ui.view === 'table') {
    toolbar.append(el('button', {
      type: 'button', id: 'btn-narrow', class: narrow ? 'active' : '', title: 'Constrain the table width on wide screens',
      'aria-pressed': narrow ? 'true' : 'false',
      onClick: () => { narrow = !narrow; remember('planner.narrow', narrow ? '1' : '0'); render(); },
    }, 'Narrow'));
  }

  const group = el('div', { class: 'group', role: 'group', 'aria-label': 'View' });
  for (const v of VIEWS) {
    group.append(el('button', {
      type: 'button', class: ui.view === v ? 'active' : '', dataset: { view: v },
      onClick: () => { ui.view = v; remember('planner.view', v); render(); },
    }, v[0].toUpperCase() + v.slice(1)));
  }
  toolbar.append(group, versionBadge());

  // ---- content: all items, narrowed by the search/filter criteria ----
  let currentGroups = allGroups();
  if (!ui.searchFilter) ui.searchFilter = renderSearch(searchSlot, { rerender: render });
  else renderSearch(searchSlot, { rerender: render }); // re-mount controls into the fresh toolbar
  currentGroups = ui.searchFilter(currentGroups);

  // First-run guidance: an empty database has no users to pick as owner/assignee.
  const hint = (!state.users.length && !state.items.length)
    ? el('p', { class: 'hint', id: 'first-run-hint' },
        'Welcome. Start by adding people under ', el('a', { href: '#/settings' }, 'Settings'), ', then use New Ongoing or New Project to create your first items.')
    : null;

  if (ui.view === 'table') {
    const wrap = el('div', { class: `table-wrap ${narrow ? 'constrained' : ''}` });
    main.replaceChildren(...[hint, wrap].filter(Boolean));
    renderTable(wrap, { groups: currentGroups, mode: 'full', expanded: ui.expanded, actions });
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    const panel = el('div', { class: 'panel', id: 'panel' });
    main.replaceChildren(el('div', { class: 'split' }, wrap, panel));
    const draw = (handle) => {
      const ctx = { rerender: render, onChanged: reload };
      if (ui.view === 'timeline') renderTimeline(panel, handle, ctx);
      else renderMatrix(panel, handle, ctx);
    };
    renderTable(wrap, { groups: currentGroups, mode: 'title-only', expanded: ui.expanded, actions, onRendered: draw });
  }
}

window.addEventListener('hashchange', () => { discardNew(); render(); });
reload();
