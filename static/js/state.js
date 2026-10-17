// Client-side cache of users and items, plus date helpers that use the
// browser's local timezone (the spec requires "today" to be the user's day).

import { api } from './api.js';

export const state = {
  users: [],
  usersById: new Map(),
  items: [],
  itemsById: new Map(),
  childrenOf: new Map(), // parent id -> [task...] in sort order
  settings: {},          // app settings from /api/settings (defaults applied by the server)
  loaded: false,
};

export async function load() {
  const [users, items, settings] = await Promise.all([api.listUsers(), api.listItems(), api.getSettings()]);
  state.settings = settings;
  state.users = users;
  state.usersById = new Map(users.map((u) => [u.id, u]));
  state.items = items;
  state.itemsById = new Map(items.map((i) => [i.id, i]));
  state.childrenOf = new Map();
  for (const it of items) {
    if (it.parent_id == null) continue;
    if (!state.childrenOf.has(it.parent_id)) state.childrenOf.set(it.parent_id, []);
    state.childrenOf.get(it.parent_id).push(it);
  }
  state.loaded = true;
  return state;
}

export const STATUSES = ['idea', 'backlog', 'todo', 'in-progress', 'done', 'cancelled'];
export const STATUS_LABEL = {
  idea: 'Idea', backlog: 'Backlog', todo: 'To-Do', 'in-progress': 'In-Progress',
  done: 'Done', cancelled: 'Cancelled',
};
export const isClosed = (status) => status === 'done' || status === 'cancelled';
export const isParent = (it) => it.type === 'ongoing' || it.type === 'project';

// ---- dependencies ----
// Items carry blocked_by / blocks (ids of live projects and tasks). An item
// counts as blocked when its own flag is set or any blocker is still open.

/** Live items that block `it` and are not done/cancelled. */
export function openBlockers(it) {
  const out = [];
  for (const id of it.blocked_by || []) {
    const b = state.itemsById.get(id);
    if (b && !isClosed(b.status)) out.push(b);
  }
  return out;
}

/** Effective blocked state: the stored flag (tasks) or any open blocker. */
export function isBlocked(it) {
  return !!it.blocked || openBlockers(it).length > 0;
}

/** All dependency edges among live items as [{ blocker, blocked }] (items). */
export function dependencyEdges() {
  const edges = [];
  for (const it of state.items) {
    for (const id of it.blocks || []) {
      const b = state.itemsById.get(id);
      if (b) edges.push({ blocker: it, blocked: b });
    }
  }
  return edges;
}

// ---- dates (all in the browser's local timezone) ----

const pad = (n) => String(n).padStart(2, '0');

/** Format a Date as YYYY-MM-DD using local time. */
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a local-midnight Date. */
export function parseYMD(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return ymd(new Date());
}

/** Whole calendar days from today to the given YYYY-MM-DD (negative = past). */
export function daysFromToday(s) {
  const t = parseYMD(today());
  const d = parseYMD(s);
  if (!d) return null;
  return Math.round((d - t) / 86400000);
}

export function addDays(s, n) {
  const d = parseYMD(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** True if an RFC3339 timestamp is within the last `days` days. */
export function withinLastDays(ts, days) {
  if (!ts) return false;
  return Date.now() - Date.parse(ts) <= days * 86400000;
}
