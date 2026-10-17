// Hierarchical table renderer.
//
// renderTable(container, opts) renders the groups into container and returns
// a handle: { rows: [{ item, el, kind }], rerender() }.
//
//   opts.groups    [{ parent, tasks }] from filters.js
//   opts.mode      'full' | 'title-only'   (title-only is used beside Timeline/Matrix)
//   opts.expanded  Set<number> of item ids whose detail row is open
//                  (owned by the caller so it survives re-renders)
//   opts.actions   { onDelete(item), onAddTask(parent), onChanged() } — optional.
//                  onChanged() reloads data after any save or reorder.
//   opts.collapsed Set<number> of parent ids whose tasks are hidden (caller-owned)
//   opts.onCollapse(parentId, collapsed)  called when the caret is clicked
//   opts.flat      true: no parent rows; each task row carries its parent's
//                  key and title in extra leading columns
//
// Every field is edited in place (see cells.js): there is no edit mode. A
// single unsaved "new row" (cells.draft) is rendered where it will live and
// created once it has a title. Rows carry data-id / data-kind / data-type
// (tasks also data-parent) so side panels (Timeline) can align to them; a new
// row carries data-editing="new" and no id.
//
// Reordering: every saved row has a drag handle in its key cell. Top-level
// rows can be dropped among top-level rows; tasks among any parent's tasks or
// onto a parent row (which reparents them). The full sibling list (from state,
// including siblings hidden by the page's filter) is sent to api.reorder so
// hidden siblings keep their positions.

import { state, isClosed, isBlocked } from './state.js';
import { api, group } from './api.js';
import { el, contrastText, toast } from './util.js';
import {
  draft, discardNew, commitNew, isDraft, makeSaver,
  titleControl, statusControl, userControl, dateControl, levelControl, blockedControl,
  descriptionControl, dependencyPanel,
} from './cells.js';

export function userChip(id) {
  if (id == null) return '';
  const u = state.usersById.get(id);
  if (!u) return el('span', { class: 'chip' }, `#${id}`);
  return el('span', { class: 'chip', style: { background: u.color, color: contrastText(u.color) }, title: u.name }, u.name);
}

/** Every row can be expanded: the description is edited there (and, for
 *  projects and tasks, the dependencies). */
export function isExpandable() {
  return true;
}

function toggleCell(item, expanded, onToggle) {
  const cell = el('div', { class: 'toggle' });
  if (isExpandable(item) && !isDraft(item)) {
    cell.append(el('button', {
      type: 'button',
      title: expanded ? 'Collapse' : 'Expand (description and dependencies)',
      'aria-expanded': expanded ? 'true' : 'false',
      onClick: (e) => { e.stopPropagation(); onToggle(item); },
    }));
  }
  return cell;
}

function actionButtons(item, ctx) {
  const cell = el('div', { class: 'actions' });
  if (isDraft(item)) {
    cell.append(
      el('button', { class: 'primary icon', type: 'button', title: 'Save', 'aria-label': 'Save', onClick: () => commitNew(ctx) }, '✓'),
      el('button', { class: 'icon', type: 'button', title: 'Discard', 'aria-label': 'Discard', onClick: () => { discardNew(); ctx.rerender(); } }, '✕'),
    );
    return cell;
  }
  const { actions } = ctx;
  if (!actions) return cell;
  if (item.type !== 'task' && actions.onAddTask) {
    cell.append(el('button', { class: 'icon', type: 'button', title: 'Add task', onClick: () => actions.onAddTask(item) }, '+'));
  }
  if (actions.onDelete) {
    cell.append(el('button', { class: 'icon', type: 'button', title: 'Delete', onClick: () => actions.onDelete(item) }, '🗑'));
  }
  return cell;
}

function headerRow(mode, flat) {
  const row = el('div', { class: 'row header' }, el('div'), el('div'), el('div'));
  if (flat) row.append(el('div', { class: 'parent-ref' }, 'Ongoing / Project'), el('div', {}, 'Task'));
  if (mode === 'full') {
    row.append(
      el('div', {}, 'Status'), el('div', {}, 'Owner'), el('div', {}, 'Assignee'),
      el('div', {}, 'Start'), el('div', {}, 'End'),
      el('div', { class: 'num', title: 'Urgency' }, 'Urg'), el('div', { class: 'num', title: 'Importance' }, 'Imp'),
      el('div', { class: 'blocked-cell' }, 'Blocked'), el('div'),
    );
  }
  return row;
}

function rowClasses(item, kind, expanded) {
  const cls = ['row', kind];
  if (isDraft(item)) cls.push('new');
  else if (isBlocked(item)) cls.push('blocked');
  if (isClosed(item.status)) cls.push('closed');
  if (expanded) cls.push('expanded');
  return cls.join(' ');
}

function dragHandle() {
  return el('span', { class: 'drag-handle', title: 'Drag to reorder', draggable: 'true', 'aria-label': 'Drag to reorder' }, '⠿');
}

function keyCell(item) {
  if (isDraft(item)) {
    const prefix = item.type === 'ongoing' ? 'N' : item.type === 'project' ? 'P' : 'T';
    return el('div', { class: 'key' }, el('span', { class: 'key-text new-key' }, `${prefix}-?`));
  }
  return el('div', { class: 'key' }, dragHandle(), el('span', { class: 'key-text' }, item.key));
}

// In the title-only table there is no actions column, so the action buttons
// sit at the right of the title cell (revealed on hover, see edit.css).
function titleCell(item, mode, ctx, saver, kind) {
  const cell = el('div', { class: 'title' });
  if (kind === 'parent' && !isDraft(item)) {
    const n = (state.childrenOf.get(item.id) || []).length;
    const isCollapsed = ctx.collapsed.has(item.id);
    cell.append(el('button', {
      type: 'button', class: 'caret', title: isCollapsed ? `Show ${n} task(s)` : 'Hide tasks',
      'aria-expanded': isCollapsed ? 'false' : 'true', 'aria-label': isCollapsed ? 'Show tasks' : 'Hide tasks',
      dataset: { collapse: item.id },
      onClick: (e) => { e.stopPropagation(); ctx.onCollapse(item.id, !isCollapsed); },
    }));
  }
  cell.append(titleControl(item, saver, ctx));
  if (kind === 'parent' && !isDraft(item) && ctx.collapsed.has(item.id)) {
    const n = (state.childrenOf.get(item.id) || []).length;
    if (n) cell.append(el('span', { class: 'task-count', title: `${n} hidden task(s)` }, `(${n})`));
  }
  if (mode !== 'full') cell.append(actionButtons(item, ctx));
  return cell;
}

/** One row for either kind; parents simply leave the task-only cells empty.
 *  In flat mode a task row starts with its parent's key and title. */
function itemRow(item, kind, mode, expanded, ctx) {
  const saver = makeSaver(item, ctx);
  const dataset = { kind, type: item.type };
  if (isDraft(item)) dataset.editing = 'new';
  else dataset.id = item.id;
  if (kind === 'task' && item.parent_id != null) dataset.parent = item.parent_id;
  const row = el('div', { class: rowClasses(item, kind, expanded) + (ctx.collapsed.has(item.id) ? ' collapsed' : ''), dataset },
    toggleCell(item, expanded, ctx.onToggle));
  if (ctx.flat) {
    const parent = item.parent_id != null ? state.itemsById.get(item.parent_id) : null;
    row.append(
      el('div', { class: 'key parent-ref' }, parent ? parent.key : ''),
      keyCell(item),
      el('div', { class: 'title parent-ref', title: parent ? `${parent.key} ${parent.title}` : '' }, parent ? parent.title : ''),
      titleCell(item, mode, ctx, saver, kind),
    );
  } else {
    row.append(keyCell(item), titleCell(item, mode, ctx, saver, kind));
  }
  if (mode === 'full') {
    row.append(
      statusControl(item, saver),
      userControl(item, 'owner_id', saver),
      userControl(item, 'assignee_id', saver),
      dateControl(item, 'start', saver),
      dateControl(item, 'end', saver, { highlight: true }),
      levelControl(item, 'urgency', saver),
      levelControl(item, 'importance', saver),
      blockedControl(item, saver),
      actionButtons(item, ctx),
    );
  }
  return row;
}

/** The expanded detail row: description on the left, dependencies on the right. */
function detailRow(item, kind, ctx) {
  const saver = makeSaver(item, ctx);
  const deps = dependencyPanel(item, ctx);
  const dataset = isDraft(item) ? { editing: 'new' } : { descFor: item.id };
  // Same grid as the item row: the description fills the title column and the
  // dependencies sit under the remaining columns (or below, in title-only
  // mode). Not given the kind class itself, so `.row.task` / `.row.parent`
  // only ever match item rows (detail rows contain other items' titles).
  const lead = ctx.flat ? 4 : 2;
  const row = el('div', { class: `row description kind-${kind}`, dataset });
  for (let i = 0; i < lead; i++) row.append(el('div'));
  row.append(el('div', { class: 'title' }, descriptionControl(item, saver)));
  if (deps) row.append(el('div', { class: 'deps-cell' }, deps));
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

export function renderTable(container, opts) {
  const { groups, mode = 'full', expanded = new Set(), actions, collapsed = new Set(), flat = false } = opts;
  const handle = { rows: [], rerender: () => renderTable(container, opts) };

  const ctx = {
    actions,
    collapsed,
    flat,
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

  const table = el('div', { class: `table ${mode === 'title-only' ? 'title-only' : ''} ${flat ? 'flat' : ''}` });
  table.append(headerRow(mode, flat));

  if (!groups.length && !draft.item) {
    table.append(el('div', { class: 'empty' }, 'Nothing to show.'));
  }

  const appendRow = (item, kind) => {
    const isExpanded = expanded.has(item.id);
    const row = itemRow(item, kind, mode, isExpanded, ctx);
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

  for (const g of groups) {
    if (!flat) appendRow(g.parent, 'parent');
    const hidden = !flat && collapsed.has(g.parent.id);
    if (!hidden) for (const t of g.tasks) appendRow(t, 'task');
    if (draft.item && draft.item.type === 'task' && draft.item.parent_id === g.parent.id) appendNewRow('task');
  }
  if (draft.item && draft.item.type !== 'task' && !flat) appendNewRow('parent');

  installDragAndDrop(table, ctx);

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
// different parent reparents the task first, then orders it.

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
function dropTarget(table, drag, target) {
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
    const t = dropTarget(table, drag, e.target);
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
