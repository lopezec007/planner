// Settings page: general options, row colours, and the users list.
//
// renderSettings(main, ctx)   ctx = { reload() } reloads state and re-renders.
// Settings live on the server (GET/PATCH /api/settings) so every browser on
// the network sees the same values.

import { api } from './api.js';
import { state } from './state.js';
import { renderUsers } from './users.js';
import { el, toast, contrastText } from './util.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_COLORS = { color_ongoing: '#2a9d8f', color_project: '#5b6cff', color_task: '', color_unassigned: '#9aa3ad', hl_warn_color: '#f5a524', hl_alert_color: '#e5484d' };
const DEFAULT_NUMBERS = { date_warn_days: 7, date_alert_days: 0 };

// Presets for the urgency/importance colour ramp (values 0..10; '' = none).
const RAMP_PRESETS = {
  classic: { label: 'Classic (6-8 warn, 9-10 alert)', colors: ['', '', '', '', '', '', '#f5a524', '#f5a524', '#f5a524', '#e5484d', '#e5484d'] },
  high: { label: 'High only (8-10)', colors: ['', '', '', '', '', '', '', '', '#f5a524', '#e5484d', '#b3121a'] },
  traffic: { label: 'Traffic light (green to red)', colors: ['#2e9e4f', '#4caf50', '#7cb342', '#9ccc3d', '#c0ca33', '#fdd835', '#ffb300', '#fb8c00', '#f4511e', '#e53935', '#b71c1c'] },
  heat: { label: 'Heat (yellow to red)', colors: ['#fff59d', '#fff176', '#ffee58', '#ffd54f', '#ffca28', '#ffb300', '#ff9800', '#f57c00', '#ef6c00', '#e64a19', '#d32f2f'] },
  blues: { label: 'Blues (light to deep)', colors: ['#e3f2fd', '#bbdefb', '#90caf9', '#64b5f6', '#42a5f5', '#2196f3', '#1e88e5', '#1976d2', '#1565c0', '#0d47a1', '#0b3d91'] },
  grey: { label: 'Greyscale', colors: ['#f5f5f5', '#e0e0e0', '#cfcfcf', '#bdbdbd', '#a8a8a8', '#9e9e9e', '#8a8a8a', '#757575', '#5f5f5f', '#424242', '#212121'] },
  none: { label: 'None', colors: ['', '', '', '', '', '', '', '', '', '', ''] },
};

function currentRamp(key) {
  try {
    const r = JSON.parse(state.settings[key] || '[]');
    if (Array.isArray(r) && r.length === 11) return r;
  } catch {}
  return RAMP_PRESETS.classic.colors.slice();
}

/** One colour ramp (urgency or importance): a preset dropdown and 11 cells. */
function levelRamp(ctx, key, label) {
  const ramp = currentRamp(key);
  const saveRamp = () => save({ [key]: JSON.stringify(ramp) }, ctx);
  const id = `setting-${key.replace('_colors', '')}-preset`;
  const preset = el('select', { id, 'aria-label': `${label} colour ramp preset` },
    el('option', { value: '' }, 'Apply a preset…'));
  for (const [k, p] of Object.entries(RAMP_PRESETS)) preset.append(el('option', { value: k }, p.label));
  preset.addEventListener('change', () => {
    if (!preset.value) return;
    ramp.splice(0, ramp.length, ...RAMP_PRESETS[preset.value].colors);
    saveRamp();
  });
  const cells = el('div', { class: 'ramp', dataset: { ramp: key } });
  ramp.forEach((c, i) => {
    const swatch = el('input', { type: 'color', value: c || '#888888', 'aria-label': `${label} colour for ${i}`, dataset: { level: i } });
    swatch.addEventListener('change', () => { ramp[i] = swatch.value; saveRamp(); });
    const sample = el('span', { class: 'ramp-sample ' + (c ? 'hl-level' : ''), style: c ? { background: c, color: contrastText(c) } : {} }, String(i));
    const clear = el('button', { type: 'button', class: 'ramp-clear', title: 'No highlight for this value', disabled: c ? null : true, dataset: { clear: i } }, 'none');
    clear.addEventListener('click', () => { ramp[i] = ''; saveRamp(); });
    cells.append(el('div', { class: 'ramp-cell' + (c ? '' : ' unset') }, sample, swatch, clear));
  });
  return [
    el('div', { class: 'settings-row' }, el('label', { for: id }, label), preset),
    cells,
  ];
}

function levelRamps(ctx) {
  return [
    el('p', { class: 'settings-help' }, 'Each urgency and importance value gets its own colour (or none). Pick a preset to fill a ramp, then adjust any value.'),
    ...levelRamp(ctx, 'urgency_colors', 'Urgency'),
    ...levelRamp(ctx, 'importance_colors', 'Importance'),
  ];
}

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
  const row = (key, label, dateKey, help) => el('div', { class: 'settings-row settings-hl' },
    el('label', { for: `setting-${key}` }, label),
    (() => { const r = colorRow(key, label, '', ctx); r.classList.add('settings-inline'); r.querySelector('label').remove(); return r; })(),
    el('span', { class: 'settings-preview ' + (key === 'hl_warn_color' ? 'hl-warn' : 'hl-alert') }, 'sample'),
    el('span', { class: 'settings-help' }, 'end date within'), numberInput(dateKey, -1, 365), el('span', { class: 'settings-help' }, help));
  return [
    el('p', { class: 'settings-help' }, 'End dates within the given number of calendar days of today are highlighted. Alert takes precedence over warn. Use -1 to disable a rule.'),
    row('hl_warn_color', 'End date warn', 'date_warn_days', 'days'),
    row('hl_alert_color', 'End date alert', 'date_alert_days', 'days (0 = today or overdue)'),
    ...levelRamps(ctx),
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
