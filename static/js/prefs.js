// Per-user preferences (view, Flat, Narrow, collapsed parents, sort, bar
// colours, colour-coding by Ongoing/Project...) and the "account" they belong to.
//
// There is no authentication: the account is simply the user picked in the
// account menu at the right of the title bar, remembered per browser in
// localStorage; a browser that has not picked anyone yet gets the first
// user (app.js). With an account selected, preferences live on the server
// (GET/PATCH /api/users/{id}/prefs) so they follow the user to any browser;
// with no account (there are no users yet) they live in this browser's
// localStorage only.
//
//   await prefs.load(accountId)    load the account's values (null = this browser)
//   prefs.get(key)                 current value (string; defaults applied)
//   prefs.getJSON(key)             parsed JSON value (defaults applied)
//   await prefs.set(key, value)    persist one value (string or JSON-able)
//   prefs.account                  the current account id, or null
//
// Values are strings on the wire, like app settings. Saving never blocks the
// UI: the in-memory value changes at once and the write happens afterwards;
// a failed server write is reported with a toast.

import { api } from './api.js';
import { toast } from './util.js';

export const PREF_DEFAULTS = {
  view: 'table',          // table | timeline | matrix
  narrow: '0',            // 0 | 1: constrain the table width on wide screens
  flat: '0',              // 0 | 1: tasks only, parent key/title as columns
  collapsed: '[]',        // JSON array of parent ids whose tasks are hidden
  sort: '[]',             // JSON array of { key, dir } (empty = user-defined order)
  blocked_last: '0',      // 0 | 1: blocked items sink to the bottom regardless of sort
  closed_last: '0',       // 0 | 1: done/cancelled items sink to the bottom (below blocked ones)
  bar_color: 'assignee',  // assignee | owner | importance | urgency | combo | parent
  hidden_cols: '[]',      // JSON array of hidden table columns (columns.js)
  // Colour-coding by Ongoing/Project (colors.js): the items' own colours are
  // shared by everyone; whether and where they show is per user.
  parent_colors: 'custom', // custom: a parent row shows its own colour when set | type: always the type colour
  task_colors: 'type',     // type: the Task tint from Settings | parent: the task's Ongoing/Project colour
  point_color: 'assignee', // Matrix points: assignee | owner | parent
  filters: '',             // JSON of the Filters panel criteria (search.js), '' = the Active template
  matrix_labels: 'key',    // Matrix point labels: key | title
  // The scratch pad panel (scratch.js): open, width in px, the global pane's
  // share of the height in percent, and line wrapping.
  scratch_open: '0',
  scratch_width: '320',
  scratch_split: '50',
  scratch_wrap: '1',
};

const ACCOUNT_KEY = 'planner.account';
const LOCAL_PREFIX = 'planner.pref.';
// Before accounts existed these keys held the same values for the browser.
const LEGACY_KEYS = { view: 'planner.view', narrow: 'planner.narrow', flat: 'planner.flat', collapsed: 'planner.collapsed' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  remove(k) { try { localStorage.removeItem(k); } catch {} },
};

function localValues() {
  const out = {};
  for (const key of Object.keys(PREF_DEFAULTS)) {
    let v = store.get(LOCAL_PREFIX + key);
    if (v == null && LEGACY_KEYS[key]) {
      v = store.get(LEGACY_KEYS[key]);
      if (v != null) { store.set(LOCAL_PREFIX + key, v); store.remove(LEGACY_KEYS[key]); }
    }
    if (v != null) out[key] = v;
  }
  return out;
}

export const prefs = {
  account: null,
  values: {},

  /** The account remembered for this browser: a user id; undefined when
   *  nothing was remembered yet (app.js then picks the first user); null
   *  when the browser was told to keep its preferences to itself (an empty
   *  value, which the menu cannot set but a test harness can). */
  rememberedAccount() {
    const v = store.get(ACCOUNT_KEY);
    if (v == null) return undefined;
    return v ? Number(v) : null;
  },

  /** Load the preferences of `accountId` (null: this browser's) and make it
   *  current. The remembered account is left as it was when loading the
   *  browser's own values, so a user who no longer exists (or none yet) is
   *  replaced by the first one next time. */
  async load(accountId) {
    this.account = accountId ?? null;
    if (this.account == null) {
      this.values = localValues();
      return;
    }
    store.set(ACCOUNT_KEY, String(this.account));
    this.values = await api.getUserPrefs(this.account);
  },

  get(key) {
    const v = this.values[key];
    return v == null || v === '' ? PREF_DEFAULTS[key] : v;
  },

  getJSON(key) {
    try { return JSON.parse(this.get(key)); } catch { return JSON.parse(PREF_DEFAULTS[key]); }
  },

  /** Set one preference; the value is applied at once and saved in the background. */
  set(key, value) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    if (this.values[key] === v) return Promise.resolve();
    this.values[key] = v;
    if (this.account == null) { store.set(LOCAL_PREFIX + key, v); return Promise.resolve(); }
    // The local value is kept as the truth: two quick saves answer in order
    // with maps that may each lack the other's change, so the responses are
    // not copied back.
    return api.updateUserPrefs(this.account, { [key]: v })
      .then(() => {})
      .catch((e) => toast(`Could not save your preference: ${e.message}`));
  },
};
