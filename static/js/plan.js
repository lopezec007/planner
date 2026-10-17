// Plan view: Gantt-style timeline rendered beside the title-only table.
//
// renderPlan(panel, handle, ctx)
//   panel   the right-hand container element
//   handle  the table handle from renderTable: rows [{ item, el, kind }] in
//           display order; use el.offsetTop/offsetHeight to align bars.
//   ctx     { rerender() } to redraw after data changes
//
// TODO(plan agent): implement per spec.md "Plan" view.

import { el } from './util.js';

export function renderPlan(panel, handle, ctx) {
  panel.replaceChildren(el('div', { class: 'empty' }, 'Plan view not yet implemented.'));
}
