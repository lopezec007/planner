import { test, expect } from '@playwright/test';

test('homepage shows hierarchy with supersede rule and highlighting', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.row.parent:not(.header)').first()).toBeVisible();

  // Ongoing always shown; only todo/in-progress/recently closed tasks under it.
  const maint = page.locator('.row.parent', { hasText: 'Maintenance' });
  await expect(maint).toBeVisible();
  await expect(page.locator('.row.task', { hasText: 'Service lawnmower' })).toHaveCount(0); // backlog
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' })).toBeVisible();

  // Tasks are filtered on their own status: a backlog task under an
  // in-progress project is not active.
  await expect(page.locator('.row.task', { hasText: 'Paint walls' })).toHaveCount(0);
  // A backlog project appears only as context for its active (To-Do) task.
  await expect(page.locator('.row.parent', { hasText: 'File taxes' })).toBeVisible();
  await expect(page.locator('.row.task', { hasText: 'Gather W-2s' })).toBeVisible();
  // Ongoing/Project rows with no active tasks are hidden under Active.
  await expect(page.locator('.row.parent', { hasText: 'Solar panels' })).toHaveCount(0);

  // Blocked row has mask class; overdue end date is red.
  const blocked = page.locator('.row.task', { hasText: 'Pay insurance' });
  await expect(blocked).toHaveClass(/blocked/);
  await expect(blocked.locator('.hl-alert').first()).toBeVisible();

  // Closed items carry no highlighting.
  const done = page.locator('.row.task', { hasText: 'Demo old cabinets' });
  await expect(done).toHaveClass(/closed/);
  await expect(done.locator('.hl-alert, .hl-warn')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('description expand and collapse', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.row.parent', { hasText: 'Maintenance' });
  await expect(page.locator('.row.description')).toHaveCount(0);
  await row.locator('.toggle button').click();
  await expect(page.locator('.row.description')).toHaveCount(1);
  await expect(page.locator('.row.description strong')).toHaveText('house and yard');
  await page.locator('#btn-expand-all').click();
  expect(await page.locator('.row.description').count()).toBeGreaterThan(3);
  await page.locator('#btn-collapse-all').click();
  await expect(page.locator('.row.description')).toHaveCount(0);
  // Every row can be expanded, including an Ongoing without a description
  // (that is where one is added).
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.toggle button')).toHaveCount(1);
  await page.locator('.row.parent', { hasText: 'Finance' }).locator('.toggle button').click();
  await expect(page.locator('.row.description .md.placeholder')).toBeVisible();
});

test('expand and collapse all parents show or hide every task; not in Flat', async ({ page }) => {
  await page.goto('/#/everything');
  const parents = page.locator('.row.parent:not(.header)');
  const tasks = page.locator('.row.task:not(.header)');
  await expect(parents).toHaveCount(7);
  const n = await tasks.count();
  expect(n).toBeGreaterThanOrEqual(17);
  await expect(page.locator('#btn-collapse-parents')).toBeEnabled();
  await page.locator('#btn-collapse-parents').click();
  await expect(tasks).toHaveCount(0);
  await expect(page.locator('.row.parent.collapsed')).toHaveCount(7);
  await expect(parents.first().locator('.caret')).toHaveAttribute('aria-expanded', 'false');
  // The preference covers every parent, so a filter change keeps them collapsed.
  await page.locator('.search-preset[data-preset=active]').click();
  await expect(page.locator('.row.parent:not(.header):not(.collapsed)')).toHaveCount(0);
  await page.locator('#btn-search-clear').click();
  await page.reload();
  await expect(parents).toHaveCount(7);
  await expect(tasks).toHaveCount(0); // survives a reload
  await page.locator('#btn-expand-parents').click();
  await expect(tasks).toHaveCount(n);
  await expect(page.locator('.row.parent.collapsed')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('planner.pref.collapsed'))).toBe('[]');
  // Flat has no parent rows: both buttons are disabled and say so.
  await page.locator('#btn-flat').click();
  await expect(page.locator('#btn-expand-parents')).toBeDisabled();
  await expect(page.locator('#btn-collapse-parents')).toBeDisabled();
  await expect(page.locator('#btn-collapse-parents')).toHaveAttribute('title', /Flat/);
  await page.locator('#btn-nested').click();
  await expect(page.locator('#btn-collapse-parents')).toBeEnabled();
});

test('backlog, ideas and everything pages', async ({ page }) => {
  await page.goto('/#/backlog');
  await expect(page.locator('.row.parent', { hasText: 'File taxes' })).toBeVisible();
  await expect(page.locator('.row.task', { hasText: 'Service lawnmower' })).toBeVisible();
  await expect(page.locator('.row.task', { hasText: 'Paint walls' })).toBeVisible(); // backlog task, whatever its project's status
  await expect(page.locator('.row.parent', { hasText: 'Finance' })).toBeVisible(); // Ongoings stay visible so items can be added
  await page.goto('/#/ideas');
  await expect(page.locator('.row.parent', { hasText: 'Solar panels' })).toBeVisible();
  await page.goto('/#/everything');
  expect(await page.locator('.row.task').count()).toBeGreaterThanOrEqual(17);
  await expect(page.locator('.toolbar button[data-view]')).toHaveCount(3);
});

test('the version badge shows the semantic version with the release date on hover', async ({ page, request }) => {
  const v = await (await request.get('/api/version')).json();
  expect(v.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.goto('/');
  const badge = page.locator('#app-version');
  await expect(badge).toHaveText(`v${v.version}`);
  await expect(badge).toHaveAttribute('title', new RegExp(`Version ${v.version.replace(/\./g, '\\.')}, released ${v.date}`));
  // Sits to the right of the view picker.
  const group = await page.locator('.toolbar .group[aria-label="View"]').boundingBox();
  const b = await badge.boundingBox();
  expect(b.x).toBeGreaterThan(group.x + group.width);
  await page.goto('/#/settings');
  await expect(page.locator('#app-version')).toHaveText(`v${v.version}`);
});
