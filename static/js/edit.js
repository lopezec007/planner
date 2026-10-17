// In-table creating and editing of items.
//
// A single module-level "editing" record says which row (if any) is currently
// in edit or new mode; table.js consults it while rendering and swaps the
// normal row for the edit form built here. Only one row may be in edit/new
// mode at a time: attempts to start another are blocked with a toast until
// the first is saved or cancelled.
//
//   beginEdit(item)                       -> true if edit mode was entered
//   beginNew({ type, parentId, status })  -> true if new mode was entered
//   cancelEdit()
//   editing.mode  null | 'edit' | 'new'
//
//   renderEditRows(draft, kind, tableMode, ctx) -> [row, detailRow]
//     ctx.rerender()   redraw the table (used on cancel)
//     ctx.onChanged()  reload data after a successful save

import { api } from './api.js';
import { state, STATUSES, STATUS_LABEL, isParent } from './state.js';
import { el, toast } from './util.js';

export const editing = { mode: null, id: null, draft: null };

const BLOCK_MSG = 'Save or cancel the current edit first.';

export function beginEdit(item) {
  if (editing.mode) { toast(BLOCK_MSG); return false; }
  editing.mode = 'edit';
  editing.id = item.id;
  editing.draft = { ...item };
  return true;
}

export function beginNew({ type, parentId = null, status = 'todo' }) {
  if (editing.mode) { toast(BLOCK_MSG); return false; }
  editing.mode = 'new';
  editing.id = null;
  editing.draft = {
    id: null, type, key: '', parent_id: parentId, title: '', description: '',
    owner_id: null, assignee_id: null, assignee_shared: false,
    status: type === 'ongoing' ? null : status,
    start_date: null, start_firm: false, end_date: null, end_firm: false,
    urgency: type === 'task' ? 5 : null, importance: type === 'task' ? 5 : null, blocked: false,
  };
  return true;
}

export function cancelEdit() {
  editing.mode = null;
  editing.id = null;
  editing.draft = null;
}

export const isEditingItem = (item) => editing.mode === 'edit' && editing.id === item.id;

// ---------------------------------------------------------------- editors

function option(value, label, selected) {
  return el('option', { value, selected: selected ? true : null }, label);
}

function userSelect(name, current, extra) {
  const sel = el('select', { name, 'aria-label': name });
  sel.append(option('', '—', current == null && !extra?.sharedSelected));
  if (extra?.shared) sel.append(option('shared', 'Shared', extra.sharedSelected));
  for (const u of state.users) sel.append(option(String(u.id), u.name, current === u.id));
  return sel;
}

function parentSelect(current) {
  const sel = el('select', { name: 'parent', 'aria-label': 'parent' });
  for (const it of state.items) {
    if (!isParent(it)) continue;
    sel.append(option(String(it.id), `${it.key} ${it.title}`, current === it.id));
  }
  return sel;
}

function buildEditors(draft) {
  const type = draft.type;
  const ed = {
    title: el('input', { type: 'text', name: 'title', 'aria-label': 'title', placeholder: 'Title (required)', maxlength: 255, value: draft.title || '' }),
    description: el('textarea', { name: 'description', 'aria-label': 'description', rows: 4, placeholder: 'Description (markdown)' }),
    owner: userSelect('owner', draft.owner_id),
    assignee: userSelect('assignee', draft.assignee_id, { shared: true, sharedSelected: !!draft.assignee_shared }),
  };
  ed.description.value = draft.description || '';
  if (type !== 'ongoing') {
    ed.status = el('select', { name: 'status', 'aria-label': 'status' });
    for (const s of STATUSES) ed.status.append(option(s, STATUS_LABEL[s], draft.status === s));
    ed.start = el('input', { type: 'date', name: 'start_date', 'aria-label': 'start date', value: draft.start_date || '' });
    ed.startFirm = el('input', { type: 'checkbox', name: 'start_firm', 'aria-label': 'start firm', checked: !!draft.start_firm });
    ed.end = el('input', { type: 'date', name: 'end_date', 'aria-label': 'end date', value: draft.end_date || '' });
    ed.endFirm = el('input', { type: 'checkbox', name: 'end_firm', 'aria-label': 'end firm', checked: !!draft.end_firm });
  }
  if (type === 'task') {
    ed.parent = parentSelect(draft.parent_id);
    ed.urgency = el('input', { type: 'number', name: 'urgency', 'aria-label': 'urgency', min: 0, max: 10, value: draft.urgency ?? '' });
    ed.importance = el('input', { type: 'number', name: 'importance', 'aria-label': 'importance', min: 0, max: 10, value: draft.importance ?? '' });
    ed.blocked = el('input', { type: 'checkbox', name: 'blocked', 'aria-label': 'blocked', checked: !!draft.blocked });
  }
  return ed;
}

// Read the editors into a plain item-like object (nulls for empties).
function readEditors(ed, type) {
  const num = (inp) => (inp.value === '' ? null : Number(inp.value));
  const v = {
    title: ed.title.value,
    description: ed.description.value,
    owner_id: ed.owner.value ? Number(ed.owner.value) : null,
    assignee_shared: ed.assignee.value === 'shared',
    assignee_id: ed.assignee.value && ed.assignee.value !== 'shared' ? Number(ed.assignee.value) : null,
  };
  if (type !== 'ongoing') {
    v.status = ed.status.value;
    v.start_date = ed.start.value || null;
    v.start_firm = v.start_date ? ed.startFirm.checked : false;
    v.end_date = ed.end.value || null;
    v.end_firm = v.end_date ? ed.endFirm.checked : false;
  }
  if (type === 'task') {
    v.parent_id = ed.parent.value ? Number(ed.parent.value) : null;
    v.urgency = num(ed.urgency);
    v.importance = num(ed.importance);
    v.blocked = ed.blocked.checked;
  }
  return v;
}

// Body for POST /api/items.
function createBody(v, type) {
  const body = { type, title: v.title, description: v.description, owner_id: v.owner_id };
  if (v.assignee_shared) body.assignee_shared = true;
  else body.assignee_id = v.assignee_id;
  if (type !== 'ongoing') {
    body.status = v.status;
    body.start_date = v.start_date; body.start_firm = v.start_firm;
    body.end_date = v.end_date; body.end_firm = v.end_firm;
  }
  if (type === 'task') {
    body.parent_id = v.parent_id;
    if (v.urgency != null) body.urgency = v.urgency;
    if (v.importance != null) body.importance = v.importance;
    body.blocked = v.blocked;
  }
  return body;
}

// Partial body for PATCH /api/items/{id}: only fields that differ from the
// original; an explicit null clears a field.
function patchBody(v, orig) {
  const body = {};
  const diff = (k) => { if ((v[k] ?? null) !== (orig[k] ?? null)) body[k] = v[k]; };
  diff('title');
  diff('description');
  diff('owner_id');
  if (v.assignee_shared !== !!orig.assignee_shared || (v.assignee_id ?? null) !== (orig.assignee_id ?? null)) {
    if (v.assignee_shared) body.assignee_shared = true;
    else body.assignee_id = v.assignee_id; // a user id, or null to clear
  }
  if (orig.type !== 'ongoing') {
    diff('status');
    diff('start_date');
    if (v.start_firm !== !!orig.start_firm) body.start_firm = v.start_firm;
    diff('end_date');
    if (v.end_firm !== !!orig.end_firm) body.end_firm = v.end_firm;
  }
  if (orig.type === 'task') {
    if (v.parent_id != null && v.parent_id !== orig.parent_id) body.parent_id = v.parent_id;
    if (v.urgency != null) diff('urgency');
    if (v.importance != null) diff('importance');
    if (v.blocked !== !!orig.blocked) body.blocked = v.blocked;
  }
  return body;
}

// ---------------------------------------------------------------- layout

function field(label, ...controls) {
  return el('label', { class: 'edit-field' }, el('span', { class: 'edit-label' }, label), ...controls);
}

function firmLabel(checkbox) {
  return el('label', { class: 'firm-check', title: 'Firm date' }, checkbox, ' firm');
}

/**
 * Build the edit row (grid-aligned) and the detail row beneath it (description
 * textarea plus any fields that have no cell in the grid).
 */
export function renderEditRows(draft, kind, tableMode, ctx) {
  const type = draft.type;
  const isNew = editing.mode === 'new';
  const ed = buildEditors(draft);
  let busy = false;

  const row = el('div', {
    class: `row ${kind} editing ${isNew ? 'new' : ''}`,
    dataset: { id: draft.id ?? '', kind, type, editing: isNew ? 'new' : 'edit' },
  });
  if (kind === 'task') row.append(el('div', { class: 'indent' }));
  row.append(
    el('div', { class: 'toggle' }),
    el('div', { class: 'key' }, isNew ? el('span', { class: 'new-key' }, type === 'ongoing' ? 'O-?' : type === 'project' ? 'P-?' : 'T-?') : draft.key),
    el('div', { class: 'title' }, ed.title),
  );

  const detailFields = el('div', { class: 'edit-fields' });
  const full = tableMode === 'full';
  if (full) {
    if (kind === 'task') row.append(el('div', {}, ed.status));
    row.append(
      el('div', {}, ed.owner),
      el('div', {}, ed.assignee),
    );
    if (type === 'ongoing') {
      row.append(el('div', { class: 'edit-na' }), el('div', { class: 'edit-na' }));
    } else {
      row.append(
        el('div', { class: 'date-edit' }, ed.start, firmLabel(ed.startFirm)),
        el('div', { class: 'date-edit' }, ed.end, firmLabel(ed.endFirm)),
      );
    }
    if (kind === 'task') row.append(el('div', { class: 'num' }, ed.urgency), el('div', { class: 'num' }, ed.importance));
    // Fields with no cell of their own live in the detail row.
    if (type === 'project') detailFields.append(field('Status', ed.status));
    if (type === 'task') detailFields.append(field('Parent', ed.parent), field('Blocked', ed.blocked));
  } else {
    // Title-only table (Plan / Matrix): everything but the title goes below.
    if (type === 'task') detailFields.append(field('Parent', ed.parent));
    if (type !== 'ongoing') detailFields.append(field('Status', ed.status));
    detailFields.append(field('Owner', ed.owner), field('Assignee', ed.assignee));
    if (type !== 'ongoing') {
      detailFields.append(
        field('Start', ed.start, firmLabel(ed.startFirm)),
        field('End', ed.end, firmLabel(ed.endFirm)),
      );
    }
    if (type === 'task') {
      detailFields.append(field('Urgency', ed.urgency), field('Importance', ed.importance), field('Blocked', ed.blocked));
    }
  }

  // In the full grid the actions cell is narrow, so use icon buttons there.
  const saveBtn = el('button', { type: 'button', class: 'primary save', title: 'Save', 'aria-label': 'Save' }, full ? '✓' : 'Save');
  const cancelBtn = el('button', { type: 'button', class: 'cancel', title: 'Cancel', 'aria-label': 'Cancel' }, full ? '✕' : 'Cancel');
  const actionsCell = el('div', { class: 'actions' }, saveBtn, cancelBtn);
  if (full) row.append(actionsCell);

  const detail = el('div', {
    class: `row description ${kind} edit-detail`,
    dataset: { descFor: draft.id ?? '', editing: isNew ? 'new' : 'edit' },
  }, detailFields, ed.description);
  if (!full) detail.append(actionsCell);

  const setBusy = (b) => {
    busy = b;
    for (const c of [row, detail]) for (const inp of c.querySelectorAll('input,select,textarea,button')) inp.disabled = b;
  };

  const save = async () => {
    if (busy) return;
    const v = readEditors(ed, type);
    setBusy(true);
    try {
      if (isNew) await api.createItem(createBody(v, type));
      else {
        const body = patchBody(v, draft);
        if (Object.keys(body).length) await api.updateItem(draft.id, body);
      }
    } catch (e) {
      setBusy(false);
      toast(e.message);
      ed.title.focus();
      return;
    }
    cancelEdit();
    await ctx.onChanged();
  };
  const cancel = () => { if (busy) return; cancelEdit(); ctx.rerender(); };

  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', cancel);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key !== 'Enter') return;
    if (e.target === ed.description) { if (e.ctrlKey || e.metaKey) { e.preventDefault(); save(); } return; }
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    save();
  };
  row.addEventListener('keydown', onKey);
  detail.addEventListener('keydown', onKey);

  // Focus the title once the rows are in the document.
  queueMicrotask(() => { if (row.isConnected) ed.title.focus(); });

  return [row, detail];
}
