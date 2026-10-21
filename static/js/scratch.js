// Scratch pad: a panel at the left of the page with two plain-text panes,
// "Shared" (everyone sees and edits the same text) above the current
// account's own. renderScratch({ account, page }) is called by app.js on
// every render; the panel is built once and kept, so typing is never
// interrupted by a re-render, and only the per-user pane is swapped when
// the account changes.
//
// Each pane autosaves (debounced after typing, at once on blur) through
// GET/PUT /api/scratch and /api/users/{id}/scratch, showing "Saving…",
// "Saved" or the error beside its label. Changes from other clients arrive
// as 'scratch' events (realtime.js) and replace the pane's text, but never
// while it is focused or has unsaved edits: then the update waits for the
// save or the blur.
//
// Open/closed, width, the split between the panes and line wrapping are
// preferences (scratch_open, scratch_width, scratch_split, scratch_wrap).

import { api, clientId } from './api.js';
import { prefs } from './prefs.js';
import { state } from './state.js';
import { el } from './util.js';
import { subscribe } from './realtime.js';

const SAVE_DELAY_MS = 400;  // after the last keystroke
const SAVED_SHOWN_MS = 2000; // how long "Saved" stays
const WIDTH_MIN = 160, WIDTH_MAX = 2000; // px
const SPLIT_MIN = 5, SPLIT_MAX = 95;     // percent of the panel for the Shared pane

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

let panel = null;    // <aside id="scratch">, built on the first render
let button = null;   // #btn-scratch in the title bar
let panesBox = null; // the two panes and the splitter between them
let wrapBox = null;  // the Wrap checkbox
let shared = null;   // the Shared pane
let own = null;      // the current account's pane, or null while there is none
let ownEl = null;    // the element in the per-user slot (a pane or a note)
let ownAccount = null; // the account own was built for
let dragging = false;

/** One pane: a label with a status, and a textarea that autosaves through
 *  load()/save(text). */
function makePane({ id, name, load, save }) {
  const status = el('span', { class: 'scratch-status', 'aria-live': 'polite' });
  const nameEl = el('span', { class: 'scratch-name' }, name);
  const ta = el('textarea', { id, class: 'scratch-text', spellcheck: 'false', 'aria-label': `${name} scratch pad`, placeholder: 'Notes…' });
  const section = el('section', { class: 'scratch-pane' }, el('div', { class: 'scratch-label' }, nameEl, status), ta);
  const p = { el: section, ta, nameEl };
  let dirty = false;   // the textarea holds text not yet saved
  let saving = false;  // a PUT is in flight
  let remote = false;  // another client changed the text while we could not take it
  let timer = null;
  let statusTimer = null;
  const focused = () => document.activeElement === ta;

  const setStatus = (text, error = false) => {
    clearTimeout(statusTimer);
    status.textContent = text;
    status.classList.toggle('error', error);
    if (text === 'Saved') statusTimer = setTimeout(() => { status.textContent = ''; }, SAVED_SHOWN_MS);
  };

  /** Save now (if there is anything unsaved); afterwards take a waiting
   *  remote update or save again if typing went on meanwhile. */
  p.save = async () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty || saving) return;
    saving = true;
    const text = ta.value;
    setStatus('Saving…');
    try {
      await save(text);
      if (ta.value === text) dirty = false;
      setStatus('Saved');
    } catch (e) {
      // Left dirty: the next keystroke or blur tries again.
      setStatus(e.message, true);
      saving = false;
      return;
    }
    saving = false;
    if (dirty) schedule();
    else if (remote) p.refresh();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(p.save, SAVE_DELAY_MS);
  };

  /** Fetch the stored text and show it, unless the pane is being edited
   *  (then it is applied once the edit is saved or the focus leaves). */
  p.refresh = async () => {
    if (focused() || dirty || saving) { remote = true; return; }
    remote = false;
    let r;
    try {
      r = await load();
    } catch (e) {
      setStatus(e.message, true);
      return;
    }
    if (focused() || dirty || saving) { remote = true; return; } // typing started meanwhile
    if (ta.value !== r.text) ta.value = r.text;
  };

  ta.addEventListener('input', () => { dirty = true; setStatus(''); schedule(); });
  ta.addEventListener('blur', () => { if (dirty) p.save(); else if (remote) p.refresh(); });
  return p;
}

// ---------------------------------------------------------------- preferences

const isOpen = () => prefs.get('scratch_open') === '1';
const width = () => clamp(Number(prefs.get('scratch_width')) || 320, WIDTH_MIN, WIDTH_MAX);
const split = () => clamp(Number(prefs.get('scratch_split')) || 50, SPLIT_MIN, SPLIT_MAX);

function applyOpen() {
  const open = isOpen();
  panel.hidden = !open;
  button.setAttribute('aria-pressed', open ? 'true' : 'false');
  button.classList.toggle('active', open);
  button.title = open ? 'Hide the scratch pad' : 'Scratch pad';
}
function applyWidth(w) { panel.style.width = `${w}px`; }
function applySplit(pct) {
  shared.el.style.flexGrow = String(pct);
  ownEl.style.flexGrow = String(100 - pct);
}
function applyWrap() {
  const wrap = prefs.get('scratch_wrap') !== '0';
  wrapBox.checked = wrap;
  panel.classList.toggle('nowrap', !wrap);
  for (const ta of panel.querySelectorAll('.scratch-text')) ta.setAttribute('wrap', wrap ? 'soft' : 'off');
}

/** Pointer dragging on a splitter: onMove(event) while dragging, onEnd()
 *  on release. */
function draggable(handle, onMove, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    dragging = true;
    panel.classList.add('dragging');
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      panel.classList.remove('dragging');
      dragging = false;
      onEnd();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------------- build

function build() {
  panel = document.getElementById('scratch');
  button = document.getElementById('btn-scratch');

  wrapBox = el('input', { type: 'checkbox', id: 'scratch-wrap' });
  wrapBox.addEventListener('change', () => { prefs.set('scratch_wrap', wrapBox.checked ? '1' : '0'); applyWrap(); });
  const head = el('div', { class: 'scratch-head' },
    el('span', { class: 'scratch-title' }, 'Scratch pad'),
    el('label', { class: 'scratch-wrap', title: 'Wrap long lines' }, wrapBox, ' Wrap'));

  shared = makePane({ id: 'scratch-global', name: 'Shared', load: api.getScratch, save: api.putScratch });
  ownEl = el('section', { class: 'scratch-pane' });
  const hsplit = el('div', { class: 'scratch-hsplit', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the panes', title: 'Drag to resize the panes' });
  panesBox = el('div', { class: 'scratch-panes' }, shared.el, hsplit, ownEl);
  const vsplit = el('div', { class: 'scratch-vsplit', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the scratch pad', title: 'Drag to resize the scratch pad' });
  panel.replaceChildren(head, panesBox, vsplit);

  let w = width();
  draggable(vsplit, (e) => {
    w = clamp(Math.round(e.clientX - panel.getBoundingClientRect().left), WIDTH_MIN, WIDTH_MAX);
    applyWidth(w);
  }, () => prefs.set('scratch_width', String(w)));
  let pct = split();
  draggable(hsplit, (e) => {
    const r = panesBox.getBoundingClientRect();
    pct = clamp(Math.round(((e.clientY - r.top) / r.height) * 100), SPLIT_MIN, SPLIT_MAX);
    applySplit(pct);
  }, () => prefs.set('scratch_split', String(pct)));

  button.addEventListener('click', () => { prefs.set('scratch_open', isOpen() ? '0' : '1'); applyOpen(); });
  // A pane's unsaved text goes out when the page is hidden (tab switch, close).
  document.addEventListener('visibilitychange', () => { if (document.hidden) { shared.save(); own?.save(); } });
  subscribe(onEvent);
  shared.refresh();
}

/** Other clients' changes: refetch the pane concerned. After a reconnect
 *  both are refetched, since events may have been missed. */
function onEvent(ev) {
  if (ev.kind === 'reconnect') { shared.refresh(); own?.refresh(); return; }
  if (ev.kind !== 'scratch' || ev.client === clientId) return;
  if (ev.scope === 'global') shared.refresh();
  else if (own && ev.scope === `user:${ownAccount}`) own.refresh();
}

/** The per-user slot: the account's pane, or a note when there is no
 *  account to keep one for. Rebuilt only when the account changes (a
 *  renamed account just gets its label updated). */
let ownSig = null;
function syncOwn(account) {
  const u = account != null ? state.usersById.get(account) : null;
  const sig = u ? `user:${u.id}` : `note:${state.users.length ? 'pick' : 'add'}`;
  if (sig === ownSig) {
    if (u && own.nameEl.textContent !== u.name) own.nameEl.textContent = u.name;
    return;
  }
  own?.save(); // the old pane's unsaved text, bound to its own account
  ownSig = sig;
  ownAccount = u ? u.id : null;
  let next;
  if (u) {
    own = makePane({ id: 'scratch-user', name: u.name, load: () => api.getUserScratch(u.id), save: (t) => api.putUserScratch(u.id, t) });
    next = own.el;
  } else {
    own = null;
    const note = state.users.length
      ? 'Pick an account in the menu at the top right to get a pad of your own.'
      : 'Add people under Settings, then pick an account to get a pad of your own.';
    next = el('section', { class: 'scratch-pane' },
      el('div', { class: 'scratch-label' }, el('span', { class: 'scratch-name' }, 'Yours')),
      el('p', { class: 'scratch-note', id: 'scratch-user-note' }, note));
  }
  ownEl.replaceWith(next);
  ownEl = next;
  applyWrap();
  own?.refresh();
}

export function renderScratch({ account }) {
  if (!panel) build();
  syncOwn(account ?? null);
  applyOpen();
  applyWrap();
  if (!dragging) { applyWidth(width()); applySplit(split()); }
}
