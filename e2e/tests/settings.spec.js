import { test, expect } from '@playwright/test';

const weekday = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

test.afterEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { week_start: '6', color_ongoing: '#2a9d8f', color_project: '#5b6cff', color_task: '', color_unassigned: '#9aa3ad' } });
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
