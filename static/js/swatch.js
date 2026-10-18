// The colour swatch before the title of an Ongoing or Project row.
//
//   colorSwatch(item, saver) -> <button> showing the item's effective colour
//
// Clicking it opens a small popover: a palette, a Custom… button (the
// browser's colour picker) and "<Type> colour" to drop the item's own colour
// again. The colour is saved on the item (shared by everyone); whether it
// shows is the per-user "parent_colors" preference (see colors.js).

import { el } from './util.js';
import { ownColor } from './colors.js';
import { prefs } from './prefs.js';

// The users' palette plus the two default type colours.
export const PALETTE = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948',
  '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#2a9d8f', '#5b6cff',
];

let current = null; // { pop, close }

function closePopover() {
  if (!current) return;
  const { pop, onDown, onKey } = current;
  current = null;
  pop.remove();
  document.removeEventListener('pointerdown', onDown, true);
  document.removeEventListener('keydown', onKey, true);
}

function openPopover(anchor, item, saver) {
  closePopover();
  const typeName = item.type === 'ongoing' ? 'Ongoing' : 'Project';
  const pop = el('div', { class: 'color-pop', role: 'dialog', 'aria-label': `Colour of ${item.key}`, dataset: { colorFor: item.id } });
  const choose = (color) => { closePopover(); saver({ color }); };
  const grid = el('div', { class: 'color-grid' });
  for (const c of PALETTE) {
    grid.append(el('button', {
      type: 'button', class: 'color-opt', style: { background: c }, dataset: { color: c },
      'aria-label': c, title: c, 'aria-pressed': item.color === c ? 'true' : 'false', onClick: () => choose(c),
    }));
  }
  const input = el('input', { type: 'color', class: 'color-custom-input', 'aria-label': 'Custom colour', tabindex: '-1', value: item.color || ownColor(item) || '#888888' });
  input.addEventListener('change', () => choose(input.value));
  const custom = el('button', { type: 'button', class: 'color-custom', title: 'Any colour', onClick: () => input.click() }, 'Custom…');
  const none = el('button', {
    type: 'button', class: 'color-none', disabled: item.color ? null : true,
    title: `No colour of its own: use the ${typeName} colour from Settings`, onClick: () => choose(''),
  }, `${typeName} colour`);
  pop.append(grid, el('div', { class: 'color-actions' }, custom, none, input));
  document.body.append(pop);
  // Below the swatch, kept inside the viewport.
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 200;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 4}px`;
  const onDown = (e) => { if (!pop.contains(e.target) && e.target !== anchor) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') { closePopover(); anchor.focus(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  current = { pop, onDown, onKey };
  (pop.querySelector('[aria-pressed="true"]') || grid.firstElementChild).focus();
}

export function colorSwatch(item, saver) {
  const own = item.color || '';
  const effective = ownColor(item);
  const typeName = item.type === 'ongoing' ? 'Ongoing' : 'Project';
  const hiddenByPref = own && prefs.get('parent_colors') === 'type';
  const title = own
    ? `Colour ${own}${hiddenByPref ? ' (your Colours menu shows the type colour instead)' : ''}: click to change it. Everyone sees it.`
    : `${typeName} colour from Settings: click to give this item a colour of its own (everyone sees it).`;
  const btn = el('button', {
    type: 'button', name: 'color', class: `color-swatch ${own ? 'own' : 'type'}${effective ? '' : ' none'}`,
    dataset: { color: own }, title, 'aria-label': `Colour of ${item.key}`, 'aria-haspopup': 'dialog',
  });
  if (effective) btn.style.background = effective;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (current && current.pop.dataset.colorFor === String(item.id)) closePopover();
    else openPopover(btn, item, saver);
  });
  return btn;
}
