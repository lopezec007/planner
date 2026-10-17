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

  // In-progress project brings all its tasks, including backlog ones.
  await expect(page.locator('.row.task', { hasText: 'Paint walls' })).toBeVisible();
  // Backlog project is hidden.
  await expect(page.locator('.row.parent', { hasText: 'File taxes' })).toHaveCount(0);

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
  // Projects and tasks can always be expanded (dependencies live there); an
  // Ongoing without a description has no toggle.
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.toggle button')).toHaveCount(1);
  await expect(page.locator('.row.parent', { hasText: 'Finance' }).locator('.toggle button')).toHaveCount(0);
});

test('backlog, ideas and everything pages', async ({ page }) => {
  await page.goto('/#/backlog');
  await expect(page.locator('.row.parent', { hasText: 'File taxes' })).toBeVisible();
  await expect(page.locator('.row.task', { hasText: 'Service lawnmower' })).toBeVisible();
  await expect(page.locator('.row.task', { hasText: 'Paint walls' })).toHaveCount(0); // parent supersedes
  await page.goto('/#/ideas');
  await expect(page.locator('.row.parent', { hasText: 'Solar panels' })).toBeVisible();
  await page.goto('/#/everything');
  expect(await page.locator('.row.task').count()).toBeGreaterThanOrEqual(17);
  await expect(page.locator('.toolbar button[data-view]')).toHaveCount(3);
});
