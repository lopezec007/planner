// Users page: list, add, rename, recolour and delete users.
//
// renderUsers(main, ctx)   ctx = { reload() } reloads state and re-renders.
//
// TODO(users agent): implement.

import { el } from './util.js';

export function renderUsers(main, ctx) {
  main.replaceChildren(el('div', { class: 'empty' }, 'Users page not yet implemented.'));
}
