// Effort: how long a task is expected to take, in minutes, picked from the
// options configured in Settings ("effort_options", a JSON array of minutes).
//
//   DEFAULT_EFFORT_OPTIONS  the options the server starts with
//   effortOptions()         the configured options, sorted ascending (the
//                           defaults when the setting is missing or broken)
//   formatEffort(min)       15m, 30m, 1h, "1h 30m", 64h ('' for null)
//   parseEffort(text)       minutes from "90", "1h30m", "2h", "45m" (null for junk)
//   effortSums(tasks)       { open, closed }: minutes of the tasks that are
//                           not done/cancelled and of those that are

import { state, isClosed } from './state.js';

export const DEFAULT_EFFORT_OPTIONS = [15, 30, 60, 120, 240, 480, 960, 1920, 3840];

/** The configured effort options as a sorted array of positive integers. */
export function effortOptions() {
  try {
    const raw = JSON.parse(state.settings?.effort_options || '');
    if (Array.isArray(raw)) {
      const out = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
      if (out.length) return out;
    }
  } catch {}
  return DEFAULT_EFFORT_OPTIONS.slice();
}

/** "15m", "1h", "1h 30m", "64h"; '' for nothing. */
export function formatEffort(min) {
  if (min == null || !Number.isFinite(Number(min))) return '';
  const n = Math.round(Number(min));
  if (n <= 0) return '0m';
  const h = Math.floor(n / 60), m = n % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Minutes from a typed value: a bare number is minutes; "1h30m", "2h",
 *  "45m", "1h 30m", "1.5h" also work. Null when the text is not an effort
 *  or comes to zero. */
export function parseEffort(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) > 0 ? Number(s) : null;
  const m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m(?:in)?)?$/);
  if (!m || (m[1] == null && m[2] == null)) return null;
  const total = Math.round(Number(m[1] || 0) * 60) + Number(m[2] || 0);
  return total > 0 ? total : null;
}

/** Sum the efforts of a list of tasks, split by whether they are closed. */
export function effortSums(tasks) {
  let open = 0, closed = 0;
  for (const t of tasks) {
    const e = Number(t.effort);
    if (t.effort == null || !Number.isFinite(e)) continue;
    if (isClosed(t.status)) closed += e; else open += e;
  }
  return { open, closed };
}
