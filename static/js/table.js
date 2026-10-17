// Hierarchical table renderer.
//
// renderTable(container, opts) renders the groups into container and returns
// a handle: { rows: [{ item, el, kind }], rerender() }.
//
//   opts.groups    [{ parent, tasks }] from filters.js
//   opts.mode      'full' | 'title-only'   (title-only is used beside Plan/Matrix)
//   opts.expanded  Set<number> of item ids whose description is expanded
//                  (owned by the caller so it survives re-renders)
//   opts.actions   { onEdit(item), onDelete(item), onAddTask(parent) } — optional
//
// Rows carry data-id / data-kind attributes so side panels (Plan) can align
// to them, and so editing code can find them.

import { state, isClosed, daysFromToday, STATUS_LABEL } from './state.js';
import { renderMarkdown } from './markdown.js';
import { el, contrastText } from './util.js';

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

function parentRow(item, mode, expanded, ctx) {
  const closed = isClosed(item.status);
  const row = el('div', { class: rowClasses(item, 'parent', expanded), dataset: { id: item.id, kind: 'parent', type: item.type } },
    toggleCell(item, expanded, ctx.onToggle),
    el('div', { class: 'key' }, item.key),
    el('div', { class: 'title' }, item.title),
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
  const row = el('div', { class: rowClasses(item, 'task', expanded), dataset: { id: item.id, kind: 'task', type: 'task' } },
    el('div', { class: 'indent' }),
    toggleCell(item, expanded, ctx.onToggle),
    el('div', { class: 'key' }, item.key),
    el('div', { class: 'title' }, item.title),
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

  const table = el('div', { class: `table ${mode === 'title-only' ? 'title-only' : ''}` });
  table.append(...headerRows(mode));

  if (!groups.length) {
    table.append(el('div', { class: 'empty' }, 'Nothing to show.'));
  }

  for (const g of groups) {
    const pExpanded = expanded.has(g.parent.id);
    const pRow = parentRow(g.parent, mode, pExpanded, ctx);
    table.append(pRow);
    handle.rows.push({ item: g.parent, el: pRow, kind: 'parent' });
    if (pExpanded) table.append(descriptionRow(g.parent, 'parent'));
    for (const t of g.tasks) {
      const tExpanded = expanded.has(t.id);
      const tRow = taskRow(t, mode, tExpanded, ctx);
      table.append(tRow);
      handle.rows.push({ item: t, el: tRow, kind: 'task' });
      if (tExpanded) table.append(descriptionRow(t, 'task'));
    }
  }

  container.replaceChildren(table);
  if (opts.onRendered) opts.onRendered(handle);
  return handle;
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
