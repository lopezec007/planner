// Urgency and importance values and what they mean.
//
// Each value can be given a description in Settings (the
// urgency_descriptions and importance_descriptions settings: JSON objects
// from the value to its text, values without one left out). The description
// shows on mouseover of the value in the table (cells.js levelControl) and
// of the axis numbers and names in the Matrix (matrix.js).
//
//   LEVEL_FIELDS                 ['importance', 'urgency'], in display order
//   LEVEL_NAME[field]            'Urgency' | 'Importance'
//   levelMin(field)              0 for urgency, -1 for importance (both end at 10)
//   levelValues(field)           [min .. 10]
//   levelDescription(field, n)   the description of n, or ''
//   levelTitle(field, n)         "Urgency 7: text" for a tooltip, or '' when n has no description
//   levelLegend(field)           every described value, one per line and the highest
//                                first ("10: text"), or '' when there is none

import { state } from './state.js';

export const LEVEL_FIELDS = ['importance', 'urgency'];
export const LEVEL_NAME = { urgency: 'Urgency', importance: 'Importance' };
export const LEVEL_MAX = 10;

export const levelMin = (field) => (field === 'importance' ? -1 : 0);

export function levelValues(field) {
  const out = [];
  for (let v = levelMin(field); v <= LEVEL_MAX; v++) out.push(v);
  return out;
}

/** The field's descriptions as { value: text }, parsed once per settings
 *  load (state.settings is replaced on every load, so the cache goes with it). */
export function levelDescriptions(field) {
  const settings = state.settings || {};
  const cache = settings._descriptions || (settings._descriptions = {});
  if (!cache[field]) {
    let parsed = null;
    try { parsed = JSON.parse(settings[`${field}_descriptions`] || '{}'); } catch { parsed = null; }
    const out = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const v of levelValues(field)) {
        const text = parsed[String(v)];
        if (typeof text === 'string' && text.trim()) out[v] = text.trim();
      }
    }
    cache[field] = out;
  }
  return cache[field];
}

export function levelDescription(field, n) {
  if (n == null || n === '') return '';
  return levelDescriptions(field)[Number(n)] || '';
}

export function levelTitle(field, n) {
  const text = levelDescription(field, n);
  return text ? `${LEVEL_NAME[field]} ${Number(n)}: ${text}` : '';
}

export function levelLegend(field) {
  const all = levelDescriptions(field);
  return levelValues(field).reverse().filter((v) => all[v]).map((v) => `${v}: ${all[v]}`).join('\n');
}
