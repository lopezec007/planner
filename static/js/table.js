// Hierarchical table renderer.
//
// renderTable(container, opts) renders the groups into container and returns
// a handle: { rows: [{ item, el, kind }], rerender() }.
//
//   opts.groups    [{ parent, tasks }] from filters.js (user-defined order)
//   opts.mode      'full' | 'title-only'   (title-only is used beside Timeline/Matrix)
//   opts.expanded  Set<number> of item ids whose detail row is open
//                  (owned by the caller so it survives re-renders)
//   opts.actions   { onDelete(item), onAddTask(parent), onChanged() } — optional.
//                  onChanged() reloads data after any save or reorder.
//   opts.collapsed Set<number> of parent ids whose tasks are hidden (caller-owned)
//   opts.onCollapse(parentId, collapsed)  called when the caret is clicked
//   opts.flat      true: no parent rows; each task row carries its parent's
//                  key and title in extra leading columns
//   opts.sort      [{ key, dir }] column sort (see sort.js); [] = user-defined
//   opts.blockedLast  true: blocked items sink to the bottom of their group
//   opts.onSort(sort)  called when a column header is clicked
//   opts.hidden    Set of hidden column names (see columns.js)
//
// Every field is edited in place (see cells.js): there is no edit mode. A
// single unsaved "new row" (cells.draft) is rendered where it will live and
// created once it has a title. Rows carry data-id / data-kind / data-type
// (tasks also data-parent) so side panels (Timeline) can align to them; a new
// row carries data-editing="new" and no id.
//
// Columns: the visible columns (columns.js) decide the grid template, set on
// the table element, and every row appends only those cells in that order.
//
// Ordering: with no column sort and "blocked last" off, rows follow the
// user-defined order (sort_order) and can be dragged. Otherwise parents are
// sorted among themselves and tasks within each parent (in Flat, all tasks
// together), ties keeping the user-defined order, and dragging is disabled
// because the positions no longer mean anything.
//
// Columns, left to right: the parent collapse caret (shows or hides a
// parent's tasks; empty on task rows; absent in Flat), the key, the title...
// and the actions cell: the details caret (opens the description,
// dependencies, attachments and, for parents, the colour), "+" (add a task,
// parents), "move" (tasks), Delete, and the drag handle. In title-only mode
// there is no actions column: the details caret sits at the right end of the
// title cell, always visible, before the hover-revealed buttons.
//
// Reordering: every saved row has a drag handle at the right end of its
// actions. Top-level rows can be dropped among top-level rows; tasks among any parent's tasks or
// onto a parent row (which reparents them). In Flat there are no parent rows
// to show where one parent ends and the next begins, so a task can only be
// dropped among the tasks of its own parent and never changes parent there.
// The full sibling list (from state, including siblings hidden by the page's
// filter) is sent to api.reorder so hidden siblings keep their positions.

import { state, isClosed, isBlocked } from './state.js';
import { api, group } from './api.js';
import { el, contrastText, toast } from './util.js';
import {
  draft, discardNew, commitNew, isDraft, makeSaver, closeOnOutsidePointer,
  titleControl, statusControl, userControl, dateControl, levelControl, blockedControl,
  descriptionControl, dependencyPanel, attachmentsPanel, attachmentBadge,
} from './cells.js';
import { SORT_COLUMNS, normalizeSort, compareItems, toggleSort, defaultDir } from './sort.js';
import { visibleColumns, gridTemplate } from './columns.js';
import { rowTint } from './colors.js';
import { colorSwatch, colorLabel } from './swatch.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';

export function userChip(id) {
  if (id == null) return '';
  const u = state.usersById.get(id);
  if (!u) return el('span', { class: 'chip' }, `#${id}`);
  return el('span', { class: 'chip', style: { background: u.color, color: contrastText(u.color) }, title: u.name }, u.short || u.name);
}

/** Every row can be expanded: the description is edited there (and, for
 *  projects and tasks, the dependencies). */
export function isExpandable() {
  return true;
}

/** The details caret (a `.toggle` wrapper around the button): opens the
 *  description, dependencies, attachments and colour under the row. Null
 *  for a new row, whose details are always open. */
function detailsToggle(item, expanded, onToggle) {
  if (!isExpandable(item) || isDraft(item)) return null;
  const what = item.type === 'task' ? 'description, dependencies and attachments' : 'description, attachments and colour';
  return el('span', { class: 'toggle' }, el('button', {
    type: 'button',
    title: expanded ? 'Collapse' : `Expand (${what})`,
    'aria-expanded': expanded ? 'true' : 'false',
    onClick: (e) => { e.stopPropagation(); onToggle(item); },
  }));
}

/** A square icon-only button; the words live in title and aria-label. */
function iconButton(name, attrs) {
  return el('button', { type: 'button', ...attrs, class: `icon ${attrs.class || ''}` }, icon(name));
}

/** "Move to another Ongoing/Project": the button becomes a dropdown of the
 *  other parents; picking one reparents the task (it goes last there). */
function reparentButton(item, ctx) {
  const btn = iconButton('move', { class: 'reparent', title: 'Move to another Ongoing or Project', 'aria-label': `Move ${item.key} to another Ongoing or Project` });
  btn.addEventListener('click', () => {
    const sel = el('select', { class: 'cell-select reparent-select', name: 'reparent', 'aria-label': 'Move to' }, el('option', { value: '' }, 'Move to…'));
    for (const p of state.items) {
      if (p.type === 'task' || p.id === item.parent_id) continue;
      sel.append(el('option', { value: String(p.id) }, `${p.key} ${p.title}`));
    }
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      stopOutside();
      const v = sel.value ? Number(sel.value) : null;
      if (!save || v == null) { sel.replaceWith(btn); return; }
      try {
        // One undo step: back to the old parent and back into its old place.
        await group(`moving ${item.key}`, async () => {
          api.rememberOrder(item.parent_id);
          await api.updateItem(item.id, { parent_id: v });
        });
        await ctx.onChanged();
      } catch (e) {
        toast(e.message);
        sel.replaceWith(btn);
      }
    };
    sel.addEventListener('change', () => finish(true));
    sel.addEventListener('blur', () => finish(false));
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    const stopOutside = closeOnOutsidePointer(sel, () => finish(false));
    btn.replaceWith(sel);
    sel.focus();
    try { sel.showPicker?.(); } catch {}
  });
  return btn;
}

/** The actions cell: [details caret] [+ add task | move] [Delete] [drag
 *  handle]. In title-only mode the caret is placed outside this cell (it
 *  must not fade with the buttons), so `withToggle` is false there. */
function actionButtons(item, ctx, { expanded = false, withToggle = true } = {}) {
  const cell = el('div', { class: 'actions' });
  if (isDraft(item)) {
    cell.append(
      iconButton('check', { class: 'primary', title: 'Save', 'aria-label': 'Save', onClick: () => commitNew(ctx) }),
      iconButton('cross', { title: 'Discard', 'aria-label': 'Discard', onClick: () => { discardNew(); ctx.rerender(); } }),
    );
    return cell;
  }
  const toggle = withToggle ? detailsToggle(item, expanded, ctx.onToggle) : null;
  if (toggle) cell.append(toggle);
  const { actions } = ctx;
  if (actions) {
    if (item.type !== 'task' && actions.onAddTask) {
      cell.append(iconButton('plus', { title: 'Add task', 'aria-label': `Add a task to ${item.key}`, onClick: () => actions.onAddTask(item) }));
    }
    if (item.type === 'task') cell.append(reparentButton(item, ctx));
    if (actions.onDelete) {
      cell.append(iconButton('trash', { title: 'Delete', 'aria-label': `Delete ${item.key}`, onClick: () => actions.onDelete(item) }));
    }
  }
  cell.append(dragHandle(ctx));
  return cell;
}

/** A header cell that sorts by `key` when clicked: shows the direction and,
 *  with several sort columns, its position in the order (a tiny badge right
 *  under the arrow, so narrow columns are neither widened nor clipped). */
function sortHeader(key, label, ctx, extraClass = '') {
  const keys = normalizeSort(ctx.sort);
  const i = keys.findIndex((s) => s.key === key);
  const active = i >= 0;
  const dir = active ? keys[i].dir : null;
  const name = SORT_COLUMNS[key].label;
  const word = (d) => (d === 'asc' ? 'ascending' : 'descending');
  const first = defaultDir(key);
  const cell = el('div', {
    class: `sortable ${extraClass} ${active ? 'sorted' : ''}`, role: 'columnheader', tabindex: '0',
    dataset: { sort: key },
    'aria-sort': active ? word(dir) : 'none',
    title: active
      ? (dir === first ? `Sorted by ${name} ${word(dir)}: click for ${word(dir === 'asc' ? 'desc' : 'asc')}` : `Sorted by ${name} ${word(dir)}: click to stop sorting by it`)
      : `Sort by ${name}, ${word(first)} first${keys.length ? ' (after the current sort columns)' : ''}`,
  }, el('span', { class: 'sort-label' }, label));
  if (active) {
    const arrow = el('span', { class: 'sort-arrow', 'aria-hidden': 'true' }, el('span', { class: 'sort-glyph' }, dir === 'asc' ? '↑' : '↓'));
    if (keys.length > 1) arrow.append(el('span', { class: 'sort-index' }, String(i + 1)));
    cell.append(arrow);
  }
  const click = () => {
    if (!ctx.onSort) return;
    const hadFocus = document.activeElement === cell;
    ctx.onSort(toggleSort(ctx.sort, key)); // re-renders the table
    if (hadFocus) document.querySelector(`.row.header [data-sort="${key}"]`)?.focus();
  };
  cell.addEventListener('click', click);
  cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
  return cell;
}

/** Header cells by column name (see columns.js for the order). */
function headerCells(ctx) {
  const h = (key, label, cls) => sortHeader(key, label, ctx, cls);
  return {
    collapse: el('div', { class: 'collapse-cell' }),
    pkey: el('div', { class: 'key' }),
    key: h('key', 'Key', 'key'),
    ptitle: h('parent', 'Ongoing / Project', 'parent-ref'),
    title: h('title', ctx.flat ? 'Task' : 'Title'),
    status: h('status', 'Status'),
    owner: h('owner', 'Owner'),
    assignee: h('assignee', 'Assignee'),
    start: h('start', 'Start'),
    end: h('end', 'End'),
    urgency: (() => { const c = h('urgency', 'Urg', 'num'); c.title = `Urgency. ${c.title}`; return c; })(),
    importance: (() => { const c = h('importance', 'Imp', 'num'); c.title = `Importance. ${c.title}`; return c; })(),
    blocked: h('blocked', 'Blocked', 'blocked-cell'),
    actions: el('div'),
  };
}

function headerRow(ctx) {
  const cells = headerCells(ctx);
  return el('div', { class: 'row header' }, ...ctx.columns.map((n) => cells[n]));
}

function rowClasses(item, kind, expanded) {
  const cls = ['row', kind];
  if (isDraft(item)) cls.push('new');
  else if (isBlocked(item)) cls.push('blocked');
  if (isClosed(item.status)) cls.push('closed');
  if (expanded) cls.push('expanded');
  return cls.join(' ');
}

function dragHandle(ctx) {
  if (ctx.sorting) {
    return el('span', { class: 'drag-handle disabled', title: 'Rows cannot be dragged while sorted by a column or with blocked items last; choose User-defined in the Sort menu to reorder', 'aria-hidden': 'true' }, icon('grip'));
  }
  return el('span', { class: 'drag-handle', title: 'Drag to reorder', draggable: 'true', 'aria-label': 'Drag to reorder' }, icon('grip'));
}

function keyCell(item) {
  if (isDraft(item)) {
    const prefix = item.type === 'ongoing' ? 'N' : item.type === 'project' ? 'P' : 'T';
    return el('div', { class: 'key' }, el('span', { class: 'key-text new-key' }, `${prefix}-?`));
  }
  return el('div', { class: 'key' }, el('span', { class: 'key-text' }, item.key));
}

/** How many of a parent's tasks this table shows (opts.groups, after the
 *  filters) and how many it has in all. */
function taskCounts(item, ctx) {
  return { shown: ctx.shown.get(item.id) ?? 0, total: (state.childrenOf.get(item.id) || []).length };
}

/** The first column: the caret that shows or hides a parent's tasks. Empty
 *  on task rows and new rows. */
function collapseCell(item, kind, ctx) {
  const cell = el('div', { class: 'collapse-cell' });
  if (kind !== 'parent' || isDraft(item)) return cell;
  const { shown } = taskCounts(item, ctx);
  const isCollapsed = ctx.collapsed.has(item.id);
  cell.append(el('button', {
    type: 'button', class: 'caret', title: isCollapsed ? `Show ${shown} task(s)` : 'Hide tasks',
    'aria-expanded': isCollapsed ? 'false' : 'true', 'aria-label': isCollapsed ? 'Show tasks' : 'Hide tasks',
    dataset: { collapse: item.id },
    onClick: (e) => { e.stopPropagation(); ctx.onCollapse(item.id, !isCollapsed); },
  }));
  return cell;
}

/** "(n)" after a collapsed parent's title: the tasks hidden by the caret,
 *  counted as this table shows them; the tooltip says when the filters hide
 *  more of them. Null when there is nothing to count. */
function taskCount(item, ctx) {
  const { shown, total } = taskCounts(item, ctx);
  if (!shown && !total) return null;
  let title = `${shown} hidden task(s)`;
  if (shown !== total) title += ` (${total - shown} of ${total} hidden by the filters)`;
  return el('span', { class: 'task-count', title }, `(${shown})`);
}

// In the title-only table there is no actions column, so the details caret
// and then the action buttons sit at the right of the title cell (the
// buttons revealed on hover, see edit.css).
function titleCell(item, mode, ctx, saver, kind, expanded) {
  const cell = el('div', { class: 'title' });
  cell.append(titleControl(item, saver, ctx));
  if (kind === 'parent' && !isDraft(item) && ctx.collapsed.has(item.id)) {
    const count = taskCount(item, ctx);
    if (count) cell.append(count);
  }
  if (!isDraft(item)) {
    const badge = attachmentBadge(item, () => ctx.onToggle(item));
    if (badge) cell.append(badge);
  }
  if (mode !== 'full') {
    const toggle = detailsToggle(item, expanded, ctx.onToggle);
    if (toggle) cell.append(toggle);
    cell.append(actionButtons(item, ctx, { withToggle: false }));
  }
  return cell;
}

/** One row for either kind; parents simply leave the task-only cells empty.
 *  In flat mode a task row starts with its parent's key and title. Only the
 *  visible columns are built. */
function itemRow(item, kind, mode, expanded, ctx) {
  const saver = makeSaver(item, ctx);
  const dataset = { kind, type: item.type };
  if (isDraft(item)) dataset.editing = 'new';
  else dataset.id = item.id;
  if (kind === 'task' && item.parent_id != null) dataset.parent = item.parent_id;
  const row = el('div', { class: rowClasses(item, kind, expanded) + (ctx.collapsed.has(item.id) ? ' collapsed' : ''), dataset });
  // Row tint: a parent's own colour, or the parent's colour on a task row
  // when that preference is on (colors.js); otherwise the stylesheet's type tint.
  const tint = rowTint(item, kind);
  if (tint) row.style.setProperty('--row-color', tint);
  const parent = ctx.flat && item.parent_id != null ? state.itemsById.get(item.parent_id) : null;
  const build = {
    collapse: () => collapseCell(item, kind, ctx),
    pkey: () => el('div', { class: 'key parent-ref' }, parent ? parent.key : ''),
    key: () => keyCell(item),
    ptitle: () => el('div', { class: 'title parent-ref', title: parent ? `${parent.key} ${parent.title}` : '' }, parent ? parent.title : ''),
    title: () => titleCell(item, mode, ctx, saver, kind, expanded),
    status: () => statusControl(item, saver),
    owner: () => userControl(item, 'owner_id', saver),
    assignee: () => userControl(item, 'assignee_id', saver),
    start: () => dateControl(item, 'start', saver),
    end: () => dateControl(item, 'end', saver, { highlight: true }),
    urgency: () => levelControl(item, 'urgency', saver),
    importance: () => levelControl(item, 'importance', saver),
    blocked: () => blockedControl(item, saver),
    actions: () => actionButtons(item, ctx, { expanded }),
  };
  for (const n of ctx.columns) row.append(build[n]());
  return row;
}

/** The "Colour" box of an Ongoing's or Project's details: the swatch that
 *  picks its colour (see swatch.js) and the colour's hex, or the type's
 *  name when it has none of its own. */
function colorBlock(item, saver) {
  return el('div', { class: 'color-block', dataset: { colorBlock: item.id } },
    el('span', { class: 'color-label' }, 'Colour'),
    colorSwatch(item, saver),
    el('span', { class: `color-hex${item.color ? ' own' : ''}` }, colorLabel(item)));
}

/** The expanded detail row: the description under the title column; the
 *  dependencies, attachments and (for parents) the colour under the
 *  remaining columns (or below, in title-only mode). It carries its item
 *  row's tint (see app.css). */
function detailRow(item, kind, ctx) {
  const saver = makeSaver(item, ctx);
  const deps = dependencyPanel(item, ctx);
  const files = attachmentsPanel(item, ctx);
  const colour = item.type !== 'task' && !isDraft(item) ? colorBlock(item, saver) : null;
  const dataset = isDraft(item) ? { editing: 'new' } : { descFor: item.id };
  // Same grid as the item row. Not given the kind class itself, so
  // `.row.task` / `.row.parent` only ever match item rows (detail rows
  // contain other items' titles).
  const titleCol = ctx.columns.indexOf('title') + 1; // 1-based grid line
  const row = el('div', { class: `row description kind-${kind}${isDraft(item) ? ' new' : ''}`, dataset });
  const tint = rowTint(item, kind);
  if (tint) row.style.setProperty('--row-color', tint);
  for (let i = 1; i < titleCol; i++) row.append(el('div'));
  row.append(el('div', { class: 'title' }, descriptionControl(item, saver)));
  if (deps || files || colour) {
    // Full table: to the right of the description. Title-only: the title is
    // the last column, so the side panel wraps onto its own line below.
    const from = ctx.mode === 'full' ? titleCol + 1 : titleCol;
    row.append(el('div', { class: 'deps-cell', style: { gridColumn: `${from} / -1` } }, deps, files, colour));
  }
  return row;
}

/** Remember which control has focus so a re-render can give it back. */
function captureFocus(container) {
  const a = document.activeElement;
  if (!a || !container.contains(a) || !a.name) return null;
  const rowEl = a.closest('.row');
  if (!rowEl) return null;
  const id = rowEl.dataset.id || rowEl.dataset.descFor || (rowEl.dataset.editing ? 'new' : null);
  if (!id) return null;
  const sel = typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  return { id, name: a.name, sel };
}

function restoreFocus(container, f) {
  if (!f) return;
  const rowSel = f.id === 'new' ? '.row[data-editing="new"]' : `.row[data-id="${f.id}"], .row[data-desc-for="${f.id}"]`;
  const target = container.querySelector(`${rowSel} [name="${f.name}"]`);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (f.sel && typeof target.setSelectionRange === 'function') {
    try { target.setSelectionRange(f.sel[0], f.sel[1]); } catch {}
  }
}

/** Apply the column sort and "blocked last" to the groups. Returns
 *  { groups, flatTasks, grouped }: `flatTasks` is the single list shown in
 *  Flat, `grouped` whether consecutive tasks there still share a parent. */
function orderGroups(groups, sort, blockedLast, flat) {
  const keys = normalizeSort(sort);
  const sorting = keys.length > 0 || blockedLast;
  if (!sorting) {
    return { groups, flatTasks: groups.flatMap((g) => g.tasks), grouped: true, sorting };
  }
  const cmp = compareItems(keys, blockedLast);
  const ordered = groups.map((g) => ({ parent: g.parent, tasks: [...g.tasks].sort(cmp) })).sort((a, b) => cmp(a.parent, b.parent));
  let flatTasks = ordered.flatMap((g) => g.tasks);
  // In Flat every task takes part in one sort; the parent column (the first
  // sort key or no sort) is what keeps tasks grouped by parent.
  if (flat) flatTasks = flatTasks.sort(cmp);
  const grouped = !blockedLast && (!keys.length || keys[0].key === 'parent');
  return { groups: ordered, flatTasks, grouped, sorting };
}

export function renderTable(container, opts) {
  const { groups, mode = 'full', expanded = new Set(), actions, collapsed = new Set(), flat = false, sort = [], blockedLast = false, hidden = new Set() } = opts;
  const handle = { rows: [], rerender: () => renderTable(container, opts) };
  const order = orderGroups(groups, sort, blockedLast, flat);
  const columns = visibleColumns(mode, flat, hidden);

  // Tints: when tasks take their parent's colour, parents and tasks mix it
  // in clearly different amounts (see app.css --tint-parent / --tint-task).
  document.body.classList.toggle('tasks-by-parent', prefs.get('task_colors') === 'parent');

  const ctx = {
    actions,
    collapsed,
    shown: new Map(groups.map((g) => [g.parent.id, g.tasks.length])), // tasks per parent after the filters
    flat,
    mode,
    columns,
    sort,
    sorting: order.sorting,
    onSort: opts.onSort,
    rerender: () => handle.rerender(),
    onChanged: async () => { if (actions?.onChanged) await actions.onChanged(); else handle.rerender(); },
    onToggle: (item) => {
      if (expanded.has(item.id)) expanded.delete(item.id); else expanded.add(item.id);
      handle.rerender();
    },
    onCollapse: (id, isCollapsed) => {
      if (isCollapsed) collapsed.add(id); else collapsed.delete(id);
      if (opts.onCollapse) opts.onCollapse(id, isCollapsed);
      handle.rerender();
    },
  };

  // A new task row only makes sense under a parent shown on this page.
  if (draft.item && draft.item.type === 'task' && !groups.some((g) => g.parent.id === draft.item.parent_id)) discardNew();

  const table = el('div', {
    class: `table ${mode === 'title-only' ? 'title-only' : ''} ${flat ? 'flat' : ''} ${order.sorting ? 'sorted' : ''}`,
    dataset: { columns: columns.join(' ') },
  });
  table.style.setProperty('--cols', gridTemplate(columns, mode, flat));
  table.append(headerRow(ctx));

  if (!groups.length && !draft.item) {
    table.append(el('div', { class: 'empty' }, 'Nothing to show.'));
  }

  const appendRow = (item, kind, extraClass = '') => {
    const isExpanded = expanded.has(item.id);
    const row = itemRow(item, kind, mode, isExpanded, ctx);
    if (extraClass) row.classList.add(extraClass);
    table.append(row);
    handle.rows.push({ item, el: row, kind });
    if (isExpanded) table.append(detailRow(item, kind, ctx));
  };
  const appendNewRow = (kind) => {
    const row = itemRow(draft.item, kind, mode, true, ctx);
    table.append(row, detailRow(draft.item, kind, ctx));
    queueMicrotask(() => { const t = row.querySelector('input[name="title"]'); if (t && row.isConnected && !captureFocusActive) t.focus(); });
  };
  let captureFocusActive = false;

  if (flat) {
    // Tasks only. A bold rule marks where one parent's tasks end and the
    // next's begin, while the order still keeps them together.
    let prevParent = null;
    for (const t of order.flatTasks) {
      const starts = order.grouped && prevParent != null && t.parent_id !== prevParent;
      appendRow(t, 'task', starts ? 'group-start' : '');
      prevParent = t.parent_id;
    }
    if (draft.item && draft.item.type === 'task') appendNewRow('task');
  } else {
    for (const g of order.groups) {
      appendRow(g.parent, 'parent');
      const hidden = collapsed.has(g.parent.id);
      if (!hidden) for (const t of g.tasks) appendRow(t, 'task');
      if (draft.item && draft.item.type === 'task' && draft.item.parent_id === g.parent.id) appendNewRow('task');
    }
    if (draft.item && draft.item.type !== 'task') appendNewRow('parent');
  }

  if (!order.sorting) installDragAndDrop(table, ctx);

  const focus = captureFocus(container);
  captureFocusActive = !!focus;
  container.replaceChildren(table);
  restoreFocus(container, focus);
  if (opts.onRendered) opts.onRendered(handle);
  return handle;
}

// ---------------------------------------------------------------- drag and drop
//
// Top-level rows (Ongoing/Project) can be dropped among top-level rows. Tasks
// can be dropped before/after any task (in any parent) or onto a parent row,
// which moves them to the start of that parent's tasks; dropping into a
// different parent reparents the task first, then orders it. In Flat, a task
// can only be dropped among its own parent's tasks (no reparenting).

/** Live children of a parent (null = top level), in current sort order. */
function childIds(parentId) {
  return state.items.filter((it) => (it.parent_id ?? null) === parentId).map((it) => it.id);
}

/** The last element of a parent row's group (its tasks and description rows). */
function groupEnd(parentRowEl) {
  let last = parentRowEl;
  while (last.nextElementSibling && !last.nextElementSibling.classList.contains('parent')) last = last.nextElementSibling;
  return last;
}

/** Resolve the element under the pointer to a drop target: { el, mode } with
 *  mode 'sibling' (before/after el) or 'into' (el is a parent row), or null. */
function dropTarget(table, drag, target, flat) {
  const rowEl = target.closest?.('.row');
  if (!rowEl || !table.contains(rowEl) || rowEl.classList.contains('header')) return null;
  let candidate = rowEl;
  if (candidate.classList.contains('description') && candidate.dataset.descFor) {
    candidate = table.querySelector(`.row[data-id="${candidate.dataset.descFor}"]`);
  }
  if (!candidate || candidate.dataset.editing || !candidate.dataset.id) return null;
  if (drag.kind === 'parent') {
    // Anything inside a group resolves to the group's parent row.
    while (candidate && !(candidate.classList.contains('parent') && candidate.dataset.id)) candidate = candidate.previousElementSibling;
    if (!candidate || Number(candidate.dataset.id) === drag.id) return null;
    return { el: candidate, mode: 'sibling' };
  }
  if (candidate.classList.contains('parent')) return { el: candidate, mode: 'into' };
  if (Number(candidate.dataset.id) === drag.id) return null;
  // Flat: only among the tasks of the same parent.
  if (flat && (candidate.dataset.parent ?? '') !== drag.parent) return null;
  return { el: candidate, mode: 'sibling' };
}

function clearDropMarks(table) {
  for (const n of table.querySelectorAll('.drop-before, .drop-after, .drop-into')) n.classList.remove('drop-before', 'drop-after', 'drop-into');
}

function installDragAndDrop(table, ctx) {
  let drag = null; // { id, kind, parent }
  let over = null; // { el, mode, after }

  table.addEventListener('dragstart', (e) => {
    const handleEl = e.target.closest?.('.drag-handle');
    const rowEl = handleEl?.closest('.row[data-id]');
    if (!handleEl || !rowEl) { e.preventDefault(); return; }
    drag = { id: Number(rowEl.dataset.id), kind: rowEl.dataset.kind, parent: rowEl.dataset.parent ?? '' };
    rowEl.classList.add('dragging');
    table.classList.add('drag-active');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(drag.id));
    try { e.dataTransfer.setDragImage(rowEl, 20, rowEl.offsetHeight / 2); } catch {}
  });

  table.addEventListener('dragover', (e) => {
    if (!drag) return;
    const t = dropTarget(table, drag, e.target, ctx.flat);
    clearDropMarks(table);
    if (!t) { over = null; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (t.mode === 'into') {
      over = { el: t.el, mode: 'into', after: false };
      t.el.classList.add('drop-into');
      return;
    }
    const rect = t.el.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    over = { el: t.el, mode: 'sibling', after };
    const mark = drag.kind === 'parent' && after ? groupEnd(t.el) : t.el;
    mark.classList.add(after ? 'drop-after' : 'drop-before');
  });

  table.addEventListener('dragleave', (e) => {
    if (!drag || (e.relatedTarget && table.contains(e.relatedTarget))) return;
    clearDropMarks(table);
    over = null;
  });

  const finish = () => {
    clearDropMarks(table);
    for (const n of table.querySelectorAll('.dragging')) n.classList.remove('dragging');
    table.classList.remove('drag-active');
    drag = null;
    over = null;
  };

  table.addEventListener('drop', async (e) => {
    if (!drag) return;
    e.preventDefault();
    const d = drag;
    const target = over;
    finish();
    if (!target) return;
    const item = state.itemsById.get(d.id);
    const targetId = Number(target.el.dataset.id);
    if (!item || targetId === d.id) return;

    // Where does it land, and under which parent?
    let newParent, ids, idx;
    if (target.mode === 'into') {
      newParent = targetId;
      ids = childIds(newParent).filter((id) => id !== d.id);
      idx = 0;
    } else {
      const targetItem = state.itemsById.get(targetId);
      if (!targetItem) return;
      newParent = targetItem.parent_id ?? null;
      // Flat never reparents (dropTarget already refuses other parents' tasks).
      if (ctx.flat && d.kind === 'task' && newParent !== (item.parent_id ?? null)) return;
      ids = childIds(newParent).filter((id) => id !== d.id);
      idx = ids.indexOf(targetId);
      if (idx < 0) return;
      if (target.after) idx += 1;
    }
    ids.splice(idx, 0, d.id);
    try {
      await group(`moving ${item.key}`, async () => {
        if (d.kind === 'task' && (item.parent_id ?? null) !== newParent) {
          await api.updateItem(d.id, { parent_id: newParent });
        }
        await api.reorder(ids);
      });
      await ctx.onChanged();
    } catch (err) {
      toast(err.message);
    }
  });

  table.addEventListener('dragend', finish);
}

/** Ids of all rows in groups that can be expanded (for expand-all). */
export function expandableIds(groups) {
  const ids = [];
  for (const g of groups) {
    if (isExpandable(g.parent)) ids.push(g.parent.id);
    for (const t of g.tasks) if (isExpandable(t)) ids.push(t.id);
  }
  return ids;
}
