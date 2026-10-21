// Live updates: changes made elsewhere reach this page without a manual
// refresh. The server announces every change on GET /api/events (server-sent
// events; see internal/api/events.go) as {kind, scope, client, rev}.
//
// startRealtime({ reload, busy }) opens the stream and calls reload() when
// another client changed something, waiting while busy() is true (an edit is
// in progress here) and catching up as soon as it is not. Bursts of events
// are folded into one reload. After the browser reconnects a dropped stream
// the page reloads once, since changes may have gone by meanwhile.
//
// subscribe(fn) hands every event to fn as well (the page's own echoes
// included: compare ev.client with clientId), plus a synthetic
// {kind: 'reconnect'} after a reconnect, so modules that keep their own
// data (the scratch pad) can refetch it.

import { clientId } from './api.js';

const DEBOUNCE_MS = 150; // fold a burst of events into one reload
const RECHECK_MS = 500;  // how often a deferred reload is retried while editing

const listeners = new Set();

/** Receive every event; returns a function that unsubscribes. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(ev) {
  for (const fn of listeners) {
    try { fn(ev); } catch (e) { console.error('realtime listener', e); }
  }
}

export function startRealtime(ctx) {
  if (typeof EventSource === 'undefined') return;
  let timer = null;
  let pending = false; // a reload is owed once the page is no longer busy
  let dropped = false; // the stream broke; the next open is a reconnect

  const flush = () => {
    timer = null;
    if (ctx.busy()) { pending = true; return; }
    pending = false;
    ctx.reload();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };
  setInterval(() => { if (pending && !timer && !ctx.busy()) schedule(); }, RECHECK_MS);

  const es = new EventSource('/api/events');
  es.addEventListener('message', (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    emit(ev);
    if (ev.client && ev.client === clientId) return; // our own change; the page already reloaded
    schedule();
  });
  // The browser retries on its own; what matters is to catch up afterwards.
  es.addEventListener('error', () => { dropped = true; });
  es.addEventListener('open', () => {
    if (!dropped) return;
    dropped = false;
    emit({ kind: 'reconnect', client: '', rev: 0 });
    schedule();
  });
}
