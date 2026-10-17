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

// Filter templates. `statuses` apply to each item's own status (Ongoing rows
// have none and are never excluded by it), `recentDays` also admits items
// closed within that many days, `types` restricts item types, and
// `hideEmptyParents` drops Ongoing/Project rows with no matching tasks.
export const PRESETS = {
  active: { title: 'Active', statuses: ['todo', 'in-progress'], recentDays: 14, types: [], hideEmptyParents: true },
  backlog: { title: 'Backlog', statuses: ['backlog'], recentDays: 0, types: [], hideEmptyParents: false },
  ideas: { title: 'Ideas', statuses: ['idea'], recentDays: 0, types: [], hideEmptyParents: false },
};
export const PRESET_ORDER = ['active', 'backlog', 'ideas'];
