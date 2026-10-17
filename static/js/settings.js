// Settings page: general options, row colours, and the users list.
//
// renderSettings(main, ctx)   ctx = { reload() } reloads state and re-renders.
// Settings live on the server (GET/PATCH /api/settings) so every browser on
// the network sees the same values.

import { api } from './api.js';
import { state } from './state.js';
import { renderUsers } from './users.js';
import { el, toast } from './util.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_COLORS = { color_ongoing: '#2a9d8f', color_project: '#5b6cff', color_task: '', color_unassigned: '#9aa3ad', hl_warn_color: '#f5a524', hl_alert_color: '#e5484d' };
const DEFAULT_NUMBERS = { level_warn_min: 6, level_alert_min: 9, date_warn_days: 7, date_alert_days: 0 };

async function save(patch, ctx) {
  try {
    await api.updateSettings(patch);
    await ctx.reload();
  } catch (e) {
    toast(e.message);
  }
}

function section(title, ...children) {
  return el('section', { class: 'settings-section' }, el('h2', {}, title), ...children);
}

function weekStartRow(ctx) {
  const sel = el('select', { id: 'setting-week-start', 'aria-label': 'First day of the week' });
  for (let i = 0; i < 7; i++) sel.append(el('option', { value: String(i), selected: String(i) === String(state.settings.week_start) ? true : null }, DAYS[i]));
  sel.addEventListener('change', () => save({ week_start: sel.value }, ctx));
  return el('div', { class: 'settings-row' },
    el('label', { for: 'setting-week-start' }, 'Week starts on'),
    sel,
    el('span', { class: 'settings-help' }, 'Used for the week boundaries in the Timeline.'));
}

function colorRow(key, label, help, ctx) {
  const current = state.settings[key] || '';
  const isDefault = current === DEFAULT_COLORS[key];
  const input = el('input', { type: 'color', id: `setting-${key}`, value: current || '#888888', 'aria-label': label });
  input.addEventListener('change', () => save({ [key]: input.value }, ctx));
  const reset = el('button', { type: 'button', class: 'settings-reset', disabled: isDefault ? true : null, dataset: { reset: key } }, 'Reset');
  reset.addEventListener('click', () => save({ [key]: DEFAULT_COLORS[key] }, ctx));
  return el('div', { class: 'settings-row' },
    el('label', { for: `setting-${key}` }, label),
    input,
    el('code', { class: 'settings-hex' }, current || 'none'),
    reset,
    el('span', { class: 'settings-help' }, help));
}

function numberInput(key, min, max) {
  const inp = el('input', { type: 'number', id: `setting-${key}`, min, max, value: state.settings[key] ?? DEFAULT_NUMBERS[key], 'aria-label': key });
  inp.addEventListener('change', () => { if (inp.value !== '') save({ [key]: inp.value }, ctxRef); });
  return inp;
}
let ctxRef = null;

function highlightRows(ctx) {
  ctxRef = ctx;
  const row = (key, label, levelKey, dateKey, help) => el('div', { class: 'settings-row settings-hl' },
    el('label', { for: `setting-${key}` }, label),
    (() => { const r = colorRow(key, label, '', ctx); r.classList.add('settings-inline'); r.querySelector('label').remove(); return r; })(),
    el('span', { class: 'settings-preview ' + (key === 'hl_warn_color' ? 'hl-warn' : 'hl-alert') }, 'sample'),
    el('span', { class: 'settings-help' }, 'urgency/importance from'), numberInput(levelKey, 0, 11),
    el('span', { class: 'settings-help' }, 'end date within'), numberInput(dateKey, -1, 365), el('span', { class: 'settings-help' }, help));
  return [
    el('p', { class: 'settings-help' }, 'Urgency and importance values at or above the threshold, and end dates within the given number of calendar days of today, are highlighted. Alert takes precedence over warn. Use 11 or -1 to disable a rule.'),
    row('hl_warn_color', 'Warn', 'level_warn_min', 'date_warn_days', 'days'),
    row('hl_alert_color', 'Alert', 'level_alert_min', 'date_alert_days', 'days (0 = today or overdue)'),
  ];
}

export function renderSettings(main, ctx) {
  const usersBox = el('div', { id: 'settings-users' });
  main.replaceChildren(
    el('h1', {}, 'Settings'),
    section('General', weekStartRow(ctx)),
    section('Row colours',
      el('p', { class: 'settings-help' }, 'Rows are tinted with these colours in both light and dark themes.'),
      colorRow('color_ongoing', 'Ongoing rows', '', ctx),
      colorRow('color_project', 'Project rows', '', ctx),
      colorRow('color_task', 'Task rows', 'No tint by default.', ctx),
      colorRow('color_unassigned', 'No assignee', 'Matrix points and Timeline bars of items with no assignee.', ctx)),
    section('Highlighting', ...highlightRows(ctx)),
    section('Users', usersBox),
  );
  renderUsers(usersBox, ctx);
}
