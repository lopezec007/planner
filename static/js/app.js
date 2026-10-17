// Application shell: hash router, toolbar, page rendering.
//
// Routes: #/ (active), #/backlog, #/ideas, #/everything, #/settings

import { api } from './api.js';
import { state, load } from './state.js';
import { PAGES } from './filters.js';
import { renderTable, expandableIds } from './table.js';
import { renderTimeline } from './timeline.js';
import { renderMatrix } from './matrix.js';
import { renderSettings } from './settings.js';
import { renderSearch } from './search.js';
import { el, toast, contrastText } from './util.js';
import { beginNew, discardNew } from './cells.js';

const main = document.getElementById('main');
const toolbar = document.getElementById('toolbar');

// Per-page UI state that survives re-renders.
const pageState = {};
// Table-view width constraint for very wide windows (shared by all pages).
let narrow = false;
try { narrow = localStorage.getItem('planner.narrow') === '1'; } catch {}
function ps(page) {
  if (!pageState[page]) {
    let view = 'table';
    try { view = localStorage.getItem(`planner.view.${page}`) || 'table'; } catch {}
    pageState[page] = { view, expanded: new Set(), searchFilter: null };
  }
  return pageState[page];
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  let page = hash.split('?')[0] || 'active';
  if (page === 'home') page = 'active';
  if (page === 'users') page = 'settings';
  return PAGES[page] || page === 'settings' ? page : 'active';
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
  onNew(type, page) {
    const def = PAGES[page];
    if (beginNew({ type, status: def.newStatus })) render();
  },
  onAddTask(parent) {
    const page = route();
    if (beginNew({ type: 'task', parentId: parent.id, status: PAGES[page]?.newStatus || 'todo' })) render();
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

function setActiveNav(page) {
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.page === page);
}

function render() {
  const page = route();
  setActiveNav(page);
  if (page === 'settings') {
    toolbar.replaceChildren(el('div', { class: 'spacer' }), versionBadge());
    renderSettings(main, { reload });
    return;
  }
  const def = PAGES[page];
  const st = ps(page);

  // ---- toolbar ----
  toolbar.replaceChildren();
  if (def.allowNewOngoing) {
    toolbar.append(el('button', { class: 'primary', type: 'button', id: 'btn-new-ongoing', onClick: () => actions.onNew('ongoing', page) }, 'New Ongoing'));
  }
  toolbar.append(el('button', { class: 'primary', type: 'button', id: 'btn-new-project', onClick: () => actions.onNew('project', page) }, 'New Project'));

  toolbar.append(
    el('button', { type: 'button', id: 'btn-expand-all', onClick: () => { for (const id of expandableIds(currentGroups)) st.expanded.add(id); render(); } }, 'Expand all'),
    el('button', { type: 'button', id: 'btn-collapse-all', onClick: () => { st.expanded.clear(); render(); } }, 'Collapse all'),
  );

  const searchSlot = el('div', { class: 'search-slot' });
  if (page === 'everything') toolbar.append(searchSlot);
  toolbar.append(el('div', { class: 'spacer' }));

  if (st.view === 'table') {
    toolbar.append(el('button', {
      type: 'button', id: 'btn-narrow', class: narrow ? 'active' : '', title: 'Constrain the table width on wide screens',
      'aria-pressed': narrow ? 'true' : 'false',
      onClick: () => { narrow = !narrow; try { localStorage.setItem('planner.narrow', narrow ? '1' : '0'); } catch {} render(); },
    }, 'Narrow'));
  }

  if (def.views.length > 1) {
    const group = el('div', { class: 'group', role: 'group', 'aria-label': 'View' });
    for (const v of def.views) {
      group.append(el('button', {
        type: 'button', class: st.view === v ? 'active' : '', dataset: { view: v },
        onClick: () => { st.view = v; try { localStorage.setItem(`planner.view.${page}`, v); } catch {} render(); },
      }, v[0].toUpperCase() + v.slice(1)));
    }
    toolbar.append(group);
  } else {
    st.view = 'table';
  }
  toolbar.append(versionBadge());

  // ---- content ----
  let currentGroups = def.groups();
  if (page === 'everything') {
    if (!st.searchFilter) st.searchFilter = renderSearch(searchSlot, { rerender: render });
    else renderSearch(searchSlot, { rerender: render }); // re-mount controls into fresh toolbar
    currentGroups = st.searchFilter(currentGroups);
  }

  // First-run guidance: an empty database has no users to pick as owner/assignee.
  const hint = (!state.users.length && !state.items.length)
    ? el('p', { class: 'hint', id: 'first-run-hint' },
        'Welcome. Start by adding people under ', el('a', { href: '#/settings' }, 'Settings'), ', then use New Ongoing or New Project to create your first items.')
    : null;

  if (st.view === 'table') {
    const wrap = el('div', { class: `table-wrap ${narrow ? 'constrained' : ''}` });
    main.replaceChildren(...[hint, wrap].filter(Boolean));
    renderTable(wrap, { groups: currentGroups, mode: 'full', expanded: st.expanded, actions });
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    const panel = el('div', { class: 'panel', id: 'panel' });
    main.replaceChildren(el('div', { class: 'split' }, wrap, panel));
    const draw = (handle) => {
      const ctx = { rerender: render, onChanged: reload, page };
      if (st.view === 'timeline') renderTimeline(panel, handle, ctx);
      else renderMatrix(panel, handle, ctx);
    };
    renderTable(wrap, { groups: currentGroups, mode: 'title-only', expanded: st.expanded, actions, onRendered: draw });
  }
}

window.addEventListener('hashchange', () => { discardNew(); render(); });
reload();
