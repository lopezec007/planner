// Inline-editable cells. There is no separate edit mode: every field is a
// live control (or becomes one when clicked) and saves itself on change.
//
//   makeSaver(item, ctx)   -> async (patch) => void   (PATCH for saved items,
//                             merge into the draft for an unsaved new row)
//   beginNew / discardNew  -> the single unsaved "new row" draft
//   *Control(item, saver)  -> cell contents for each field
//   descriptionControl, dependencyPanel -> contents of the expanded row
//
// ctx: { rerender(), onChanged() }  onChanged reloads data and re-renders.

import { api } from './api.js';
import { state, STATUSES, STATUS_LABEL, isClosed, isBlocked, openBlockers, daysFromToday } from './state.js';
import { renderMarkdown } from './markdown.js';
import { el, toast, contrastText } from './util.js';

export const CHIP_MAX_USERS = 3;

// ---------------------------------------------------------------- new-row draft

export const draft = { item: null };

export function beginNew({ type, parentId = null, status = 'todo' }) {
  if (draft.item) { toast('Finish or discard the new row first.'); return false; }
  draft.item = {
    id: null, type, key: '', parent_id: parentId, title: '', description: '',
    owner_id: null, assignee_id: null,
    status: type === 'ongoing' ? null : status,
    start_date: null, start_firm: false, end_date: null, end_firm: false,
    urgency: type === 'task' ? 5 : null, importance: type === 'task' ? 5 : null, blocked: false,
    blocked_by: [], blocks: [],
  };
  return true;
}

export function discardNew() { draft.item = null; }
export const isDraft = (item) => item.id == null;

function createBody(d) {
  const body = { type: d.type, title: d.title.trim(), description: d.description || '', owner_id: d.owner_id, assignee_id: d.assignee_id };
  if (d.type !== 'ongoing') {
    body.status = d.status;
    body.start_date = d.start_date; body.start_firm = !!d.start_firm;
    body.end_date = d.end_date; body.end_firm = !!d.end_firm;
  }
  if (d.type === 'task') {
    body.parent_id = d.parent_id;
    if (d.urgency != null) body.urgency = d.urgency;
    if (d.importance != null) body.importance = d.importance;
    body.blocked = !!d.blocked;
  }
  return body;
}

/** Create the draft if it has a title; returns true when created. */
export async function commitNew(ctx) {
  const d = draft.item;
  if (!d) return false;
  if (!d.title.trim()) { toast('A title is required.'); return false; }
  try {
    await api.createItem(createBody(d));
  } catch (e) {
    toast(e.message);
    return false;
  }
  discardNew();
  await ctx.onChanged();
  return true;
}

export function makeSaver(item, ctx) {
  if (isDraft(item)) {
    return async (patch) => { if (draft.item) Object.assign(draft.item, patch); };
  }
  return async (patch) => {
    try {
      await api.updateItem(item.id, patch);
      await ctx.onChanged();
    } catch (e) {
      toast(e.message);
      ctx.rerender(); // revert the control to the stored value
    }
  };
}

// ---------------------------------------------------------------- controls

/** Title: plain text that becomes an input when clicked (a new row starts
 *  as an input). Enter or blur saves, Escape reverts. */
export function titleControl(item, saver, ctx) {
  let committed = item.title || '';
  const text = el('span', {
    class: `title-text ${committed ? '' : 'empty'}`, tabindex: '0', role: 'button', title: 'Click to edit', dataset: { field: 'title' },
  }, committed || 'Untitled');
  const makeInput = () => {
    const inp = el('input', {
      type: 'text', name: 'title', class: 'cell-input title-input', maxlength: 255,
      value: committed, placeholder: 'Title', 'aria-label': 'title',
    });
    let done = false;
    const finish = async (save, create = false) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (!save) {
        if (isDraft(item)) { discardNew(); ctx.rerender(); return; }
        inp.replaceWith(text);
        return;
      }
      if (isDraft(item)) {
        // A new row is created by Enter or the ✓ button, not by blur (the
        // user may be moving on to fill other fields first). The input stays,
        // so the handler must stay armed.
        if (draft.item) draft.item.title = v;
        if (create && v) await commitNew(ctx);
        done = false;
        return;
      }
      if (v === committed) { inp.replaceWith(text); return; }
      if (!v) {
        toast('A title is required.');
        inp.replaceWith(text);
        return;
      }
      committed = v;
      text.textContent = v;
      await saver({ title: v });
    };
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    return inp;
  };
  if (isDraft(item)) return makeInput();
  const edit = () => {
    const inp = makeInput();
    text.replaceWith(inp);
    inp.focus();
    inp.select();
  };
  text.addEventListener('click', edit);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
  return text;
}

export function statusControl(item, saver) {
  if (!item.status) return el('div');
  const sel = el('select', { name: 'status', class: 'cell-select', 'aria-label': 'status' });
  for (const s of STATUSES) sel.append(el('option', { value: s, selected: item.status === s ? true : null }, STATUS_LABEL[s]));
  sel.addEventListener('change', () => saver({ status: sel.value }));
  return el('div', {}, el('span', { class: `status ${item.status}` }, sel));
}

/** Owner / assignee: the current user's chip (or a dash). Clicking it opens
 *  the picker in place: a row of user chips with a handful of users, else a
 *  select. Picking saves; clicking elsewhere or Escape closes it. */
export function userControl(item, field, saver) {
  const name = field === 'owner_id' ? 'owner' : 'assignee';
  const current = item[field];
  const u = current != null ? state.usersById.get(current) : null;
  const chip = u
    ? el('span', { class: 'chip chip-pick', tabindex: '0', role: 'button', title: `${u.name}: click to change`, style: { background: u.color, color: contrastText(u.color) }, dataset: { name } }, u.name)
    : el('span', { class: 'chip chip-pick empty', tabindex: '0', role: 'button', title: 'Click to set', dataset: { name }, 'aria-label': `${name}: none` });

  const openSelect = () => {
    const sel = el('select', { name, class: 'cell-select', 'aria-label': name });
    sel.append(el('option', { value: '', selected: current == null ? true : null }, '—'));
    for (const x of state.users) sel.append(el('option', { value: String(x.id), selected: current === x.id ? true : null }, x.name));
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = sel.value ? Number(sel.value) : null;
      if (save && v !== (current ?? null)) saver({ [field]: v });
      else sel.replaceWith(chip);
    };
    sel.addEventListener('change', () => finish(true));
    sel.addEventListener('blur', () => finish(false));
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    chip.replaceWith(sel);
    sel.focus();
    try { sel.showPicker?.(); } catch {}
  };

  const openChips = () => {
    const wrap = el('div', { class: 'user-pick', role: 'group', 'aria-label': name, tabindex: '-1', dataset: { name } });
    let done = false;
    const close = () => { if (done) return; done = true; wrap.replaceWith(chip); };
    for (const x of state.users) {
      const pressed = current === x.id;
      const b = el('button', {
        type: 'button', class: 'chip', title: pressed ? `${x.name}: click to clear` : x.name,
        dataset: { user: String(x.id) }, 'aria-pressed': pressed ? 'true' : 'false',
        style: { background: x.color, color: contrastText(x.color) },
      }, x.name);
      b.addEventListener('click', () => { done = true; saver({ [field]: pressed ? null : x.id }); });
      wrap.append(b);
    }
    wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) close(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    chip.replaceWith(wrap);
    (wrap.querySelector('[aria-pressed="true"]') || wrap.firstElementChild)?.focus();
  };

  const open = state.users.length > CHIP_MAX_USERS ? openSelect : openChips;
  chip.addEventListener('click', open);
  chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return el('div', {}, chip);
}

function endDateClass(ymd) {
  const d = daysFromToday(ymd);
  if (d == null) return '';
  const alert = Number(state.settings?.date_alert_days ?? 0);
  const warn = Number(state.settings?.date_warn_days ?? 7);
  if (d <= alert) return 'hl-alert';
  if (d <= warn) return 'hl-warn';
  return '';
}

/** Start / end date: a tilde toggle for "approximate" (not firm) before the
 *  date; the date text becomes a date input when clicked. */
export function dateControl(item, field, saver, { highlight = false } = {}) {
  const dateKey = `${field}_date`, firmKey = `${field}_firm`;
  const value = item[dateKey];
  const firm = !!item[firmKey];
  const cell = el('div', { class: 'date date-cell' });

  const tilde = el('button', {
    type: 'button', name: firmKey, class: `firm-toggle ${firm ? 'firm' : 'approx'}`,
    'aria-pressed': firm ? 'false' : 'true',
    title: firm ? 'Firm date: it will not move. Click to mark it approximate.' : 'Approximate date: a best guess that may move. Click to mark it firm.',
    hidden: value ? null : true,
  }, '~');
  tilde.addEventListener('click', () => saver({ [firmKey]: !firm }));

  const cls = ['date-text', value ? '' : 'empty', highlight && value && !isClosed(item.status) ? endDateClass(value) : ''].filter(Boolean).join(' ');
  const text = el('span', { class: cls, tabindex: '0', role: 'button', title: value ? 'Click to change' : 'Click to set a date', dataset: { field: dateKey }, 'aria-label': value ? dateKey.replace('_', ' ') : `${dateKey.replace('_', ' ')}: none` }, value || '');
  const edit = () => {
    const inp = el('input', { type: 'date', name: dateKey, class: 'cell-input date-input', value: value || '', 'aria-label': dateKey.replace('_', ' ') });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = inp.value || null;
      if (save && v !== (value || null)) saver({ [dateKey]: v });
      else inp.replaceWith(text);
    };
    inp.addEventListener('change', () => finish(true));
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    });
    text.replaceWith(inp);
    inp.focus();
    try { inp.showPicker?.(); } catch {}
  };
  text.addEventListener('click', edit);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
  cell.append(tilde, text);
  return cell;
}

/** Colour for an urgency or importance value from that field's ramp, or ''. */
export function levelColor(n, field) {
  if (n == null) return '';
  const key = `${field}_colors`;
  const cache = state.settings?._ramps || (state.settings ? (state.settings._ramps = {}) : {});
  let ramp = cache[key];
  if (!ramp) {
    try { ramp = JSON.parse(state.settings?.[key] || '[]'); } catch { ramp = []; }
    cache[key] = ramp;
  }
  return ramp[n] || '';
}

/** Urgency / importance: a number input; a single key sets the value
 *  (1-9, 0 = 10, ` = 0) and saves immediately. */
export function levelControl(item, field, saver) {
  if (item.type !== 'task') return el('div', { class: 'num' });
  const color = isClosed(item.status) ? '' : levelColor(item[field], field);
  const inp = el('input', {
    type: 'number', name: field, min: 0, max: 10, class: `cell-input num-input ${color ? 'hl-level' : ''}`,
    value: item[field] ?? '', 'aria-label': field,
  });
  if (color) Object.assign(inp.style, { background: color, color: contrastText(color) });
  const commit = () => {
    const v = inp.value === '' ? null : Number(inp.value);
    if (v == null || v < 0 || v > 10) { inp.value = item[field] ?? ''; return; }
    if (v !== item[field]) saver({ [field]: v });
  };
  inp.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let v = null;
    if (e.key === '`') v = 0;
    else if (e.key === '0') v = 10;
    else if (/^[1-9]$/.test(e.key)) v = Number(e.key);
    if (v == null) { if (e.key === 'Enter') inp.blur(); return; }
    e.preventDefault();
    inp.value = String(v);
    commit();
  });
  inp.addEventListener('change', commit);
  return el('div', { class: 'num' }, inp);
}

/** Blocked: a checkbox for tasks; locked on when an open item blocks this one
 *  (projects only show the locked state). */
export function blockedControl(item, saver) {
  const cell = el('div', { class: 'blocked-cell' });
  if (item.type === 'ongoing') return cell;
  const blockers = openBlockers(item);
  if (item.type !== 'task' && !blockers.length) return cell;
  const locked = blockers.length > 0;
  const cb = el('input', {
    type: 'checkbox', name: 'blocked', 'aria-label': 'blocked',
    checked: isBlocked(item) ? true : null, disabled: locked ? true : null,
    title: locked ? `Blocked by ${blockers.map((b) => b.key).join(', ')} (open)` : (item.blocked ? 'Blocked' : 'Not blocked'),
  });
  if (!locked) cb.addEventListener('change', () => saver({ blocked: cb.checked }));
  cell.append(cb);
  return cell;
}

// ---------------------------------------------------------------- expanded row

/** Rendered markdown that turns into a textarea when clicked. */
export function descriptionControl(item, saver) {
  const box = el('div', { class: 'desc-main' });
  const view = el('div', { class: `md ${item.description?.trim() ? '' : 'placeholder'}`, tabindex: '0', role: 'button', title: 'Click to edit' });
  if (item.description?.trim()) view.innerHTML = renderMarkdown(item.description);
  else view.textContent = 'Add a description…';
  const edit = () => {
    const ta = el('textarea', { name: 'description', class: 'desc-textarea', rows: 5, 'aria-label': 'description', placeholder: 'Description (markdown)' });
    ta.value = item.description || '';
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && ta.value !== (item.description || '')) saver({ description: ta.value });
      else ta.replaceWith(view);
    };
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
    view.replaceWith(ta);
    ta.focus();
  };
  view.addEventListener('click', edit);
  view.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); edit(); } });
  box.append(view);
  return box;
}

/** "Blocked by" / "Blocks" lists with add dropdowns (projects and tasks). */
export function dependencyPanel(item, ctx) {
  const panel = el('div', { class: 'deps' });
  if (item.type === 'ongoing') return null;
  if (isDraft(item)) {
    panel.append(el('div', { class: 'deps-note' }, 'Save the item to add dependencies.'));
    return panel;
  }
  const candidates = state.items.filter((it) => it.type !== 'ongoing' && it.id !== item.id);
  const row = (label, ids, dir) => {
    const line = el('div', { class: 'deps-row', dataset: { deps: dir } }, el('span', { class: 'deps-label' }, label));
    for (const id of ids) {
      const other = state.itemsById.get(id);
      if (!other) continue;
      const open = !isClosed(other.status);
      const chip = el('span', { class: `dep-chip ${open ? 'open' : 'closed'}`, dataset: { id: other.id }, title: `${other.key} ${other.title} (${STATUS_LABEL[other.status] || other.status})` },
        el('span', { class: 'dep-key' }, other.key), el('span', { class: 'dep-title' }, other.title),
        el('button', { type: 'button', class: 'dep-remove', title: 'Remove dependency', 'aria-label': `Remove ${other.key}` }, '×'));
      chip.querySelector('.dep-remove').addEventListener('click', async () => {
        const [a, b] = dir === 'blocked_by' ? [other.id, item.id] : [item.id, other.id];
        try { await api.removeDependency(a, b); await ctx.onChanged(); } catch (e) { toast(e.message); }
      });
      line.append(chip);
    }
    const sel = el('select', { class: 'dep-add', 'aria-label': `Add to ${label}` }, el('option', { value: '' }, '+ add…'));
    for (const c of candidates) {
      if (ids.includes(c.id)) continue;
      sel.append(el('option', { value: String(c.id) }, `${c.key} ${c.title}`));
    }
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const other = Number(sel.value);
      const [a, b] = dir === 'blocked_by' ? [other, item.id] : [item.id, other];
      try { await api.addDependency(a, b); await ctx.onChanged(); } catch (e) { toast(e.message); sel.value = ''; }
    });
    line.append(sel);
    return line;
  };
  panel.append(
    row('Blocked by', item.blocked_by || [], 'blocked_by'),
    row('Blocks', item.blocks || [], 'blocks'),
  );
  return panel;
}
