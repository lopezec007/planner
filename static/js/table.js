// Hierarchical table renderer.
//
// renderTable(container, opts) renders the groups into container and returns
// a handle: { rows: [{ item, el, kind }], rerender() }.
//
//   opts.groups    [{ parent, tasks }] from filters.js
//   opts.mode      'full' | 'title-only'   (title-only is used beside Plan/Matrix)
//   opts.expanded  Set<number> of item ids whose description is expanded
//                  (owned by the caller so it survives re-renders)
//   opts.actions   { onEdit(item), onDelete(item), onAddTask(parent),
//                    onChanged() } — optional. onChanged() reloads data after
//                  a save or reorder; without it the table only re-renders.
//
// Rows carry data-id / data-kind attributes so side panels (Plan) can align
// to them, and so editing code can find them. Task rows also carry
// data-parent. A row in edit/new mode (see edit.js) carries data-editing and
// is rendered as a form instead of cells; a new row has no data-id yet and is
// not included in the handle's rows.
//
// Reordering: every row has a drag handle in its key cell. Top-level rows can
// be dropped among top-level rows; tasks among the tasks of the same parent.
// The full sibling list (from state, including siblings hidden by the page's
// filter) is sent to api.reorder so hidden siblings keep their positions.

import { state, isClosed, daysFromToday, STATUS_LABEL } from './state.js';
import { renderMarkdown } from './markdown.js';
import { api } from './api.js';
import { el, contrastText, toast } from './util.js';
import { editing, isEditingItem, cancelEdit, renderEditRows } from './edit.js';

const FIRM_ICON = '🔒';

export function userChip(id, shared) {
  if (shared) return el('span', { class: 'chip shared' }, 'Shared');
  if (id == null) return '';
  const u = state.usersById.get(id);
  if (!u) return el('span', { class: 'chip' }, `#${id}`);
  return el('span', {
    class: 'chip',
    style: { background: u.color, color: contrastText(u.color) },
    title: u.name,
  }, u.name);
}

function levelClass(n) {
  if (n == null) return '';
  if (n >= 9) return 'hl-red';
  if (n >= 6) return 'hl-orange';
  return '';
}

function endDateClass(ymd) {
  const d = daysFromToday(ymd);
  if (d == null) return '';
  if (d <= 0) return 'hl-red';
  if (d <= 7) return 'hl-orange';
  return '';
}

function dateCell(ymd, firm, cls) {
  const c = el('span', { class: ['date', cls].filter(Boolean).join(' ') }, ymd || '');
  if (ymd && firm) c.append(el('span', { class: 'firm', title: 'Firm' }, FIRM_ICON));
  return el('div', { class: 'date' }, c);
}

function numCell(n, highlight) {
  const cls = highlight ? levelClass(n) : '';
  return el('div', { class: 'num' }, n == null ? '' : el('span', { class: cls }, String(n)));
}

function toggleCell(item, expanded, onToggle) {
  const cell = el('div', { class: 'toggle' });
  if (item.description && item.description.trim()) {
    cell.append(el('button', {
      type: 'button',
      title: expanded ? 'Collapse description' : 'Expand description',
      'aria-expanded': expanded ? 'true' : 'false',
      onClick: (e) => { e.stopPropagation(); onToggle(item); },
    }));
  }
  return cell;
}

function actionButtons(item, actions) {
  const cell = el('div', { class: 'actions' });
  if (!actions) return cell;
  if (item.type !== 'task' && actions.onAddTask) {
    cell.append(el('button', { class: 'icon', type: 'button', title: 'Add task', onClick: () => actions.onAddTask(item) }, '+'));
  }
  if (actions.onEdit) {
    cell.append(el('button', { class: 'icon', type: 'button', title: 'Edit', onClick: () => actions.onEdit(item) }, '✎'));
  }
  if (actions.onDelete) {
    cell.append(el('button', { class: 'icon', type: 'button', title: 'Delete', onClick: () => actions.onDelete(item) }, '🗑'));
  }
  return cell;
}

function headerRows(mode) {
  const parent = el('div', { class: 'row header parent' },
    el('div'), el('div', {}, 'Key'), el('div', {}, 'Ongoing / Project'));
  const task = el('div', { class: 'row header task' },
    el('div'), el('div'), el('div', {}, 'Key'), el('div', {}, 'Task'));
  if (mode === 'full') {
    parent.append(el('div', {}, 'Owner'), el('div', {}, 'Assignee'), el('div', {}, 'Start'), el('div', {}, 'End'), el('div'));
    task.append(el('div', {}, 'Status'), el('div', {}, 'Owner'), el('div', {}, 'Assignee'), el('div', {}, 'Start'),
      el('div', {}, 'End'), el('div', { class: 'num', title: 'Urgency' }, 'Urg'), el('div', { class: 'num', title: 'Importance' }, 'Imp'), el('div'));
  }
  return [parent, task];
}

function rowClasses(item, kind, expanded) {
  const cls = ['row', kind];
  if (item.blocked) cls.push('blocked');
  if (isClosed(item.status)) cls.push('closed');
  if (expanded) cls.push('expanded');
  return cls.join(' ');
}

function dragHandle() {
  return el('span', { class: 'drag-handle', title: 'Drag to reorder', draggable: 'true', 'aria-label': 'Drag to reorder' }, '⠿');
}

function keyCell(item) {
  return el('div', { class: 'key' }, dragHandle(), el('span', { class: 'key-text' }, item.key));
}

// In the title-only table there is no actions column, so the action buttons
// sit at the right of the title cell (revealed on hover, see edit.css).
function titleCell(item, mode, ctx) {
  const cell = el('div', { class: 'title' }, el('span', { class: 'title-text' }, item.title));
  if (mode !== 'full') cell.append(actionButtons(item, ctx.actions));
  return cell;
}

function parentRow(item, mode, expanded, ctx) {
  const closed = isClosed(item.status);
  const row = el('div', { class: rowClasses(item, 'parent', expanded), dataset: { id: item.id, kind: 'parent', type: item.type } },
    toggleCell(item, expanded, ctx.onToggle),
    keyCell(item),
    titleCell(item, mode, ctx),
  );
  if (mode === 'full') {
    row.append(
      el('div', {}, userChip(item.owner_id, false)),
      el('div', {}, userChip(item.assignee_id, item.assignee_shared)),
      dateCell(item.start_date, item.start_firm, ''),
      dateCell(item.end_date, item.end_firm, closed ? '' : endDateClass(item.end_date)),
      actionButtons(item, ctx.actions),
    );
  }
  return row;
}

function taskRow(item, mode, expanded, ctx) {
  const closed = isClosed(item.status);
  const row = el('div', { class: rowClasses(item, 'task', expanded), dataset: { id: item.id, kind: 'task', type: 'task', parent: item.parent_id } },
    el('div', { class: 'indent' }),
    toggleCell(item, expanded, ctx.onToggle),
    keyCell(item),
    titleCell(item, mode, ctx),
  );
  if (mode === 'full') {
    row.append(
      el('div', {}, el('span', { class: `status ${item.status}` }, STATUS_LABEL[item.status] || item.status)),
      el('div', {}, userChip(item.owner_id, false)),
      el('div', {}, userChip(item.assignee_id, item.assignee_shared)),
      dateCell(item.start_date, item.start_firm, ''),
      dateCell(item.end_date, item.end_firm, closed ? '' : endDateClass(item.end_date)),
      numCell(item.urgency, !closed),
      numCell(item.importance, !closed),
      actionButtons(item, ctx.actions),
    );
  }
  return row;
}

function descriptionRow(item, kind) {
  const md = el('div', { class: 'md' });
  md.innerHTML = renderMarkdown(item.description);
  return el('div', { class: `row description ${kind}`, dataset: { descFor: item.id } }, md);
}

export function renderTable(container, opts) {
  const { groups, mode = 'full', expanded = new Set(), actions } = opts;
  const handle = { rows: [], rerender: () => renderTable(container, opts) };

  const ctx = {
    actions,
    onToggle: (item) => {
      if (expanded.has(item.id)) expanded.delete(item.id); else expanded.add(item.id);
      handle.rerender();
    },
  };

  const editCtx = {
    rerender: () => handle.rerender(),
    onChanged: async () => { if (actions?.onChanged) await actions.onChanged(); else handle.rerender(); },
  };

  // Drop an edit/new state whose row cannot be shown on this render (e.g. the
  // item was removed or the page changed) so it does not block new edits.
  if (editing.mode === 'edit' && !groups.some((g) => g.parent.id === editing.id || g.tasks.some((t) => t.id === editing.id))) cancelEdit();
  if (editing.mode === 'new' && editing.draft.type === 'task' && !groups.some((g) => g.parent.id === editing.draft.parent_id)) cancelEdit();

  const table = el('div', { class: `table ${mode === 'title-only' ? 'title-only' : ''}` });
  table.append(...headerRows(mode));

  if (!groups.length && editing.mode !== 'new') {
    table.append(el('div', { class: 'empty' }, 'Nothing to show.'));
  }

  const appendRow = (item, kind) => {
    if (isEditingItem(item)) {
      const [row, detail] = renderEditRows(editing.draft, kind, mode, editCtx);
      table.append(row, detail);
      handle.rows.push({ item, el: row, kind });
      return;
    }
    const isExpanded = expanded.has(item.id);
    const row = kind === 'parent' ? parentRow(item, mode, isExpanded, ctx) : taskRow(item, mode, isExpanded, ctx);
    table.append(row);
    handle.rows.push({ item, el: row, kind });
    if (isExpanded) table.append(descriptionRow(item, kind));
  };
  const appendNewRow = (kind) => table.append(...renderEditRows(editing.draft, kind, mode, editCtx));

  for (const g of groups) {
    appendRow(g.parent, 'parent');
    for (const t of g.tasks) appendRow(t, 'task');
    if (editing.mode === 'new' && editing.draft.type === 'task' && editing.draft.parent_id === g.parent.id) appendNewRow('task');
  }
  if (editing.mode === 'new' && editing.draft.type !== 'task') appendNewRow('parent');

  installDragAndDrop(table, editCtx);

  container.replaceChildren(table);
  if (opts.onRendered) opts.onRendered(handle);
  return handle;
}

// ---------------------------------------------------------------- drag and drop

/** All live siblings of item (from state, in current sort order). */
function siblingIds(item) {
  return state.items.filter((it) => (it.parent_id ?? null) === (item.parent_id ?? null)).map((it) => it.id);
}

/** The last element of a parent row's group (its tasks and description rows). */
function groupEnd(parentRowEl) {
  let last = parentRowEl;
  while (last.nextElementSibling && !last.nextElementSibling.classList.contains('parent')) last = last.nextElementSibling;
  return last;
}

/** Resolve the element under the pointer to a valid drop target row, or null. */
function dropTarget(table, drag, target) {
  const rowEl = target.closest?.('.row');
  if (!rowEl || !table.contains(rowEl) || rowEl.classList.contains('header')) return null;
  let candidate = rowEl;
  if (drag.kind === 'parent') {
    // Anything inside a group resolves to the group's parent row.
    while (candidate && !(candidate.classList.contains('parent') && candidate.dataset.id)) candidate = candidate.previousElementSibling;
  } else {
    if (candidate.classList.contains('description') && candidate.dataset.descFor) {
      candidate = table.querySelector(`.row.task[data-id="${candidate.dataset.descFor}"]`);
    }
    if (!candidate || !candidate.classList.contains('task') || !candidate.dataset.id) return null;
    if (candidate.dataset.parent !== drag.parent) return null;
  }
  if (!candidate || candidate.dataset.editing || Number(candidate.dataset.id) === drag.id) return null;
  return candidate;
}

function clearDropMarks(table) {
  for (const n of table.querySelectorAll('.drop-before, .drop-after')) n.classList.remove('drop-before', 'drop-after');
}

function installDragAndDrop(table, editCtx) {
  let drag = null; // { id, kind, parent }
  let over = null; // { el, after }

  table.addEventListener('dragstart', (e) => {
    const handleEl = e.target.closest?.('.drag-handle');
    const rowEl = handleEl?.closest('.row[data-id]');
    if (!handleEl || !rowEl || editing.mode) { e.preventDefault(); return; }
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
    const rect = t.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    over = { el: t, after };
    const mark = drag.kind === 'parent' && after ? groupEnd(t) : t;
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
    const ids = siblingIds(item).filter((id) => id !== d.id);
    let idx = ids.indexOf(targetId);
    if (idx < 0) return;
    if (target.after) idx += 1;
    ids.splice(idx, 0, d.id);
    try {
      await api.reorder(ids);
      await editCtx.onChanged();
    } catch (err) {
      toast(err.message);
    }
  });

  table.addEventListener('dragend', finish);
}

/** Ids of all rows in groups that have a description (for expand-all). */
export function describedIds(groups) {
  const ids = [];
  for (const g of groups) {
    if (g.parent.description?.trim()) ids.push(g.parent.id);
    for (const t of g.tasks) if (t.description?.trim()) ids.push(t.id);
  }
  return ids;
}
