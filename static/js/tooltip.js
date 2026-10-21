// Item tooltip: for a task, its Ongoing/Project (key and title, muted) above
// the key and title; then the urgency/importance/status/assignee/blocked
// line and the rendered description. One shared element on the body, placed
// beside an anchor element; used by the Matrix points and the dependency
// chips. itemTooltip() returns { show(item, anchor), hide() }.

import { state, isClosed, isBlocked, openBlockers, STATUS_LABEL } from './state.js';
import { renderMarkdown } from './markdown.js';
import { el } from './util.js';

const level = (n) => (n == null ? 5 : Math.max(0, Math.min(10, Number(n))));

function assigneeName(item) {
  if (item.assignee_id == null) return null;
  return state.usersById.get(item.assignee_id)?.name ?? `#${item.assignee_id}`;
}

let shared = null;

export function itemTooltip() {
  if (shared) return shared;
  const tip = el('div', { class: 'item-tip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  let hideTimer = null;
  let current = null;

  function fill(item) {
    const parent = item.type === 'task' && item.parent_id != null ? state.itemsById.get(item.parent_id) : null;
    const header = el('div', { class: 'tip-head' },
      el('span', { class: 'tip-key' }, item.key),
      el('span', { class: 'tip-title' }, item.title));
    const meta = el('div', { class: 'tip-meta' });
    if (item.type === 'task') {
      meta.append(
        el('span', {}, el('b', {}, String(level(item.urgency))), ' urgency'),
        el('span', {}, el('b', {}, String(level(item.importance))), ' importance'));
    }
    if (item.status) meta.append(el('span', { class: isClosed(item.status) ? 'tip-closed' : '' }, STATUS_LABEL[item.status] || item.status));
    const who = assigneeName(item);
    if (who) meta.append(el('span', {}, who));
    if (item.start_date || item.end_date) meta.append(el('span', { class: 'tip-dates' }, `${item.start_date || '…'} → ${item.end_date || '…'}`));
    if (isBlocked(item)) {
      const by = openBlockers(item).map((b) => b.key);
      meta.append(el('span', { class: 'tip-blocked' }, by.length ? `Blocked by ${by.join(', ')}` : 'Blocked'));
    }
    tip.replaceChildren(...(parent ? [el('div', { class: 'tip-parent' }, el('span', { class: 'tip-parent-key' }, parent.key), ' ', parent.title)] : []), header, meta);
    if (item.description && item.description.trim()) {
      const md = el('div', { class: 'md tip-desc' });
      md.innerHTML = renderMarkdown(item.description);
      tip.append(md);
    }
  }

  function place(anchor) {
    const pad = 8;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.maxHeight = `${Math.max(120, vh - 2 * pad)}px`;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.right + 10;
    if (left + tw > vw - pad) left = r.left - 10 - tw; // flip to the left
    if (left < pad) left = Math.max(pad, Math.min(vw - pad - tw, r.left));
    let top = r.top + r.height / 2 - th / 2;
    top = Math.max(pad, Math.min(vh - pad - th, top));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  shared = {
    show(item, anchor) {
      clearTimeout(hideTimer);
      hideTimer = null;
      if (current !== item) { fill(item); current = item; }
      tip.hidden = false;
      place(anchor);
    },
    // Deferred so that moving across the gap between two nearby anchors does
    // not blink the tooltip off and on.
    hide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { tip.hidden = true; current = null; }, 120);
    },
    el: tip,
  };
  return shared;
}
