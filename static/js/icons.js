// Inline SVG icons for the toolbar and the row action buttons (16×16, drawn
// with the current text colour so they follow the theme). icon(name) returns
// a fresh <svg>. Action buttons use icons rather than text glyphs so they
// centre the same way in every font and at every screen density.
//
// Buttons that show only an icon must carry an aria-label and a title: the
// label names the control for assistive technology and the title is the
// mouseover description.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Each entry is the inner markup of a 16×16 viewBox; strokes use
// currentColor, 1.7px, round caps and joins unless the entry says otherwise.
const PATHS = {
  'expand-all': '<path d="M4 5.5l4-3.5 4 3.5M4 10.5l4 3.5 4-3.5"/>',
  'collapse-all': '<path d="M4 2l4 3.5 4-3.5M4 14l4-3.5 4 3.5"/>',
  // Show / hide the tasks of every Ongoing and Project (the carets on parent rows).
  'expand-parents': '<path d="M2.5 4l2.5 2.5L7.5 4"/><path d="M9.5 5h4.5M6 9.5h8M6 13.5h8"/>',
  'collapse-parents': '<path d="M3.5 3l2.5 2.5L3.5 8"/><path d="M9 5h5M9 9.5h5M9 13.5h5"/>',
  active: '<path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor" stroke="none"/>',
  backlog: '<path d="M5 4h9M5 8h9M5 12h9"/><circle cx="2.2" cy="4" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.2" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.2" cy="12" r="0.9" fill="currentColor" stroke="none"/>',
  ideas: '<path d="M8 1.5a4.3 4.3 0 0 0-2.4 7.9V11h4.8V9.4A4.3 4.3 0 0 0 8 1.5z"/><path d="M6.2 13.2h3.6M7 15h2"/>',
  filter: '<path d="M1.5 2.5h13l-5 6V13l-3 1.5v-6z"/>',
  clear: '<circle cx="8" cy="8" r="6.3"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/>',
  sort: '<path d="M4.5 2v12M2 11.5L4.5 14 7 11.5M11.5 14V2M9 4.5L11.5 2 14 4.5"/>',
  columns: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.2"/><path d="M6 2.5v11M10 2.5v11"/>',
  // Layout: nested (parent rows with indented tasks) or flat (equal rows).
  nested: '<rect x="1.5" y="1.8" width="13" height="3" rx="0.8"/><rect x="5.5" y="6.5" width="9" height="3" rx="0.8"/><rect x="5.5" y="11.2" width="9" height="3" rx="0.8"/>',
  flat: '<rect x="1.5" y="1.8" width="13" height="3" rx="0.8"/><rect x="1.5" y="6.5" width="13" height="3" rx="0.8"/><rect x="1.5" y="11.2" width="13" height="3" rx="0.8"/>',
  // Width: wide (arrows out to the edges) or narrow (arrows in to the middle).
  wide: '<path d="M8 2v12M5.5 8H1M3.2 5.8L1 8l2.2 2.2M10.5 8H15M12.8 5.8L15 8l-2.2 2.2"/>',
  narrow: '<path d="M8 2v12M1 8h4.5M3.3 5.8L5.5 8l-2.2 2.2M15 8h-4.5M12.7 5.8L10.5 8l2.2 2.2"/>',
  // Colours menu: a painter's palette.
  colors: '<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4h1.2a1.6 1.6 0 0 0 1.1-2.7 1.6 1.6 0 0 1 1.2-2.7h1.4A2.4 2.4 0 0 0 14.2 7 6.2 6.2 0 0 0 8 1.8z"/><circle cx="5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="4.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="9.6" r="1.1" fill="currentColor" stroke="none"/>',
  table: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.2"/><path d="M1.5 6.2h13M1.5 9.8h13M6 2.5v11"/>',
  timeline: '<path d="M2 3.5h6M5.5 8h8M3 12.5h5" stroke-width="2.6"/>',
  matrix: '<path d="M2.5 1.5v12h12"/><circle cx="6" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="10.5" cy="4.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="9.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12.5" cy="9" r="1.4" fill="currentColor" stroke="none"/>',
  back: '<path d="M13.5 8H3M7 3.5L2.5 8 7 12.5"/>',
  // Row actions (table.js): add a task, move a task elsewhere, delete, save
  // and discard a new row, and the grip of the drag handle.
  plus: '<path d="M8 3v10M3 8h10"/>',
  move: '<path d="M2.5 5.5h9M9 2.5l3 3-3 3M13.5 10.5h-9M7 7.5l-3 3 3 3"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v4M9.2 7v4"/>',
  check: '<path d="M3 8.5l3.2 3.2L13 5"/>',
  cross: '<path d="M4 4l8 8M12 4l-8 8"/>',
  grip: '<circle cx="5.5" cy="3.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="10.5" cy="3.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="5.5" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="10.5" cy="12.5" r="1.3" fill="currentColor" stroke="none"/>',
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

/** "+N" / "+P": the key prefix of the type being created. */
export function keyGlyph(prefix) {
  const span = document.createElement('span');
  span.className = 'key-glyph';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = `+${prefix}`;
  return span;
}
