// Users page: list, add, rename, recolour and delete users.
//
// renderUsers(main, ctx)   ctx = { reload() } reloads state and re-renders.
//
// Each user is shown as a row: a chip preview (how the user appears in the
// Owner/Assignee columns) with an input for its label (1-3 characters), an
// inline name input (Enter or blur saves), a colour picker (saves when the
// picker closes) and a Delete button. Deleting a user
// that is still referenced by live items fails with the server's 409 message,
// which is shown as a toast.

import { api } from './api.js';
import { state } from './state.js';
import { el, toast, contrastText } from './util.js';

function chip(label, name, color) {
  return el('span', { class: 'chip', style: { background: color, color: contrastText(color) }, title: name }, label);
}

export const SHORT_MAX = 3;

function addForm(ctx) {
  const input = el('input', {
    type: 'text', id: 'new-user-name', placeholder: 'New user name', autocomplete: 'off', maxlength: '255',
  });
  const form = el('form', { class: 'user-add', onSubmit: async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      await api.createUser({ name }); // colour is auto-assigned by the server
      input.value = '';
      await ctx.reload();
    } catch (err) {
      toast(err.message);
    }
  } }, input, el('button', { type: 'submit', class: 'primary', id: 'btn-add-user' }, 'Add user'));
  return form;
}

function userRow(u, ctx) {
  const preview = chip(u.short || u.name, u.name, u.color);

  // The chip label: up to SHORT_MAX characters; Enter or blur saves.
  const short = el('input', {
    type: 'text', class: 'user-short', value: u.short || '', maxlength: String(SHORT_MAX), 'aria-label': `Chip label of ${u.name}`,
    title: `The label on ${u.name}'s chip (1 to ${SHORT_MAX} characters)`, autocomplete: 'off', spellcheck: 'false',
    onInput: () => { preview.textContent = short.value.trim() || u.short; },
    onChange: async () => {
      const next = short.value.trim();
      if (!next || [...next].length > SHORT_MAX) { short.value = u.short; preview.textContent = u.short; toast(`The chip label must be 1 to ${SHORT_MAX} characters.`); return; }
      if (next === u.short) { short.value = u.short; return; }
      try {
        await api.updateUser(u.id, { short: next });
        await ctx.reload();
      } catch (err) {
        short.value = u.short;
        preview.textContent = u.short;
        toast(err.message);
      }
    },
    onKeydown: (e) => { if (e.key === 'Escape') { short.value = u.short; preview.textContent = u.short; short.blur(); } if (e.key === 'Enter') short.blur(); },
  });

  const name = el('input', {
    type: 'text', class: 'user-name', value: u.name, 'aria-label': `Name of ${u.name}`, maxlength: '255',
    onChange: async () => {
      const next = name.value.trim();
      if (!next) { name.value = u.name; toast('Name is required.'); return; }
      if (next === u.name) { name.value = u.name; return; }
      try {
        await api.updateUser(u.id, { name: next });
        await ctx.reload();
      } catch (err) {
        name.value = u.name;
        toast(err.message);
      }
    },
    onKeydown: (e) => { if (e.key === 'Escape') { name.value = u.name; name.blur(); } },
  });

  const color = el('input', {
    type: 'color', class: 'user-color', value: u.color, 'aria-label': `Colour of ${u.name}`, title: 'Change colour',
    // live preview while the picker is open; persist once it closes
    onInput: () => { preview.style.background = color.value; preview.style.color = contrastText(color.value); },
    onChange: async () => {
      if (color.value === u.color) return;
      try {
        await api.updateUser(u.id, { color: color.value });
        await ctx.reload();
      } catch (err) {
        color.value = u.color;
        toast(err.message);
      }
    },
  });

  const del = el('button', {
    type: 'button', class: 'icon user-delete', title: `Delete ${u.name}`, 'aria-label': `Delete ${u.name}`,
    onClick: async () => {
      if (!confirm(`Delete user "${u.name}"?`)) return;
      try {
        await api.deleteUser(u.id);
        await ctx.reload();
      } catch (err) {
        toast(err.message);
      }
    },
  }, '🗑');

  return el('div', { class: 'user-row', dataset: { userId: u.id } },
    el('div', { class: 'user-preview' }, preview, short),
    el('div', {}, name),
    el('div', { class: 'user-color-cell' }, color, el('code', { class: 'user-hex' }, u.color)),
    el('div', { class: 'user-actions' }, del),
  );
}

export function renderUsers(main, ctx) {
  const page = el('div', { class: 'users-page' },
    el('div', { class: 'users-head' },
      el('h2', {}, 'Users'),
      el('p', { class: 'users-hint' }, 'Each user gets a colour and a short chip label (up to three characters), used in the Owner and Assignee columns. Click a label or a name to edit it.'),
    ),
    addForm(ctx),
  );

  const list = el('div', { class: 'user-list' });
  if (!state.users.length) {
    list.append(el('div', { class: 'empty' }, 'No users yet. Add one above.'));
  } else {
    list.append(el('div', { class: 'user-row header' },
      el('div', {}, 'Chip'), el('div', {}, 'Name'), el('div', {}, 'Colour'), el('div')));
    for (const u of state.users) list.append(userRow(u, ctx));
  }
  page.append(list);
  main.replaceChildren(page);
}
