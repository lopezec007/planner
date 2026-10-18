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
import { pin } from './search.js';
import { itemTooltip } from './tooltip.js';

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
    const created = await api.createItem(createBody(d));
    pin(created.id); // keep it visible even if the current filters would hide it
  } catch (e) {
    toast(e.message);
    return false;
  }
  discardNew();
  await ctx.onChanged();
  return true;
}

/** A dropdown opened with showPicker() keeps focus when its native picker is
 *  dismissed by a click elsewhere, so a blur handler alone leaves it open.
 *  Close it on the first pointerdown outside instead. Returns a function that
 *  stops listening (call it from the close path). */
export function closeOnOutsidePointer(node, close) {
  const onDown = (e) => { if (!node.contains(e.target)) { stop(); close(); } };
  const stop = () => document.removeEventListener('pointerdown', onDown, true);
  // Deferred: the click that opened the control must not close it.
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  return stop;
}

export function makeSaver(item, ctx) {
  if (isDraft(item)) {
    // Merge into the draft and redraw so the row reflects the choice (e.g.
    // the picked owner chip); focus is restored by renderTable.
    return async (patch) => { if (draft.item) { Object.assign(draft.item, patch); ctx.rerender(); } };
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

/** The text on a user's chip: the short label from Settings (1-3 characters). */
export const chipLabel = (u) => u.short || u.name;

/** Owner / assignee: the current user's chip (or a dash). Clicking it opens
 *  the picker in place: a row of every user's chip when they all fit in the
 *  cell, else a select. Picking saves; clicking elsewhere or Escape closes it. */
export function userControl(item, field, saver) {
  const name = field === 'owner_id' ? 'owner' : 'assignee';
  const current = item[field];
  const u = current != null ? state.usersById.get(current) : null;
  const chip = u
    ? el('span', { class: 'chip chip-pick', tabindex: '0', role: 'button', title: `${u.name}: click to change`, style: { background: u.color, color: contrastText(u.color) }, dataset: { name, userName: u.name } }, chipLabel(u))
    : el('span', { class: 'chip chip-pick empty', tabindex: '0', role: 'button', title: 'Click to set', dataset: { name }, 'aria-label': `${name}: none` });

  const openSelect = () => {
    const sel = el('select', { name, class: 'cell-select', 'aria-label': name });
    sel.append(el('option', { value: '', selected: current == null ? true : null }, '—'));
    for (const x of state.users) sel.append(el('option', { value: String(x.id), selected: current === x.id ? true : null }, x.name));
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      stopOutside();
      const v = sel.value ? Number(sel.value) : null;
      if (save && v !== (current ?? null)) saver({ [field]: v });
      else sel.replaceWith(chip);
    };
    sel.addEventListener('change', () => finish(true));
    sel.addEventListener('blur', () => finish(false));
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    const stopOutside = closeOnOutsidePointer(sel, () => finish(false));
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
        dataset: { user: String(x.id), userName: x.name }, 'aria-pressed': pressed ? 'true' : 'false',
        style: { background: x.color, color: contrastText(x.color) },
      }, chipLabel(x));
      b.addEventListener('click', () => { done = true; saver({ [field]: pressed ? null : x.id }); });
      wrap.append(b);
    }
    wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) close(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    chip.replaceWith(wrap);
    // The chips sit on one line; if they would overflow the cell, use the
    // dropdown instead.
    if (wrap.scrollWidth > wrap.clientWidth + 1) {
      done = true;
      wrap.replaceWith(chip);
      openSelect();
      return;
    }
    (wrap.querySelector('[aria-pressed="true"]') || wrap.firstElementChild)?.focus();
  };

  const open = state.users.length ? openChips : openSelect;
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

/** Start / end date: a toggle before the date shows "~" while the date is
 *  approximate and a pin once it is firm; the date text becomes a date input
 *  when clicked. */
export function dateControl(item, field, saver, { highlight = false } = {}) {
  const dateKey = `${field}_date`, firmKey = `${field}_firm`;
  const value = item[dateKey];
  const firm = !!item[firmKey];
  const cell = el('div', { class: 'date date-cell' });

  const tilde = el('button', {
    type: 'button', name: firmKey, class: `firm-toggle ${firm ? 'firm' : 'approx'}`,
    'aria-pressed': firm ? 'true' : 'false', 'aria-label': firm ? 'Firm date' : 'Approximate date',
    title: firm ? 'Firm date: it will not move. Click to mark it approximate (~).' : 'Approximate date (~): a best guess that may move. Click to pin it as firm.',
    hidden: value ? null : true,
  }, firm ? '📌' : '~');
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
      // Only the key shows; the title, status and description come up in a
      // tooltip (the same one as the Matrix points) on mouseover.
      const chip = el('span', { class: `dep-chip ${open ? 'open' : 'closed'}`, dataset: { id: other.id }, 'aria-label': `${other.key} ${other.title}` },
        el('span', { class: 'dep-key' }, other.key),
        el('button', { type: 'button', class: 'dep-remove', title: `Remove ${other.key} ${other.title}`, 'aria-label': `Remove ${other.key}` }, '×'));
      const tip = itemTooltip();
      chip.addEventListener('pointerenter', () => tip.show(other, chip));
      chip.addEventListener('pointerleave', () => tip.hide());
      chip.querySelector('.dep-remove').addEventListener('click', async () => {
        const [a, b] = dir === 'blocked_by' ? [other.id, item.id] : [item.id, other.id];
        try { await api.removeDependency(a, b); await ctx.onChanged(); } catch (e) { toast(e.message); }
      });
      line.append(chip);
    }
    // A small "+" that becomes the dropdown of candidates when clicked.
    const addBtn = el('button', { type: 'button', class: 'dep-add-btn', title: `Add to ${label}…`, 'aria-label': `Add to ${label}` }, '+');
    addBtn.addEventListener('click', () => {
      const sel = el('select', { class: 'dep-add', 'aria-label': `Add to ${label}` }, el('option', { value: '' }, 'Choose an item…'));
      for (const c of candidates) {
        if (ids.includes(c.id)) continue;
        sel.append(el('option', { value: String(c.id) }, `${c.key} ${c.title}`));
      }
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        stopOutside();
        const v = sel.value ? Number(sel.value) : null;
        if (!save || v == null) { sel.replaceWith(addBtn); return; }
        const [a, b] = dir === 'blocked_by' ? [v, item.id] : [item.id, v];
        try {
          await api.addDependency(a, b);
          await ctx.onChanged();
        } catch (e) {
          // A rejected cycle needs reading: show it for longer than usual.
          toast(e.message, 8000);
          sel.replaceWith(addBtn);
        }
      };
      sel.addEventListener('change', () => finish(true));
      sel.addEventListener('blur', () => finish(false));
      sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
      const stopOutside = closeOnOutsidePointer(sel, () => finish(false));
      addBtn.replaceWith(sel);
      sel.focus();
      try { sel.showPicker?.(); } catch {}
    });
    line.append(addBtn);
    return line;
  };
  panel.append(
    row('Blocked by', item.blocked_by || [], 'blocked_by'),
    row('Blocks', item.blocks || [], 'blocks'),
  );
  return panel;
}

// ---------------------------------------------------------------- attachments

/** Types a browser can show itself: these open in a new tab, others download.
 *  Mirrors the server's rule (Content-Disposition inline vs attachment). */
export function isRenderable(contentType) {
  const t = (contentType || '').split(';')[0].trim().toLowerCase();
  return t.startsWith('image/') || t.startsWith('video/') || t.startsWith('audio/') || t.startsWith('text/')
    || t === 'application/pdf' || t === 'application/json';
}

export function formatSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fileIcon(contentType) {
  const t = (contentType || '').toLowerCase();
  if (t.startsWith('image/')) return '🖼';
  if (t.startsWith('video/')) return '🎞';
  if (t.startsWith('audio/')) return '🎵';
  if (t === 'application/pdf') return '📄';
  if (t.startsWith('text/') || t === 'application/json') return '📝';
  if (/zip|compressed|tar|7z|rar/.test(t)) return '🗜';
  return '📎';
}

/** "📎 3" after the title of an item with attachments; clicking expands the row. */
export function attachmentBadge(item, onClick) {
  const n = item.attachments?.length || 0;
  if (!n) return null;
  return el('button', {
    type: 'button', class: 'attach-badge', dataset: { attachCount: n },
    title: `${n} attachment${n === 1 ? '' : 's'}: click to show`, 'aria-label': `${n} attachment${n === 1 ? '' : 's'}`,
    onClick: (e) => { e.stopPropagation(); onClick(); },
  }, '📎', n > 1 ? el('span', { class: 'attach-count' }, String(n)) : null);
}

/** The attachments section of the expanded row: an "Attachments" header
 *  with a "+" button (or drop files anywhere on the section) and, below it,
 *  one chip per file (a link that opens renderable files in a new tab and
 *  downloads the rest) with a remove button on each. */
export function attachmentsPanel(item, ctx) {
  if (isDraft(item)) return null;
  const files = item.attachments || [];
  const box = el('div', { class: 'attachments', dataset: { attachments: item.id } });
  const list = el('div', { class: 'attach-list' });
  for (const a of files) {
    const renderable = isRenderable(a.content_type);
    const link = el('a', {
      class: 'attach-chip', href: `/api/attachments/${a.id}`, dataset: { attachment: a.id },
      title: `${a.name} · ${formatSize(a.size)} · ${a.content_type}${renderable ? ' (opens in a new tab)' : ' (downloads)'}`,
      target: renderable ? '_blank' : null, rel: renderable ? 'noopener' : null, download: renderable ? null : a.name,
    }, el('span', { class: 'attach-icon', 'aria-hidden': 'true' }, fileIcon(a.content_type)),
      el('span', { class: 'attach-name' }, a.name), el('span', { class: 'attach-size' }, formatSize(a.size)));
    const rm = el('button', { type: 'button', class: 'attach-remove', title: 'Remove attachment (Ctrl+Z restores it)', 'aria-label': `Remove ${a.name}` }, '×');
    rm.addEventListener('click', async () => {
      try { await api.deleteAttachment(a.id, item.id, a.name); await ctx.onChanged(); } catch (e) { toast(e.message); }
    });
    list.append(el('span', { class: 'attach-item' }, link, rm));
  }
  const input = el('input', { type: 'file', multiple: true, name: 'attach-files', class: 'attach-input', 'aria-label': 'Attach files', tabindex: '-1' });
  const add = el('button', { type: 'button', class: 'attach-add', title: 'Attach files of any type (or drop them here)', 'aria-label': 'Attach files' }, '+');
  const status = el('span', { class: 'attach-status', hidden: true });
  const upload = async (picked) => {
    const all = [...picked].filter(Boolean);
    const chosen = all.filter((f) => f.size > 0);
    if (chosen.length < all.length) toast(`Skipped ${all.length - chosen.length} empty file(s)`);
    if (!chosen.length) return;
    add.disabled = true;
    status.textContent = `Uploading ${chosen.length === 1 ? chosen[0].name : `${chosen.length} files`}…`;
    status.hidden = false;
    try {
      await api.uploadAttachments(item.id, chosen);
      await ctx.onChanged();
    } catch (e) {
      toast(e.message);
      add.disabled = false;
      status.hidden = true;
    }
  };
  add.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { upload(input.files); input.value = ''; });
  // Files dragged from the desktop can be dropped on the strip.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  box.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('drop-files'); } });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop-files'); });
  box.addEventListener('drop', (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); box.classList.remove('drop-files'); upload(e.dataTransfer.files); } });
  box.append(el('div', { class: 'attach-head' }, el('span', { class: 'attach-label' }, 'Attachments'), add, status, input), list);
  return box;
}
