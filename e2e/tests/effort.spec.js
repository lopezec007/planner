import { test, expect } from '@playwright/test';

// The Effort column (a dropdown of the configured durations on task rows,
// sums on parent rows and in the header) and the "Effort options" block in
// Settings. Efforts and settings changed here are put back so other specs
// see the seeded data.

const DEFAULTS = [15, 30, 60, 120, 240, 480, 960, 1920, 3840];
const items = async (request) => (await request.get('/api/items')).json();
const byTitle = async (request, title) => (await items(request)).find((i) => i.title === title);
const settings = async (request) => (await request.get('/api/settings')).json();
const setEffort = (request, it, effort) => request.patch(`/api/items/${it.id}`, { data: { effort } });
const taskRow = (page, title) => page.locator('.row.task', { hasText: title });
const parentRow = (page, title) => page.locator('.row.parent', { hasText: title });

test.afterEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { effort_options: JSON.stringify(DEFAULTS) } });
  for (const it of await items(request)) if (it.effort != null) await setEffort(request, it, null);
});

test('a task picks its effort from the configured options; parents and the toolbar sum the open tasks', async ({ page, request }) => {
  await page.goto('/#/all');
  const gutters = taskRow(page, 'Clean gutters');
  const sel = gutters.locator('select[name=effort]');
  await expect(sel).toHaveValue('');
  expect(await sel.locator('option').allTextContents()).toEqual(['—', '15m', '30m', '1h', '2h', '4h', '8h', '16h', '32h', '64h']);
  // No sums yet: parents show nothing and the toolbar has no badge.
  await expect(parentRow(page, 'Maintenance').locator('.effort-cell')).toHaveText('');
  await expect(page.locator('#effort-total')).toHaveCount(0);
  await expect(parentRow(page, 'Maintenance').locator('select[name=effort]')).toHaveCount(0);

  await sel.selectOption('60');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).effort).toBe(60);
  await expect(taskRow(page, 'Clean gutters').locator('select[name=effort]')).toHaveValue('60');
  await expect(parentRow(page, 'Maintenance').locator('.effort-cell')).toHaveText('1h');
  await expect(page.locator('#toolbar #effort-slot #effort-total')).toHaveText('1h');

  // Done tasks are left out of the sums but named in the tooltips.
  await setEffort(request, await byTitle(request, 'Replace HVAC filter'), 120);
  await setEffort(request, await byTitle(request, 'Fix fence post'), 240); // done
  await setEffort(request, await byTitle(request, 'Pay insurance'), 30);
  await page.reload();
  const maint = parentRow(page, 'Maintenance').locator('.effort-cell');
  await expect(maint).toHaveText('3h');
  await expect(maint).toHaveAttribute('title', '3h open, 4h done or cancelled');
  await expect(parentRow(page, 'Finance').locator('.effort-cell')).toHaveText('30m');
  const total = page.locator('#effort-total');
  await expect(total).toHaveText('3h 30m');
  await expect(page.locator('#effort-slot')).toHaveAttribute('title', /3h 30m of effort over the tasks in view that are not done or cancelled; 4h in done or cancelled tasks/);
  // The badge sits in the page header just before the Sort button, on the same line.
  const badge = await total.boundingBox(), sortBtn = await page.locator('#btn-sort').boundingBox();
  expect(badge.x + badge.width).toBeLessThanOrEqual(sortBtn.x);
  expect(badge.x + badge.width).toBeGreaterThan(sortBtn.x - 40);
  expect(Math.abs((badge.y + badge.height / 2) - (sortBtn.y + sortBtn.height / 2))).toBeLessThan(4);
  // The header stays sortable: ascending puts the quickest first and tasks with no effort last.
  await page.locator('.row.header [data-sort="effort"]').click();
  await expect(page.locator('.row.header [data-sort="effort"]')).toHaveAttribute('aria-sort', 'ascending');
  expect((await page.locator('.row.header').boundingBox()).height).toBe(36);
  expect((await taskRow(page, 'Clean gutters').boundingBox()).height).toBe(36); // the select does not grow the row
  const maintId = (await byTitle(request, 'Maintenance')).id;
  await expect.poll(() => page.locator(`.row.task[data-parent="${maintId}"] .title-text`).allTextContents())
    .toEqual(['Clean gutters', 'Replace HVAC filter', 'Fix fence post', 'Service lawnmower', 'Install smart thermostat']);
  await page.locator('.row.header [data-sort="effort"]').click();
  await page.locator('.row.header [data-sort="effort"]').click(); // off
  await expect(page.locator('#sort-badge')).toHaveCount(0);

  // Under the Backlog template only Service lawnmower (no effort) is listed under Maintenance:
  // the sums cover the listed tasks and the parent's tooltip gives the sum over all of them.
  await page.goto('/#/backlog');
  await expect(parentRow(page, 'Maintenance').locator('.effort-cell')).toHaveText('');
  await expect(parentRow(page, 'Maintenance').locator('.effort-cell')).toHaveAttribute('title', '7h over all its tasks (3h open)');
  await expect(page.locator('#effort-total')).toHaveCount(0);

  // Flat shows the column and the same total; the Timeline keeps the total (the filters apply there too).
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await expect(page.locator('.table.flat .row.header [data-sort="effort"]')).toBeVisible();
  await expect(page.locator('#effort-total')).toHaveText('3h 30m');
  await expect(page.locator('.table.flat .row.task', { hasText: 'Clean gutters' }).locator('select[name=effort]')).toHaveValue('60');
  await page.locator('#btn-nested').click();
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('.table.title-only')).toBeVisible();
  await expect(page.locator('select[name=effort]')).toHaveCount(0);
  await expect(page.locator('#effort-total')).toHaveText('3h 30m');
  await page.locator('button[data-view=table]').click();
  // The column can be hidden from the Columns menu.
  await page.locator('#btn-columns').click();
  await page.locator('#columns-panel input[data-column=effort]').uncheck();
  await expect(page.locator('.row.header [data-sort="effort"]')).toHaveCount(0);
  await page.locator('#columns-panel input[data-column=effort]').check();
  await expect(page.locator('.row.header [data-sort="effort"]')).toBeVisible();
  // "—" clears it.
  await page.goto('/#/all');
  await taskRow(page, 'Clean gutters').locator('select[name=effort]').selectOption('');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).effort).toBe(null);
});

test('a value that is no longer an option still shows on a done task, as a disabled entry', async ({ page, request }) => {
  await setEffort(request, await byTitle(request, 'Fix fence post'), 15); // done: the option can be dropped
  await request.patch('/api/settings', { data: { effort_options: JSON.stringify(DEFAULTS.filter((o) => o !== 15)) } });
  await page.goto('/#/all');
  const sel = taskRow(page, 'Fix fence post').locator('select[name=effort]');
  await expect(sel).toHaveValue('15');
  await expect(sel.locator('option[data-stale]')).toHaveText('15m');
  await expect(sel.locator('option[data-stale]')).toBeDisabled();
  expect(await sel.locator('option').allTextContents()).toEqual(['—', '15m', '30m', '1h', '2h', '4h', '8h', '16h', '32h', '64h']);
  await expect(parentRow(page, 'Maintenance').locator('.effort-cell')).toHaveAttribute('title', '15m done or cancelled');
  // An open task cannot take it: the dropdown no longer offers it.
  expect(await taskRow(page, 'Clean gutters').locator('select[name=effort] option').allTextContents()).not.toContain('15m');
});

test('Settings: effort options are added, removed, refused while in use, and reset', async ({ page, request }) => {
  await page.goto('/#/settings');
  const chips = page.locator('#setting-effort-options .effort-chip');
  await expect(chips).toHaveCount(9);
  expect(await chips.locator('.effort-chip-text').allTextContents()).toEqual(['15m', '30m', '1h', '2h', '4h', '8h', '16h', '32h', '64h']);
  await expect(page.locator('#setting-effort-reset')).toBeDisabled();

  // Add with hours-and-minutes notation: it lands in order.
  await page.locator('#setting-effort-add').fill('1h30m');
  await page.locator('#setting-effort-add').press('Enter');
  await expect(chips).toHaveCount(10);
  expect(await chips.locator('.effort-chip-text').allTextContents()).toEqual(['15m', '30m', '1h', '1h 30m', '2h', '4h', '8h', '16h', '32h', '64h']);
  expect(JSON.parse((await settings(request)).effort_options)).toEqual([15, 30, 60, 90, 120, 240, 480, 960, 1920, 3840]);
  await expect(page.locator('#setting-effort-reset')).toBeEnabled();
  // Minutes, with the button; junk is refused with a toast.
  await page.locator('#setting-effort-add').fill('45');
  await page.locator('#setting-effort-add-btn').click();
  await expect(chips).toHaveCount(11);
  expect(await chips.locator('.effort-chip-text').allTextContents()).toContain('45m');
  await page.locator('#setting-effort-add').fill('soon');
  await page.locator('#setting-effort-add').press('Enter');
  await expect(page.locator('#toast')).toContainText('Enter a duration');
  await expect(chips).toHaveCount(11);
  // Remove.
  await page.locator('[data-effort-remove="90"]').click();
  await expect(chips).toHaveCount(10);
  expect(await chips.locator('.effort-chip-text').allTextContents()).not.toContain('1h 30m');
  await page.locator('[data-effort-remove="45"]').click();
  await expect(chips).toHaveCount(9);

  // An option used by an open task cannot be removed: the server's message names it and the task.
  const gutters = await byTitle(request, 'Clean gutters');
  await setEffort(request, gutters, 30);
  await page.locator('[data-effort-remove="30"]').click();
  await expect(page.locator('#toast')).toContainText('30m');
  await expect(page.locator('#toast')).toContainText(gutters.key);
  await expect(chips).toHaveCount(9);
  await expect(page.locator('[data-effort-remove="30"]')).toBeVisible();
  expect(JSON.parse((await settings(request)).effort_options)).toEqual(DEFAULTS);
  await setEffort(request, gutters, null);

  // Reset to defaults after a change.
  await page.locator('[data-effort-remove="15"]').click();
  await expect(chips).toHaveCount(8);
  await expect(page.locator('#setting-effort-reset')).toBeEnabled();
  await page.locator('#setting-effort-reset').click();
  await expect(chips).toHaveCount(9);
  await expect(page.locator('#setting-effort-reset')).toBeDisabled();
  expect(JSON.parse((await settings(request)).effort_options)).toEqual(DEFAULTS);
});
