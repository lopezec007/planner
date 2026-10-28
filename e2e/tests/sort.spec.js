import { test, expect } from '@playwright/test';

// Column sorting (headers clicked in order build a multi-column sort), the
// Sort menu with its User-defined reset, "blocked items last" and "done /
// cancelled items last".

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

  await header(page, 'urgency').click(); // urgency starts descending: the most urgent first
  await expect(header(page, 'urgency')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => taskTitles(page, maint.id)).toEqual(['Replace HVAC filter', 'Clean gutters', 'Fix fence post', 'Service lawnmower', 'Install smart thermostat']);
  await expect(page.locator('.table')).toHaveClass(/sorted/);
  // While sorted the rows cannot be dragged (positions no longer mean anything).
  await expect(page.locator('.drag-handle[draggable]')).toHaveCount(0);
  await expect(page.locator('.drag-handle.disabled').first()).toBeVisible();
  await expect(page.locator('#btn-sort')).toHaveClass(/active/);
  await expect(page.locator('#sort-badge')).toHaveText('1');

  await header(page, 'urgency').click();
  await expect(header(page, 'urgency')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => taskTitles(page, maint.id)).toEqual(['Install smart thermostat', 'Service lawnmower', 'Fix fence post', 'Clean gutters', 'Replace HVAC filter']);

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
  await header(page, 'urgency').click(); // descending at once
  await expect.poll(() => taskTitles(page, fin.id)).toEqual(['Review budget', 'Pay insurance']);
  await page.locator('#btn-sort').click();
  await page.locator('#sort-blocked-last').uncheck();
  await expect.poll(() => taskTitles(page, fin.id)).toEqual(['Pay insurance', 'Review budget']);
  await header(page, 'urgency').click(); // ascending
  await header(page, 'urgency').click(); // off
  await expect(page.locator('#sort-badge')).toHaveCount(0);
});

test('done / cancelled items last sinks closed items, alone and below the blocked ones with blocked last', async ({ page, request }) => {
  const kitchen = await byTitle(request, 'Kitchen remodel');
  await page.goto('/#/all');
  // User order: Demo (done), Order countertops, Electrical rough-in (blocked), Paint walls (blocked), Choose backsplash (cancelled).
  const userOrder = ['Demo old cabinets', 'Order countertops', 'Electrical rough-in', 'Paint walls', 'Choose backsplash'];
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(userOrder);
  await page.locator('#btn-sort').click();
  await page.locator('#sort-closed-last').check();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Order countertops', 'Electrical rough-in', 'Paint walls', 'Demo old cabinets', 'Choose backsplash']);
  // The switch alone counts as sorting: no dragging, the button lit, the title says so.
  await expect(page.locator('.table')).toHaveClass(/sorted/);
  await expect(page.locator('.drag-handle[draggable]')).toHaveCount(0);
  await expect(page.locator('#btn-sort')).toHaveClass(/active/);
  await expect(page.locator('#btn-sort')).toHaveAttribute('title', /done \/ cancelled last/);
  // Parents too: the done project sinks to the bottom.
  let parents = await page.locator('.row.parent .title-text').allTextContents();
  expect(parents[parents.length - 1]).toBe('Repaint shed');
  // With blocked last as well: open and unblocked, then blocked, then closed (whatever their blocked state).
  await page.locator('#sort-blocked-last').check();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Order countertops', 'Electrical rough-in', 'Paint walls', 'Demo old cabinets', 'Choose backsplash']);
  parents = await page.locator('.row.parent .title-text').allTextContents();
  expect(parents.slice(-2)).toEqual(['Spring garden', 'Repaint shed']); // blocked, then done
  await expect(page.locator('#btn-sort')).toHaveAttribute('title', /blocked last, done \/ cancelled last/);
  // Blocked last alone puts the blocked ones below the closed ones.
  await page.locator('#sort-closed-last').uncheck();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Demo old cabinets', 'Order countertops', 'Choose backsplash', 'Electrical rough-in', 'Paint walls']);
  // Both with a column sort: each band keeps the sort (importance descending: Order 9, Electrical 7, Paint 4; Demo 8, Choose 2).
  await page.locator('#sort-closed-last').check();
  await header(page, 'importance').click();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Order countertops', 'Electrical rough-in', 'Paint walls', 'Demo old cabinets', 'Choose backsplash']);
  await header(page, 'importance').click(); // ascending: Order 9 | Paint 4, Electrical 7 (blocked) | Choose 2, Demo 8 (closed)
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Order countertops', 'Paint walls', 'Electrical rough-in', 'Choose backsplash', 'Demo old cabinets']);
  await header(page, 'importance').click(); // off
  // The preference survives a reload; off again restores the user order and dragging.
  await page.reload();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(['Order countertops', 'Electrical rough-in', 'Paint walls', 'Demo old cabinets', 'Choose backsplash']);
  await page.locator('#btn-sort').click();
  await expect(page.locator('#sort-closed-last')).toBeChecked();
  await page.locator('#sort-closed-last').uncheck();
  await page.locator('#sort-blocked-last').uncheck();
  await expect.poll(() => taskTitles(page, kitchen.id)).toEqual(userOrder);
  await expect(page.locator('.drag-handle[draggable]').first()).toBeVisible();
  await expect(page.locator('#btn-sort')).not.toHaveClass(/active/);
});

test('Flat sorts every task together and offers the Ongoing / Project column', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await expect(header(page, 'parent')).toHaveText(/Ongoing \/ Project/);
  await header(page, 'importance').click(); // descending across all parents
  const titles = await page.locator('.row.task .title-text').allTextContents();
  expect(titles.slice(0, 3)).toEqual(['Pay insurance', 'Order countertops', 'Gather W-2s']); // importance 9, 9, 9 in user order
  await expect(page.locator('.row.task.group-start')).toHaveCount(0); // interleaved parents: no group rules
  // Sorting by the parent column regroups the tasks, with the rules back.
  await header(page, 'importance').click(); // ascending
  await header(page, 'importance').click(); // off
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

test('removing the last visible sort column outside Flat keeps the set-aside Ongoing / Project column', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await header(page, 'parent').click();
  await header(page, 'urgency').click();
  await expect(page.locator('#sort-badge')).toHaveText('2');
  await page.locator('#btn-nested').click();
  await expect(page.locator('#sort-badge')).toHaveText('1'); // Ongoing / Project set aside
  await header(page, 'urgency').click(); // ascending
  await header(page, 'urgency').click(); // off
  await expect(page.locator('#sort-badge')).toHaveCount(0);
  await expect(page.locator('.table')).not.toHaveClass(/sorted/);
  await page.locator('#btn-flat').click();
  await expect(header(page, 'parent')).toHaveAttribute('aria-sort', 'ascending'); // still there
  await expect(page.locator('#sort-badge')).toHaveText('1');
  // Flipping a visible column outside Flat keeps it too, in its place.
  await header(page, 'end').click();
  await page.locator('#btn-nested').click();
  await header(page, 'end').click(); // descending
  await page.locator('#btn-flat').click();
  await expect(header(page, 'parent')).toHaveAttribute('aria-sort', 'ascending');
  await expect(header(page, 'end')).toHaveAttribute('aria-sort', 'descending');
  await expect(header(page, 'parent').locator('.sort-index')).toHaveText('1');
  // User-defined in the Sort menu clears everything, set-aside columns included.
  await page.locator('#btn-nested').click();
  await page.locator('#btn-sort').click();
  await page.locator('#sort-panel input[name=sort-mode][value=user]').check();
  await page.keyboard.press('Escape');
  await page.locator('#btn-flat').click();
  await expect(page.locator('#sort-badge')).toHaveCount(0);
  await expect(header(page, 'parent')).toHaveAttribute('aria-sort', 'none');
  await page.locator('#btn-nested').click();
});
