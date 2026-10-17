import { test, expect } from '@playwright/test';

// Local-date helper matching the seed script's `today N` (server and browser share a clock here).
function ymd(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const parents = (page) => page.locator('.row.parent:not(.header)');
const tasks = (page) => page.locator('.row.task:not(.header)');
const parent = (page, t) => page.locator('.row.parent:not(.header)', { hasText: t });
const task = (page, t) => page.locator('.row.task:not(.header)', { hasText: t });

async function openFilters(page) {
  const panel = page.locator('#search-panel');
  if (!(await panel.isVisible())) await page.locator('#btn-filters').click();
  await expect(panel).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/everything');
  await expect(parents(page)).toHaveCount(7);
});

test('text search narrows rows and keeps the parent for context', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const baselineTasks = await tasks(page).count();
  expect(baselineTasks).toBeGreaterThanOrEqual(17);
  await expect(page.locator('#search-count')).toBeHidden();

  // Title match, case-insensitive. Only the matching task and its parent remain.
  await page.locator('#search-text').fill('CLEAN GUTTERS');
  await expect(task(page, 'Clean gutters')).toBeVisible();
  await expect(tasks(page)).toHaveCount(1);
  await expect(parent(page, 'Maintenance')).toBeVisible();
  await expect(parents(page)).toHaveCount(1);
  await expect(page.locator('#search-count')).toHaveText('1 item matches');
  // Typing does not lose focus across the debounced re-render.
  await expect(page.locator('#search-text')).toBeFocused();
  await expect(page.locator('#search-text')).toHaveValue('CLEAN GUTTERS');

  // Description match.
  await page.locator('#search-text').fill('quartz');
  await expect(task(page, 'Order countertops')).toBeVisible();
  await expect(tasks(page)).toHaveCount(1);
  await expect(parent(page, 'Kitchen remodel')).toBeVisible();

  // Key match: a parent matching itself is shown even when none of its tasks match.
  await page.locator('#search-text').fill('P-2');
  await expect(parent(page, 'Spring garden')).toBeVisible();
  await expect(parents(page)).toHaveCount(1);
  await expect(tasks(page)).toHaveCount(0);

  // No match at all.
  await page.locator('#search-text').fill('zzzz-no-such-thing');
  await expect(page.locator('.table .empty')).toHaveText('Nothing to show.');
  await expect(page.locator('#search-count')).toHaveText('0 items match');

  // Clear restores everything.
  await expect(page.locator('#btn-search-clear')).toBeEnabled();
  await page.locator('#btn-search-clear').click();
  await expect(parents(page)).toHaveCount(7);
  await expect(tasks(page)).toHaveCount(baselineTasks);
  await expect(page.locator('#search-text')).toHaveValue('');
  await expect(page.locator('#search-count')).toBeHidden();
  await expect(page.locator('#btn-search-clear')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('type and status filters', async ({ page }) => {
  await openFilters(page);
  await page.locator('[data-search-key="type:ongoing"]').click();
  await expect(page.locator('#search-panel')).toBeVisible(); // stays open across re-render
  await expect(page.locator('[data-search-key="type:ongoing"]')).toHaveClass(/active/);
  await expect(parents(page)).toHaveCount(2);
  await expect(parent(page, 'Maintenance')).toBeVisible();
  await expect(parent(page, 'Finance')).toBeVisible();
  await expect(tasks(page)).toHaveCount(0);
  await expect(page.locator('#btn-filters .search-badge')).toHaveText('1');

  // Multi-select: add Task type. Tasks appear under their (context) parents.
  await page.locator('[data-search-key="type:task"]').click();
  expect(await tasks(page).count()).toBeGreaterThanOrEqual(17);
  await expect(parents(page)).toHaveCount(7);
  await page.locator('[data-search-key="type:ongoing"]').click();
  await page.locator('[data-search-key="type:task"]').click();
  await expect(page.locator('#btn-filters .search-badge')).toHaveCount(0);

  // Status: backlog project matches itself; backlog tasks under other parents match.
  await page.locator('[data-search-key="status:backlog"]').click();
  await expect(parent(page, 'File taxes')).toBeVisible();
  await expect(task(page, 'Gather W-2s')).toHaveCount(0); // todo task under backlog project
  await expect(task(page, 'Paint walls')).toBeVisible();
  await expect(task(page, 'Service lawnmower')).toBeVisible();
  await expect(tasks(page)).toHaveCount(2);
  await expect(parents(page)).toHaveCount(3);
  await expect(page.locator('#search-count')).toHaveText('3 items match');

  // Combine with text search.
  await page.locator('#search-text').fill('paint');
  await expect(tasks(page)).toHaveCount(1);
  await expect(task(page, 'Paint walls')).toBeVisible();
  await expect(parents(page)).toHaveCount(1);

  await page.locator('#btn-search-clear').click();
  await expect(parents(page)).toHaveCount(7);
  await expect(page.locator('[data-search-key="status:backlog"]')).not.toHaveClass(/active/);
});

test('owner, assignee and blocked filters', async ({ page }) => {
  await openFilters(page);
  await page.locator('[data-search-key="owner"]').selectOption({ label: 'Sam' });
  await expect(task(page, 'Pay insurance')).toBeVisible();
  await expect(task(page, 'Fix fence post')).toBeVisible();
  await expect(task(page, 'Clean gutters')).toHaveCount(0);
  await expect(parent(page, 'Finance')).toBeVisible();
  await expect(parent(page, 'File taxes')).toBeVisible();
  await expect(parent(page, 'Kitchen remodel')).toHaveCount(0);
  await expect(tasks(page)).toHaveCount(3);
  await expect(page.locator('[data-search-key="owner"]')).toHaveValue(/\d+/); // selection survives re-render
  await page.locator('[data-search-key="owner"]').selectOption({ label: 'Any' });

  await page.locator('[data-search-key="assignee"]').selectOption({ label: 'Unassigned' });
  await expect(task(page, 'Service lawnmower')).toBeVisible();
  await expect(task(page, 'Buy seeds')).toHaveCount(0);
  await expect(task(page, 'Replace HVAC filter')).toBeVisible(); // no assignee
  await expect(parent(page, 'Solar panels')).toBeVisible();

  await page.locator('[data-search-key="assignee"]').selectOption({ label: 'Alex' });
  await expect(tasks(page)).toHaveCount(1);
  await expect(task(page, 'Buy seeds')).toBeVisible();
  await expect(parents(page)).toHaveCount(1);
  await page.locator('[data-search-key="assignee"]').selectOption({ label: 'Any' });

  // Blocked = the stored flag or an open blocking dependency: Pay insurance
  // (flag, and blocked by Review budget), Electrical rough-in (by Order
  // countertops), Paint walls (by Electrical rough-in); Spring garden is a
  // project blocked by Kitchen remodel.
  await page.locator('[data-search-key="blocked"]').selectOption({ label: 'Blocked' });
  await expect(tasks(page)).toHaveCount(3);
  await expect(task(page, 'Pay insurance')).toBeVisible();
  await expect(task(page, 'Paint walls')).toBeVisible();
  await expect(parents(page)).toHaveCount(3);
  await expect(parent(page, 'Finance')).toBeVisible();
  await expect(parent(page, 'Spring garden')).toBeVisible();

  await page.locator('[data-search-key="blocked"]').selectOption({ label: 'Not blocked' });
  await expect(task(page, 'Pay insurance')).toHaveCount(0);
  await expect(parents(page)).toHaveCount(7);

  await page.locator('#btn-search-clear').click();
  await expect(task(page, 'Pay insurance')).toBeVisible();
  await expect(page.locator('[data-search-key="blocked"]')).toHaveValue('');
});

test('end date before/after filters', async ({ page }) => {
  await openFilters(page);
  // End on/before today+5: Clean gutters (+3), HVAC (0), Pay insurance (-2), Demo cabinets (-15), Repaint shed (-3).
  await page.locator('[data-search-key="endBefore"]').fill(ymd(5));
  await expect(task(page, 'Clean gutters')).toBeVisible();
  await expect(task(page, 'Order countertops')).toHaveCount(0); // +6
  await expect(task(page, 'Service lawnmower')).toHaveCount(0); // no end date
  await expect(parent(page, 'Repaint shed')).toBeVisible();
  await expect(tasks(page)).toHaveCount(4);
  await expect(page.locator('#search-count')).toHaveText('5 items match');

  // Add a lower bound: today-1 .. today+5 leaves Clean gutters and HVAC.
  await page.locator('[data-search-key="endAfter"]').fill(ymd(-1));
  await expect(tasks(page)).toHaveCount(2);
  await expect(task(page, 'Pay insurance')).toHaveCount(0);
  await expect(parents(page)).toHaveCount(1);

  // Only a lower bound far in the future: just the taxes project.
  await page.locator('[data-search-key="endBefore"]').fill('');
  await page.locator('[data-search-key="endAfter"]').fill(ymd(100));
  await expect(parent(page, 'File taxes')).toBeVisible();
  await expect(parent(page, 'Kitchen remodel')).toHaveCount(0); // +45
  await expect(parents(page)).toHaveCount(1);
  await expect(tasks(page)).toHaveCount(0);

  await page.locator('#btn-search-clear').click();
  await expect(parents(page)).toHaveCount(7);
  await expect(page.locator('[data-search-key="endAfter"]')).toHaveValue('');
});

test('criteria persist across presets and stack on top of them', async ({ page }) => {
  await page.locator('#search-text').fill('gutters');
  await expect(tasks(page)).toHaveCount(1);
  // Switch to the Active preset: the search still applies there.
  await page.locator('.presets button[data-preset=active]').click();
  await expect(page.locator('.presets button.active')).toHaveText('Active');
  await expect(page.locator('#search-text')).toHaveValue('gutters');
  await expect(tasks(page)).toHaveCount(1);
  await expect(task(page, 'Clean gutters')).toBeVisible();
  // Back to All; clearing restores everything.
  await page.goto('/#/all');
  await expect(page.locator('#search-text')).toHaveValue('gutters');
  await page.locator('#btn-search-clear').click();
  await expect(parents(page)).toHaveCount(7);
  // A status filter on the Active preset narrows within it.
  await page.goto('/#/active');
  await openFilters(page);
  await page.locator('[data-search-key="status:backlog"]').click();
  await expect(task(page, 'Paint walls')).toBeVisible(); // backlog task shown under its in-progress project
  await expect(task(page, 'Service lawnmower')).toHaveCount(0); // not on Active (under an Ongoing)
  await page.locator('#btn-search-clear').click();
});
