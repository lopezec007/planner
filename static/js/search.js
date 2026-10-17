// Search and filter controls for the Everything page.
//
// renderSearch(slot, ctx) renders controls into the toolbar slot and returns
// a function (groups) => groups that applies the current search/filter.
// It must call ctx.rerender() whenever the criteria change.
//
// TODO(search agent): implement.

export function renderSearch(slot, ctx) {
  slot.replaceChildren();
  return (groups) => groups;
}
