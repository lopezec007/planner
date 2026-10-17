import { test, expect } from '@playwright/test';

const weekday = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

test.afterEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { week_start: '6', color_ongoing: '#2a9d8f', color_project: '#5b6cff', color_task: '', color_unassigned: '#9aa3ad', hl_warn_color: '#f5a524', hl_alert_color: '#e5484d', date_warn_days: '7', date_alert_days: '0', level_colors: '["","","","","","","#f5a524","#f5a524","#f5a524","#e5484d","#e5484d"]' } });
});

test('settings page hosts the users list and the old #/users route still works', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.locator('h1')).toHaveText('Settings');
  await expect(page.locator('#settings-users .chip', { hasText: 'Evan' })).toBeVisible();
  await page.goto('/#/users');
  await expect(page.locator('h1')).toHaveText('Settings');
  await expect(page.locator('#nav a.active')).toHaveText('Settings');
});

test('week start defaults to Saturday and can be changed', async ({ page }) => {
  await page.goto('/');
  await page.locator('button[data-view=timeline]').click();
  const weekDates = async () => page.locator('.timeline-tick.minor.week').evaluateAll((els) => els.map((e) => e.dataset.date));
  let dates = await weekDates();
  expect(dates.length).toBeGreaterThan(5);
  for (const d of dates) expect(weekday(d)).toBe(6);

  await page.goto('/#/settings');
  await page.locator('#setting-week-start').selectOption('1');
  await expect(page.locator('#setting-week-start')).toHaveValue('1');
  await page.goto('/');
  await page.locator('button[data-view=timeline]').click();
  dates = await weekDates();
  for (const d of dates) expect(weekday(d)).toBe(1);
});

test('row colours are applied from settings and can be reset', async ({ page }) => {
  await page.goto('/');
  const ongoing = page.locator('.row.parent[data-type=ongoing]').first();
  const project = page.locator('.row.parent[data-type=project]').first();
  const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg(ongoing)).not.toBe(await bg(project));
  const before = await bg(ongoing);

  await page.goto('/#/settings');
  await expect(page.locator('[data-reset=color_ongoing]')).toBeDisabled();
  await page.locator('#setting-color_ongoing').fill('#ff0000');
  await expect(page.locator('.settings-hex').first()).toHaveText('#ff0000');
  await expect(page.locator('[data-reset=color_ongoing]')).toBeEnabled();
  await page.goto('/');
  const after = await bg(page.locator('.row.parent[data-type=ongoing]').first());
  expect(after).not.toBe(before);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--row-ongoing'))).toBe('#ff0000');

  await page.goto('/#/settings');
  await page.locator('[data-reset=color_ongoing]').click();
  await expect(page.locator('[data-reset=color_ongoing]')).toBeDisabled();
  await page.goto('/');
  expect(await bg(page.locator('.row.parent[data-type=ongoing]').first())).toBe(before);
});

test('ongoing keys use the N prefix and the matrix renders with no tasks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.row.parent[data-type=ongoing] .key-text').first()).toHaveText(/^N-\d+$/);
  await page.goto('/#/ideas');
  await page.locator('button[data-view=matrix]').click();
  await expect(page.locator('#panel svg.matrix-plot')).toBeVisible();
});

test('unassigned items use the no-assignee colour in the matrix, and it is a setting', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('button[data-view=matrix]').click();
  const pt = page.locator('#panel svg g.pt[data-key="T-10"]'); // Electrical rough-in: open, unassigned
  await expect(pt).toHaveAttribute('style', /--pt: #9aa3ad/);
  await request.patch('/api/settings', { data: { color_unassigned: '#ff00ff' } });
  await page.reload();
  await page.locator('button[data-view=matrix]').click();
  await expect(page.locator('#panel svg g.pt[data-key="T-10"]')).toHaveAttribute('style', /--pt: #ff00ff/);
});

test('highlight colours and date windows come from settings', async ({ page, request }) => {
  await page.goto('/');
  const gutters = page.locator('.row.task', { hasText: 'Clean gutters' }); // urgency 7, importance 4, ends in 3 days
  await expect(gutters.locator('.num .hl-level')).toHaveCount(1);
  await expect(gutters.locator('.date .hl-warn')).toHaveCount(1);
  await expect(gutters.locator('.hl-alert')).toHaveCount(0);

  // Widen the alert date window to 5 days and recolour it.
  await request.patch('/api/settings', { data: { date_alert_days: '5', hl_alert_color: '#112233' } });
  await page.reload();
  const g2 = page.locator('.row.task', { hasText: 'Clean gutters' });
  await expect(g2.locator('.date .hl-alert')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--hl-alert'))).toBe('#112233');
  expect(await g2.locator('.date .hl-alert').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(17, 34, 51)');
});

test('urgency/importance colour ramp: per-value colours and presets', async ({ page, request }) => {
  await page.goto('/');
  const gutters = page.locator('.row.task', { hasText: 'Clean gutters' }); // urgency 7, importance 4
  await expect(gutters.locator('.num').nth(0).locator('.hl-level')).toHaveCount(1);
  await expect(gutters.locator('.num').nth(1).locator('.hl-level')).toHaveCount(0);

  // Colour value 4 and clear value 7 through the API.
  const ramp = ['', '', '', '', '#123456', '', '', '', '#f5a524', '#e5484d', '#e5484d'];
  await request.patch('/api/settings', { data: { level_colors: JSON.stringify(ramp) } });
  await page.reload();
  const g2 = page.locator('.row.task', { hasText: 'Clean gutters' });
  await expect(g2.locator('.num').nth(0).locator('.hl-level')).toHaveCount(0);
  const imp = g2.locator('.num').nth(1).locator('.hl-level');
  await expect(imp).toHaveCount(1);
  expect(await imp.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(18, 52, 86)');

  // The settings page shows the ramp; a preset fills every value.
  await page.goto('/#/settings');
  await expect(page.locator('.ramp-cell')).toHaveCount(11);
  await expect(page.locator('.ramp-cell').nth(4)).not.toHaveClass(/empty/);
  await expect(page.locator('.ramp-cell').nth(7)).toHaveClass(/empty/);
  await page.locator('#setting-level-preset').selectOption('traffic');
  await expect(page.locator('.ramp-cell.empty')).toHaveCount(0);
  const saved = JSON.parse((await (await request.get('/api/settings')).json()).level_colors);
  expect(saved[0]).toBe('#2e9e4f');
  expect(saved[10]).toBe('#b71c1c');
  // Clearing one value and changing one swatch persist.
  await page.locator('[data-clear="0"]').click();
  await expect(page.locator('.ramp-cell').nth(0)).toHaveClass(/empty/);
  await page.locator('input[data-level="10"]').fill('#000000');
  await expect.poll(async () => JSON.parse((await (await request.get('/api/settings')).json()).level_colors)[10]).toBe('#000000');
  expect(JSON.parse((await (await request.get('/api/settings')).json()).level_colors)[0]).toBe('');
  await page.goto('/');
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.num .hl-level')).toHaveCount(2); // 7 and 4 both coloured now
});
