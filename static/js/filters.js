// Predefined filters ("presets") for the single planner page. Each builds a
// list of groups:
//   [{ parent: Item, tasks: [Item, ...] }, ...]
// in display (sort) order. The "project status supersedes children" rule is
// implemented here: a visible project always brings all its tasks, and tasks
// under an Ongoing are judged on their own status.

import { state, isClosed, withinLastDays } from './state.js';

const RECENT_DAYS = 14;

function recentlyClosed(it) {
  return isClosed(it.status) && withinLastDays(it.closed_at, RECENT_DAYS);
}

function activeStatus(it) {
  return it.status === 'todo' || it.status === 'in-progress' || recentlyClosed(it);
}

/** Build groups from a parent predicate and a task predicate (for tasks of Ongoing). */
function build({ showParent, showTaskUnderOngoing, showProjectEvenIfEmpty }) {
  const groups = [];
  for (const it of state.items) {
    if (it.parent_id != null) continue;
    const tasks = state.childrenOf.get(it.id) || [];
    if (it.type === 'ongoing') {
      const visible = tasks.filter(showTaskUnderOngoing);
      if (showParent(it) || visible.length) groups.push({ parent: it, tasks: visible });
    } else if (showParent(it)) {
      groups.push({ parent: it, tasks: tasks.slice() });
    }
  }
  return groups;
}

export const PRESETS = {
  active: {
    title: 'Active',
    views: ['table', 'timeline', 'matrix'],
    newStatus: 'todo',
    allowNewOngoing: true,
    groups: () => build({
      showParent: (it) => it.type === 'ongoing' || activeStatus(it),
      showTaskUnderOngoing: activeStatus,
    }),
  },
  backlog: {
    title: 'Backlog',
    views: ['table', 'timeline', 'matrix'],
    newStatus: 'backlog',
    allowNewOngoing: false,
    groups: () => build({
      showParent: (it) => it.status === 'backlog',
      showTaskUnderOngoing: (t) => t.status === 'backlog',
    }),
  },
  ideas: {
    title: 'Ideas',
    views: ['table', 'timeline', 'matrix'],
    newStatus: 'idea',
    allowNewOngoing: false,
    groups: () => build({
      showParent: (it) => it.status === 'idea',
      showTaskUnderOngoing: (t) => t.status === 'idea',
    }),
  },
  all: {
    title: 'All',
    views: ['table', 'timeline', 'matrix'],
    newStatus: 'todo',
    allowNewOngoing: true,
    groups: () => build({
      showParent: () => true,
      showTaskUnderOngoing: () => true,
    }),
  },
};
