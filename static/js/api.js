// Thin fetch wrappers around the JSON API. Every function returns a promise
// that rejects with an Error whose message is the server's error text.
//
// Item mutations are tracked for undo (Ctrl+Z): each records an inverse
// operation on an in-memory stack scoped to this browser session (the last
// UNDO_MAX changes). `undo()` pops and runs one inverse; `group()` merges the
// records made inside a callback into a single undo step.

import { state } from './state.js';

// This page's id, sent with every request as X-Planner-Client. The server
// puts it in the events it announces (realtime.js), so the page can tell its
// own changes from everyone else's.
export const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function req(method, path, body) {
  const opts = { method, headers: { 'X-Planner-Client': clientId } };
  if (body instanceof FormData) {
    opts.body = body; // the browser sets the multipart boundary
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

const raw = {
  listUsers: () => req('GET', '/api/users'),
  createUser: (body) => req('POST', '/api/users', body),
  updateUser: (id, body) => req('PATCH', `/api/users/${id}`, body),
  deleteUser: (id) => req('DELETE', `/api/users/${id}`),
  // Per-user preferences (see prefs.js): {key: value}; PATCH returns the full map
  getUserPrefs: (id) => req('GET', `/api/users/${id}/prefs`),
  updateUserPrefs: (id, body) => req('PATCH', `/api/users/${id}/prefs`, body),

  listItems: () => req('GET', '/api/items'),
  getItem: (id) => req('GET', `/api/items/${id}`),
  // body: {type, title, parent_id?, status?, ...}
  createItem: (body) => req('POST', '/api/items', body),
  // body: partial fields; explicit null clears nullable fields
  updateItem: (id, body) => req('PATCH', `/api/items/${id}`, body),
  deleteItem: (id) => req('DELETE', `/api/items/${id}`),
  history: (id) => req('GET', `/api/items/${id}/history`),
  // ids: sibling item ids in the desired order
  reorder: (ids) => req('PUT', '/api/order', { ids }),

  addDependency: (blockerId, blockedId) => req('POST', '/api/dependencies', { blocker_id: blockerId, blocked_id: blockedId }),
  removeDependency: (blockerId, blockedId) => req('DELETE', `/api/dependencies/${blockerId}/${blockedId}`),

  restoreItem: (id) => req('POST', `/api/items/${id}/restore`),

  // Attachments: files stored with an item. Upload takes File objects and
  // returns the created metadata; the bytes are at /api/attachments/{id}.
  listAttachments: (itemId) => req('GET', `/api/items/${itemId}/attachments`),
  uploadAttachments: (itemId, files) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    return req('POST', `/api/items/${itemId}/attachments`, form);
  },
  deleteAttachment: (id) => req('DELETE', `/api/attachments/${id}`),
  restoreAttachment: (id) => req('POST', `/api/attachments/${id}/restore`),
  getVersion: () => req('GET', '/api/version'),
  // Scratch pad (scratch.js): {text, updated_at} for the shared pane and a
  // user's own; PUT replaces the text and returns the same shape.
  getScratch: () => req('GET', '/api/scratch'),
  putScratch: (text) => req('PUT', '/api/scratch', { text }),
  getUserScratch: (id) => req('GET', `/api/users/${id}/scratch`),
  putUserScratch: (id, text) => req('PUT', `/api/users/${id}/scratch`, { text }),
  getSettings: () => req('GET', '/api/settings'),
  // body: {key: value, ...}; returns the full settings
  updateSettings: (body) => req('PATCH', '/api/settings', body),
};

// ---- undo ----
const UNDO_MAX = 20;
const undoStack = [];
let grouping = null;

function record(label, inverse) {
  if (grouping) { grouping.push({ label, inverse }); return; }
  undoStack.push({ label, inverse });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

/** Run fn, recording everything it changes as one undo step. */
export async function group(label, fn) {
  const outer = grouping;
  grouping = [];
  try {
    return await fn();
  } finally {
    const entries = grouping;
    grouping = outer;
    if (entries.length) {
      record(label, async () => { for (const e of entries.reverse()) await e.inverse(); });
    }
  }
}

/** Undo the most recent change; returns its label, or null if nothing to undo. */
export async function undo() {
  const e = undoStack.pop();
  if (!e) return null;
  await e.inverse();
  return e.label;
}

export const undoDepth = () => undoStack.length;

const label = (id) => state.itemsById.get(id)?.key || `#${id}`;

export const api = {
  ...raw,
  async createItem(body) {
    const it = await raw.createItem(body);
    record(`creating ${it.key}`, () => raw.deleteItem(it.id));
    return it;
  },
  async updateItem(id, patch) {
    const before = state.itemsById.get(id);
    const prev = {};
    for (const k of Object.keys(patch)) prev[k] = before ? (before[k] ?? null) : null;
    const it = await raw.updateItem(id, patch);
    if (before) record(`editing ${before.key}`, () => raw.updateItem(id, prev));
    return it;
  },
  async deleteItem(id) {
    const key = label(id);
    await raw.deleteItem(id);
    record(`deleting ${key}`, () => raw.restoreItem(id));
  },
  async reorder(ids) {
    const first = state.itemsById.get(ids[0]);
    const parent = first ? (first.parent_id ?? null) : null;
    const prevOrder = state.items.filter((i) => (i.parent_id ?? null) === parent).map((i) => i.id);
    await raw.reorder(ids);
    record('reordering', () => raw.reorder(prevOrder));
  },
  /** Record the current order of a parent's tasks (null: the top level) as
   *  an undo step, for changes that move an item away from its siblings. */
  rememberOrder(parentId) {
    const ids = state.items.filter((i) => (i.parent_id ?? null) === (parentId ?? null)).map((i) => i.id);
    if (ids.length) record('reordering', () => raw.reorder(ids));
  },
  async addDependency(blockerId, blockedId) {
    await raw.addDependency(blockerId, blockedId);
    record(`adding a dependency to ${label(blockedId)}`, () => raw.removeDependency(blockerId, blockedId));
  },
  async removeDependency(blockerId, blockedId) {
    await raw.removeDependency(blockerId, blockedId);
    record(`removing a dependency from ${label(blockedId)}`, () => raw.addDependency(blockerId, blockedId));
  },
  async uploadAttachments(itemId, files) {
    const created = await raw.uploadAttachments(itemId, files);
    record(`attaching ${created.length === 1 ? created[0].name : `${created.length} files`} to ${label(itemId)}`,
      async () => { for (const a of created) await raw.deleteAttachment(a.id); });
    return created;
  },
  async deleteAttachment(id, itemId, name) {
    await raw.deleteAttachment(id);
    record(`removing ${name || 'an attachment'} from ${label(itemId)}`, () => raw.restoreAttachment(id));
  },
};
