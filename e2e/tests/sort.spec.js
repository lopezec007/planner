import { test, expect } from '@playwright/test';

// Column sorting (headers clicked in order build a multi-column sort), the
// Sort menu with its User-defined reset, and "blocked items last".

const items = async (request) => (await request.get('/api/items')).json();
const byTitle = async (request, title) => (await items(request)).find((i) => i.title === title);
const taskTitles = (page, parentId) => page.locator(`.row.task[data-parent="${parentId}"] .title-text`).allTextContents();
const header = (page, key) => page.locator(`.row.header [data-sort="${key}"]`);

test('clicking a header sorts ascending, again descending, a third time back to user-defined', async ({ page, request }) => {
  const maint = await byTitle(request, 'Maintenance');
  await page.goto('/#/all');
  const userOrder = ['Clean gutters', 'Replace HVAC filter', 'Service lawnmower', 'Fix fence post', 'Install smart thermostat'];
  await expect.poll(() => taskTitles(page, maint.id)).toEqual(userOrder);
  await expect(page.locator('.drag-handle[draggable]').first()).toBeVisible();

  await header(page, 'urgency').click();
  await expect(header(page, 'urgency')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => taskTitles(page, maint.id)).toEqual(['Install smart thermostat', 'Service lawnmower', 'Fix fence post', 'Clean gutters', 'Replace HVAC filter']);
  await expect(page.locator('.table')).toHaveClass(/sorted/);
  // While sorted the rows cannot be dragged (positions no longer mean anything).
  await expect(page.locator('.drag-handle[draggable]')).toHaveCount(0);
  await expect(page.locator('.drag-handle.disabled').first()).toBeVisible();
  await expect(page.locator('#btn-sort')).toHaveClass(/active/);
  await expect(page.locator('#sort-badge')).toHaveText('1');

  await header(page, 'urgency').click();
  await expect(header(page, 'urgency')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => taskTitles(page, maint.id)).toEqual(['Replace HVAC filter', 'Clean gutters', 'Fix fence post', 'Service lawnmower', 'Install smart thermostat']);

  await header(page, 'urgency').click();
  await expect(header(page, 'urgency')).toHaveAttribute('aria-sort', 'none');
  await expect.poll(() => taskTitles(page, maint.id)).toEqual(userOrder);
  await expect(page.locator('.drag-handle[draggable]').first()).toBeVisible();
  await expect(page.locator('#sort-badge')).toHaveCount(0);
});

test('headers clicked in sequence build a multi-column sort, shown in the menu and persisted', async ({ page, request }) => {
  const kitchen = await byTitle(request, 'Kitchen remodel');
  await page.goto('/#/all');
  await header(page, 'assignee').click();
  await header(page, 'title').click();
  // Assignees alphabetically (Evan, Sam), then unassigned last, ties by title.
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Demo old cabinets', 'Order countertops', 'Choose backsplash', 'Electrical rough-in', 'Paint walls']);
  await expect(header(page, 'assignee').locator('.sort-index')).toHaveText('1');
  await expect(header(page, 'title').locator('.sort-index')).toHaveText('2');
  await expect(page.locator('#sort-badge')).toHaveText('2');
  // Parents sort by the same keys: Spring garden (Alex) first, then Kitchen (Evan), then Finance (Sam) ...
  const parents = await page.locator('.row.parent .title-text').allTextContents();
  expect(parents.indexOf('Spring garden')).toBeLessThan(parents.indexOf('Kitchen remodel'));
  expect(parents.indexOf('Kitchen remodel')).toBeLessThan(parents.indexOf('Finance'));

  // The menu lists the columns in order; flipping the second one reverses the tie-break.
  await page.locator('#btn-sort').click();
  await expect(page.locator('#sort-panel')).toBeVisible();
  await expect(page.locator('#sort-panel .sort-item')).toHaveCount(2);
  await expect(page.locator('#sort-panel .sort-item').nth(0)).toContainText('Assignee');
  await expect(page.locator('#sort-panel .sort-item').nth(1)).toContainText('Title');
  await page.locator('#sort-panel .sort-item').nth(1).locator('.sort-dir').click();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Demo old cabinets', 'Order countertops', 'Paint walls', 'Electrical rough-in', 'Choose backsplash']);

  // Survives a reload (a browser preference with no account picked).
  await page.reload();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Demo old cabinets', 'Order countertops', 'Paint walls', 'Electrical rough-in', 'Choose backsplash']);
  await expect(header(page, 'title')).toHaveAttribute('aria-sort', 'descending');

  // User-defined in the menu clears the whole sort.
  await page.locator('#btn-sort').click();
  await page.locator('#sort-panel input[value="user"]').check();
  await expect(page.locator('#sort-badge')).toHaveCount(0);
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Demo old cabinets', 'Order countertops', 'Electrical rough-in', 'Paint walls', 'Choose backsplash']);
});

test('blocked items last applies whatever the sort, to tasks and to parents', async ({ page, request }) => {
  const fin = await byTitle(request, 'Finance');
  await page.goto('/#/all');
  await expect.poll(() => taskTitles(page, fin.id)).toEqual(['Pay insurance', 'Review budget']); // Pay insurance is blocked
  await page.locator('#btn-sort').click();
  await page.locator('#sort-blocked-last').check();
  await expect.poll(() => taskTitles(page, fin.id)).toEqual(['Review budget', 'Pay insurance']);
  // Spring garden is blocked by Kitchen remodel (in progress): it sinks below the other parents.
  const parents = await page.locator('.row.parent .title-text').allTextContents();
  expect(parents[parents.length - 1]).toBe('Spring garden');
  await expect(page.locator('.drag-handle[draggable]')).toHaveCount(0);
  // Combined with a column sort: urgency descending in Finance would put Pay insurance (10) first, but it stays last.
  await header(page, 'urgency').click();
  await header(page, 'urgency').click();
  await expect.poll(() => taskTitles(page, fin.id)).toEqual(['Review budget', 'Pay insurance']);
  await page.locator('#btn-sort').click();
  await page.locator('#sort-blocked-last').uncheck();
  await expect.poll(() => taskTitles(page, fin.id)).toEqual(['Pay insurance', 'Review budget']);
  await header(page, 'urgency').click(); // off
  await expect(page.locator('#sort-badge')).toHaveCount(0);
});

test('Flat sorts every task together and offers the Ongoing / Project column', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await expect(header(page, 'parent')).toHaveText(/Ongoing \/ Project/);
  await header(page, 'importance').click();
  await header(page, 'importance').click(); // descending across all parents
  const titles = await page.locator('.row.task .title-text').allTextContents();
  expect(titles.slice(0, 3)).toEqual(['Pay insurance', 'Order countertops', 'Gather W-2s']); // importance 9, 9, 9 in user order
  await expect(page.locator('.row.task.group-start')).toHaveCount(0); // interleaved parents: no group rules
  // Sorting by the parent column regroups the tasks, with the rules back.
  await header(page, 'importance').click();
  await header(page, 'parent').click();
  await expect.poll(() => page.locator('.row.task.group-start').count()).toBeGreaterThan(3);
  // Leaving Flat sets that column aside: the table is unsorted and draggable again...
  await page.locator('#btn-nested').click();
  await expect(page.locator('.table')).not.toHaveClass(/sorted/);
  await expect(page.locator('#sort-badge')).toHaveCount(0);
  await expect(page.locator('.drag-handle[draggable]').first()).toBeVisible();
  // ...and it comes back with Flat.
  await page.locator('#btn-flat').click();
  await expect(header(page, 'parent')).toHaveAttribute('aria-sort', 'ascending');
  await header(page, 'parent').click();
  await header(page, 'parent').click();
  await page.locator('#btn-nested').click();
  await expect(page.locator('#sort-badge')).toHaveCount(0);
});
