// Matrix view: urgency (x) vs importance (y) scatter of visible tasks.
//
// renderMatrix(panel, handle, ctx)
//   panel   the right-hand container element
//   handle  the table handle from renderTable: rows [{ item, el, kind }]
//   ctx     { rerender() }
//
// TODO(matrix agent): implement per spec.md "Matrix" view.

import { el } from './util.js';

export function renderMatrix(panel, handle, ctx) {
  panel.replaceChildren(el('div', { class: 'empty' }, 'Matrix view not yet implemented.'));
}
