// Thin fetch wrappers around the JSON API. Every function returns a promise
// that rejects with an Error whose message is the server's error text.

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

export const api = {
  listUsers: () => req('GET', '/api/users'),
  createUser: (body) => req('POST', '/api/users', body),
  updateUser: (id, body) => req('PATCH', `/api/users/${id}`, body),
  deleteUser: (id) => req('DELETE', `/api/users/${id}`),

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

  getSettings: () => req('GET', '/api/settings'),
  // body: {key: value, ...}; returns the full settings
  updateSettings: (body) => req('PATCH', '/api/settings', body),
};
