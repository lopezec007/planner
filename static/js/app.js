// Application shell: hash router, toolbar, page rendering.
//
// Routes: #/ (home), #/backlog, #/ideas, #/everything, #/users

import { api } from './api.js';
import { state, load } from './state.js';
import { PAGES } from './filters.js';
import { renderTable, describedIds } from './table.js';
import { renderPlan } from './plan.js';
import { renderMatrix } from './matrix.js';
import { renderUsers } from './users.js';
import { renderSearch } from './search.js';
import { el, toast } from './util.js';
import { beginNew, beginEdit, cancelEdit } from './edit.js';

const main = document.getElementById('main');
const toolbar = document.getElementById('toolbar');

// Per-page UI state that survives re-renders.
const pageState = {};
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
  const page = hash.split('?')[0] || 'home';
  return PAGES[page] || page === 'users' ? page : 'home';
}

async function reload() {
  try {
    await load();
  } catch (e) {
    toast(`Failed to load: ${e.message}`);
    return;
  }
  render();
}

// ---------------------------------------------------------------- actions

// Creating and editing happen in the table (see edit.js): these actions put
// the table into new/edit mode and re-render; the edit form saves via the
// API and then calls onChanged() to reload.
const actions = {
  onNew(type, page) {
    const def = PAGES[page];
    if (beginNew({ type, status: def.newStatus })) render();
  },
  onAddTask(parent) {
    const page = route();
    if (beginNew({ type: 'task', parentId: parent.id, status: PAGES[page]?.newStatus || 'todo' })) render();
  },
  onEdit(item) {
    if (beginEdit(item)) render();
  },
  onChanged: reload,
  async onDelete(item) {
    const extra = item.type === 'task' ? '' : ' and all of its tasks';
    if (!confirm(`Delete ${item.key} "${item.title}"${extra}?`)) return;
    try { await api.deleteItem(item.id); await reload(); } catch (e) { toast(e.message); }
  },
};

// ---------------------------------------------------------------- render

function setActiveNav(page) {
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.page === page);
}

function render() {
  const page = route();
  setActiveNav(page);
  if (page === 'users') {
    toolbar.replaceChildren();
    renderUsers(main, { reload });
    return;
  }
  const def = PAGES[page];
  const st = ps(page);

  // ---- toolbar ----
  toolbar.replaceChildren();
  const newBtn = el('button', { class: 'primary', type: 'button', id: 'btn-new' }, 'New ▾');
  const newMenu = el('div', { class: 'menu', hidden: true });
  if (def.allowNewOngoing) newMenu.append(el('button', { type: 'button', onClick: () => { newMenu.hidden = true; actions.onNew('ongoing', page); } }, 'Ongoing'));
  newMenu.append(el('button', { type: 'button', onClick: () => { newMenu.hidden = true; actions.onNew('project', page); } }, 'Project'));
  newBtn.addEventListener('click', () => { newMenu.hidden = !newMenu.hidden; });
  toolbar.append(el('div', { class: 'menu-wrap' }, newBtn, newMenu));

  toolbar.append(
    el('button', { type: 'button', id: 'btn-expand-all', onClick: () => { for (const id of describedIds(currentGroups)) st.expanded.add(id); render(); } }, 'Expand all'),
    el('button', { type: 'button', id: 'btn-collapse-all', onClick: () => { st.expanded.clear(); render(); } }, 'Collapse all'),
  );

  const searchSlot = el('div', { class: 'search-slot' });
  if (page === 'everything') toolbar.append(searchSlot);
  toolbar.append(el('div', { class: 'spacer' }));

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

  // ---- content ----
  let currentGroups = def.groups();
  if (page === 'everything') {
    if (!st.searchFilter) st.searchFilter = renderSearch(searchSlot, { rerender: render });
    else renderSearch(searchSlot, { rerender: render }); // re-mount controls into fresh toolbar
    currentGroups = st.searchFilter(currentGroups);
  }

  if (st.view === 'table') {
    const wrap = el('div', { class: 'table-wrap' });
    main.replaceChildren(wrap);
    renderTable(wrap, { groups: currentGroups, mode: 'full', expanded: st.expanded, actions });
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    const panel = el('div', { class: 'panel', id: 'panel' });
    main.replaceChildren(el('div', { class: 'split' }, wrap, panel));
    const draw = (handle) => {
      const ctx = { rerender: render, page };
      if (st.view === 'plan') renderPlan(panel, handle, ctx);
      else renderMatrix(panel, handle, ctx);
    };
    renderTable(wrap, { groups: currentGroups, mode: 'title-only', expanded: st.expanded, actions, onRendered: draw });
  }
}

document.addEventListener('click', (e) => {
  // close the New menu on outside click
  if (!e.target.closest('.menu-wrap')) document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
});
window.addEventListener('hashchange', () => { cancelEdit(); render(); });
reload();
