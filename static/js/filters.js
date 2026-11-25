// Grouping of items for the table, and the predefined filter templates.
//
// allGroups() returns every live item as [{ parent, tasks }] in sort order.
// The visibility rules (Active / Backlog / Ideas) are expressed as search
// criteria templates (PRESETS) applied by search.js; "no filters" shows all.

import { state } from './state.js';

export function allGroups() {
  const groups = [];
  for (const it of state.items) {
    if (it.parent_id != null) continue;
    groups.push({ parent: it, tasks: (state.childrenOf.get(it.id) || []).slice() });
  }
  return groups;
}

/** How many days a done or cancelled item stays in the Active template after
 *  it was closed: the closed_days setting (0 = not at all; 14 until the
 *  settings have loaded). */
export function closedDays() {
  const v = state.settings?.closed_days;
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 14;
}

// Filter templates. `statuses` apply to each item's own status (Ongoing rows
// have none and are never excluded by it), `recentAuto` also admits items
// closed within the last closedDays() days, `types` restricts item types, and
// `hideEmptyParents` drops Ongoing/Project rows with no matching tasks.
export const PRESETS = {
  active: { title: 'Active', statuses: ['todo', 'in-progress', 'validating'], recentAuto: true, types: [], hideEmptyParents: true },
  backlog: { title: 'Backlog', hint: 'Backlog projects and tasks', statuses: ['backlog'], recentAuto: false, types: [], hideEmptyParents: false },
  ideas: { title: 'Ideas', hint: 'Idea projects and tasks', statuses: ['idea'], recentAuto: false, types: [], hideEmptyParents: false },
};
export const PRESET_ORDER = ['active', 'backlog', 'ideas'];

/** What a template shows, for its tooltip (Active's depends on the setting). */
export function presetHint(name) {
  if (name !== 'active') return PRESETS[name].hint;
  const n = closedDays();
  const closed = n === 0 ? '' : `, plus anything closed in the last ${n === 1 ? 'day' : `${n} days`}`;
  return `To-Do, In-Progress and Validating items${closed}`;
}
