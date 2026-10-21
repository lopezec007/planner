// Application shell: hash router, toolbar, account menu, page rendering.
//
// There is one planner page (all items, narrowed by the search/filter
// controls, which start on the Active template) and a Settings page reached
// from the gear at the far left. Routes: #/ and #/settings; #/active,
// #/backlog, #/ideas and #/all (or #/everything) apply that filter template.
//
// View, Flat, Narrow, collapsed parents, sort order, the filter settings,
// the Timeline bar and Matrix point colours and the row colour-coding are
// preferences (prefs.js) belonging to the account picked in the account
// menu at the far right. The menu lists the users; a browser that has not
// picked one (or whose user was deleted) gets the first user. Only with no
// users at all do the preferences stay in the browser.
//
// An edit in progress (a new row, an open title/date/description editor) is
// protected: in-app navigation shows a snack and stays put, and leaving the
// page asks first.

import { api, undo } from './api.js';
import { state, load } from './state.js';
import { allGroups } from './filters.js';
import { renderTable, expandableIds } from './table.js';
import { renderTimeline } from './timeline.js';
import { renderMatrix } from './matrix.js';
import { renderSettings } from './settings.js';
import { renderSearch, applyPreset, newStatus, typeAllowed, restoreFilters, persistFilters } from './search.js';
import { el, toast, contrastText } from './util.js';
import { beginNew, discardNew, draft } from './cells.js';
import { prefs } from './prefs.js';
import { renderSortMenu, normalizeSort, SORT_COLUMNS } from './sort.js';
import { renderColumnsMenu, normalizeHidden } from './columns.js';
import { icon, keyGlyph } from './icons.js';
import { renderColorsMenu } from './colors.js';
import { startRealtime } from './realtime.js';
import { renderScratch } from './scratch.js';

const main = document.getElementById('main');
const toolbar = document.getElementById('toolbar');
const settingsBtn = document.getElementById('btn-settings');
const accountSlot = document.getElementById('account');

const VIEWS = ['table', 'timeline', 'matrix'];

// The title bar's height as a CSS variable, so sticky things (the table
// header row, the Matrix panel, the scratch pad) can sit just beneath it
// whatever the toolbar wraps to.
const topbar = document.querySelector('.topbar');
function syncTopbarHeight() { document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`); }
new ResizeObserver(syncTopbarHeight).observe(topbar);
syncTopbarHeight();

/** True while an edit is in progress on the planner page: an unsaved new
 *  row, or an open text editor (title, date, description) on a saved row.
 *  Pickers (owner, assignee, status) do not count: closing them loses
 *  nothing. Navigation and remote refreshes wait for it to finish. */
export function isEditing() {
  if (draft.item) return true;
  return !!main.querySelector('.row[data-id] .title-input, .row[data-id] .date-input, .row[data-desc-for] .desc-textarea');
}
const LEGACY_FILTER_ROUTES = { active: 'active', backlog: 'backlog', ideas: 'ideas', all: 'all', everything: 'all', home: 'active' };

// UI state for the planner page that is not a preference: open detail rows
// and the search filter function, which survive re-renders.
const ui = { expanded: new Set(), searchFilter: null };

// Preferences read fresh on every render (they change with the account).
const view = () => (VIEWS.includes(prefs.get('view')) ? prefs.get('view') : 'table');
const flag = (key) => prefs.get(key) === '1';
const collapsedSet = () => new Set((prefs.getJSON('collapsed') || []).map(Number));

// A filter route (#/active, #/backlog, #/ideas, #/all) applies its template
// once, when first seen; the hash is kept so a reload returns to that view.
let appliedRoute = null;
function route() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (hash === 'settings' || hash === 'users') return { page: 'settings' };
  if (Object.prototype.hasOwnProperty.call(LEGACY_FILTER_ROUTES, hash) && hash !== appliedRoute) {
    applyPreset(LEGACY_FILTER_ROUTES[hash]);
    persistFilters();
    appliedRoute = hash;
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
  let prefsLoaded = !accountLoaded; // filters are restored once, when the preferences first load
  try {
    prefsLoaded = (await syncAccount()) || prefsLoaded;
  } catch (e) {
    // The items are there; fall back to this browser's preferences.
    toast(`Could not load your preferences: ${e.message}`);
    await prefs.load(null);
    accountLoaded = true;
    prefsLoaded = true;
  }
  if (prefsLoaded) restoreFilters();
  applySettings();
  render();
}

// The account is the remembered user when it still exists (users can be
// deleted in Settings), otherwise the first listed user; with no users the
// browser's own preferences apply. A browser told to keep to itself
// (prefs.rememberedAccount() === null) stays that way.
let accountLoaded = false;
/** Returns true when the preferences were (re)loaded. */
async function syncAccount() {
  const wanted = accountLoaded && prefs.account != null ? prefs.account : prefs.rememberedAccount();
  let valid = null;
  if (wanted != null && state.usersById.has(wanted)) valid = wanted;
  else if (wanted !== null) valid = state.users.length ? state.users[0].id : null;
  const load = !accountLoaded || valid !== prefs.account;
  if (load) await prefs.load(valid);
  accountLoaded = true;
  return load;
}

async function switchAccount(id) {
  try {
    await prefs.load(id);
  } catch (e) {
    toast(`Could not load preferences: ${e.message}`);
    await prefs.load(null);
  }
  restoreFilters(); // the filter settings follow the account too
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
    if (!beginNew({ type, status: newStatus() })) return;
    // Flat has no parent rows, so a new Ongoing/Project could not be seen there.
    if (flag('flat')) { prefs.set('flat', '0'); toast('Flat turned off to show the new row'); }
    render();
  },
  onAddTask(parent) {
    const collapsed = collapsedSet();
    if (collapsed.delete(parent.id)) prefs.set('collapsed', [...collapsed]); // the new row must be visible
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

/** The far right of the title bar: the version badge and the account menu
 *  (who is using this browser; preferences follow the account). The menu
 *  lists the users only; with none yet it is disabled with a placeholder. */
function renderAccount() {
  const current = prefs.account;
  const u = current != null ? state.usersById.get(current) : null;
  const noUsers = !state.users.length;
  const sel = el('select', {
    id: 'account-select', class: 'account-select', 'aria-label': 'Account', disabled: noUsers ? true : null,
    title: u ? `${u.name}: your view, sort and layout preferences are saved to this account and follow you to any browser`
      : noUsers ? 'No users yet: add people under Settings and your preferences will follow you to any browser'
        : 'Pick who you are: your view, sort and layout preferences follow you to any browser',
    onChange: () => { if (sel.value) switchAccount(Number(sel.value)); },
  });
  // A placeholder only while nobody is current (no users, or a browser that keeps to itself).
  if (!u) sel.append(el('option', { value: '', selected: true, hidden: noUsers ? null : true }, noUsers ? 'No users' : 'This browser'));
  for (const x of state.users) sel.append(el('option', { value: String(x.id), selected: current === x.id ? true : null }, x.name));
  if (u) Object.assign(sel.style, { background: u.color, color: contrastText(u.color), borderColor: u.color });
  accountSlot.replaceChildren(versionBadge(), sel);
}

settingsBtn.addEventListener('click', () => { location.hash = '#/settings'; });

function render() {
  const r = route();
  renderAccount();
  renderScratch({ account: prefs.account, page: r.page });
  settingsBtn.classList.toggle('active', r.page === 'settings');
  if (r.page === 'settings') {
    toolbar.replaceChildren(
      el('button', { type: 'button', id: 'btn-back', title: 'Back to the items', 'aria-label': 'Back to the items', onClick: () => { location.hash = '#/'; } }, icon('back')),
      el('div', { class: 'spacer' }));
    renderSettings(main, { reload });
    return;
  }

  const currentView = view();
  const flat = flag('flat');
  const narrow = flag('narrow');
  const collapsed = collapsedSet();
  // The "Ongoing / Project" column only exists in Flat; a stored sort on it
  // is set aside (not forgotten) while Flat is off.
  const storedSort = normalizeSort(prefs.getJSON('sort'));
  const setAside = (k) => !flat && SORT_COLUMNS[k.key].flatOnly;
  const sort = storedSort.filter((k) => !setAside(k));
  // A change to the visible sort columns keeps the set-aside ones in their
  // place (so removing the last visible column does not wipe them);
  // "User-defined" in the Sort menu clears everything.
  const mergeSort = (keys) => {
    const byKey = new Map(keys.map((k) => [k.key, k]));
    const out = [];
    for (const s of storedSort) {
      if (setAside(s)) out.push(s);
      else if (byKey.has(s.key)) { out.push(byKey.get(s.key)); byKey.delete(s.key); }
    }
    for (const k of keys) if (byKey.has(k.key)) out.push(k);
    return out;
  };
  const blockedLast = flag('blocked_last');
  const hidden = normalizeHidden(prefs.getJSON('hidden_cols'));

  // ---- toolbar ----
  toolbar.replaceChildren();
  // New Ongoing is greyed out (not hidden) while the type filter would hide a new one.
  const ongoingOk = typeAllowed('ongoing');
  toolbar.append(el('button', {
    class: 'primary', type: 'button', id: 'btn-new-ongoing', disabled: ongoingOk ? null : true, 'aria-label': 'New Ongoing',
    title: ongoingOk ? 'New Ongoing: a bucket for recurring work (key N-…)' : 'The current type filter hides Ongoing items; clear it to add one',
    onClick: () => actions.onNew('ongoing'),
  }, keyGlyph('N')));
  toolbar.append(el('button', { class: 'primary', type: 'button', id: 'btn-new-project', 'aria-label': 'New Project', title: 'New Project: work with a start and an end (key P-…)', onClick: () => actions.onNew('project') }, keyGlyph('P')));

  toolbar.append(
    el('button', { type: 'button', id: 'btn-expand-all', 'aria-label': 'Expand all', title: 'Expand every row (descriptions, dependencies and attachments)', onClick: () => { for (const id of expandableIds(currentGroups)) ui.expanded.add(id); render(); } }, icon('expand-all')),
    el('button', { type: 'button', id: 'btn-collapse-all', 'aria-label': 'Collapse all', title: 'Collapse every row', onClick: () => { ui.expanded.clear(); render(); } }, icon('collapse-all')),
  );
  // Show / hide the tasks of every Ongoing and Project (the carets on the
  // parent rows). The preference covers every live parent, not just the
  // filtered ones, so it stays consistent as the filters change.
  const parentIds = () => state.items.filter((it) => it.parent_id == null).map((it) => it.id);
  toolbar.append(
    el('button', {
      type: 'button', id: 'btn-expand-parents', 'aria-label': 'Expand all parents', disabled: flat ? true : null,
      title: flat ? 'Flat has no Ongoing or Project rows to expand' : 'Show the tasks of every Ongoing and Project',
      onClick: () => { prefs.set('collapsed', []); render(); },
    }, icon('expand-parents')),
    el('button', {
      type: 'button', id: 'btn-collapse-parents', 'aria-label': 'Collapse all parents', disabled: flat ? true : null,
      title: flat ? 'Flat has no Ongoing or Project rows to collapse' : 'Hide the tasks of every Ongoing and Project',
      onClick: () => { prefs.set('collapsed', parentIds()); render(); },
    }, icon('collapse-parents')),
  );

  const searchSlot = el('div', { class: 'search-slot' });
  toolbar.append(searchSlot);
  toolbar.append(el('div', { class: 'spacer' }));

  // Sort menu: the current column order (headers add to it) and the
  // user-defined option; also "blocked items last".
  const sortSlot = el('div', { class: 'sort-slot' });
  toolbar.append(sortSlot);
  const sortCtx = {
    sort, blockedLast, flat,
    setSort: (keys, all = false) => { prefs.set('sort', all ? keys : mergeSort(keys)); render(); },
    setBlockedLast: (on) => { prefs.set('blocked_last', on ? '1' : '0'); render(); },
  };
  renderSortMenu(sortSlot, sortCtx);

  // Columns menu: which table columns show. Always present (disabled outside
  // the Table view, like Narrow) so the toolbar keeps its shape.
  const tableView = currentView === 'table';
  const columnsSlot = el('div', { class: 'columns-slot' });
  toolbar.append(columnsSlot);
  renderColumnsMenu(columnsSlot, {
    hidden, flat, enabled: tableView,
    setHidden: (names) => { prefs.set('hidden_cols', names); render(); },
  });

  // Colours menu: how rows are tinted (the items' own colours or the type
  // colours; tasks in their parent's colour or not).
  const colorsSlot = el('div', { class: 'colors-slot' });
  toolbar.append(colorsSlot);
  renderColorsMenu(colorsSlot, {
    parentColors: prefs.get('parent_colors'), taskColors: prefs.get('task_colors'),
    setParentColors: (mode) => { prefs.set('parent_colors', mode); render(); },
    setTaskColors: (mode) => { prefs.set('task_colors', mode); render(); },
  });

  // Two-way choices as icon groups, like the view switch: Nested | Flat and
  // Wide | Narrow (the width only applies to the Table view).
  const pair = (label, choices, current, enabled, onPick) => {
    const g = el('div', { class: 'group', role: 'group', 'aria-label': label });
    for (const [value, id, name, hint] of choices) {
      const on = current === value;
      g.append(el('button', {
        type: 'button', id, class: on && enabled ? 'active' : '', disabled: enabled ? null : true,
        'aria-pressed': on ? 'true' : 'false', 'aria-label': name, title: hint, dataset: { [label.toLowerCase()]: value },
        onClick: () => { if (!on) onPick(value); },
      }, icon(value)));
    }
    return g;
  };
  toolbar.append(pair('Layout', [
    ['nested', 'btn-nested', 'Nested', 'Nested: Ongoing and Project rows with their tasks beneath them'],
    ['flat', 'btn-flat', 'Flat', 'Flat: tasks only, with their Ongoing/Project as columns'],
  ], flat ? 'flat' : 'nested', true, (v) => { prefs.set('flat', v === 'flat' ? '1' : '0'); render(); }));
  toolbar.append(pair('Width', [
    ['wide', 'btn-wide', 'Wide', tableView ? 'Wide: the table uses the full width of the window' : 'Width applies to the Table view'],
    ['narrow', 'btn-narrow', 'Narrow', tableView ? 'Narrow: constrain the table width on wide screens' : 'Width applies to the Table view'],
  ], narrow ? 'narrow' : 'wide', tableView, (v) => { prefs.set('narrow', v === 'narrow' ? '1' : '0'); render(); }));

  const VIEW_HINT = { table: 'Table: every column, editable in place', timeline: 'Timeline: a Gantt chart beside the titles', matrix: 'Matrix: tasks plotted by urgency and importance' };
  const group = el('div', { class: 'group', role: 'group', 'aria-label': 'View' });
  for (const v of VIEWS) {
    group.append(el('button', {
      type: 'button', class: currentView === v ? 'active' : '', dataset: { view: v }, 'aria-pressed': currentView === v ? 'true' : 'false',
      'aria-label': v[0].toUpperCase() + v.slice(1), title: VIEW_HINT[v],
      onClick: () => { prefs.set('view', v); render(); },
    }, icon(v)));
  }
  toolbar.append(group);

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

  const tableOpts = {
    groups: currentGroups, expanded: ui.expanded, actions, collapsed, flat, sort, blockedLast, hidden,
    onCollapse: () => prefs.set('collapsed', [...collapsed]),
    onSort: sortCtx.setSort,
  };
  if (currentView === 'table') {
    const wrap = el('div', { class: `table-wrap ${narrow ? 'constrained' : ''}` });
    main.replaceChildren(...[hint, wrap].filter(Boolean));
    renderTable(wrap, { ...tableOpts, mode: 'full' });
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    // The Matrix stays in view while the list scrolls (the Timeline's bars
    // are aligned to the rows, so it scrolls with them).
    const panel = el('div', { class: `panel${currentView === 'matrix' ? ' sticky' : ''}`, id: 'panel' });
    main.replaceChildren(el('div', { class: 'split' }, wrap, panel));
    const draw = (handle) => {
      const ctx = {
        rerender: render, onChanged: reload,
        // Timeline bar colouring (a preference): assignee | owner | importance | urgency | combo | parent.
        barColor: prefs.get('bar_color'),
        setBarColor: (mode) => { prefs.set('bar_color', mode); render(); },
        // Matrix point colouring (a preference): assignee | owner | parent.
        pointColor: prefs.get('point_color'),
        setPointColor: (mode) => { prefs.set('point_color', mode); render(); },
        // Matrix point labels (a preference): key | title.
        labelMode: prefs.get('matrix_labels'),
        setLabelMode: (mode) => { prefs.set('matrix_labels', mode); render(); },
      };
      if (currentView === 'timeline') renderTimeline(panel, handle, ctx);
      else renderMatrix(panel, handle, ctx);
    };
    renderTable(wrap, { ...tableOpts, mode: 'title-only', onRendered: draw });
  }
}

// Ctrl+Z / Cmd+Z undoes the last change made in this browser session, unless
// the focus is in a text field (where the browser's own undo applies).
document.addEventListener('keydown', async (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  const a = document.activeElement;
  const textual = a && (a.tagName === 'TEXTAREA' || a.isContentEditable
    || (a.tagName === 'INPUT' && ['text', 'search', 'number', 'date', 'color'].includes(a.type)));
  if (textual) return;
  e.preventDefault();
  try {
    const label = await undo();
    if (!label) { toast('Nothing to undo'); return; }
    toast(`Undid ${label}`);
    await reload();
  } catch (err) {
    toast(`Undo failed: ${err.message}`);
    await reload();
  }
});

// In-app navigation (the gear, a filter route) waits for an edit in progress:
// the hash is put back and a snack says how to finish. Putting it back fires
// a second hashchange, which is ignored (it would otherwise be refused too).
const EDIT_IN_PROGRESS = 'Finish (Enter) or discard (Escape) the edit first';
let restoringHash = null;
window.addEventListener('hashchange', (e) => {
  if (restoringHash != null && location.hash === restoringHash) { restoringHash = null; return; }
  restoringHash = null;
  if (isEditing()) {
    toast(EDIT_IN_PROGRESS);
    restoringHash = new URL(e.oldURL).hash;
    location.hash = restoringHash;
    return;
  }
  discardNew();
  render();
});
// Leaving the page (reload, close, another site) asks first while editing.
window.addEventListener('beforeunload', (e) => {
  if (!isEditing()) return;
  e.preventDefault();
  e.returnValue = EDIT_IN_PROGRESS; // older browsers want a string; the text itself is not shown
});
reload();
// Changes made elsewhere (another browser, the Android app) arrive as server
// events; the page reloads itself once no edit is in progress here.
startRealtime({ reload, busy: isEditing });
