import { test, expect } from '@playwright/test';

// Collapsible parents, the Flat layout, and undo (Ctrl+Z).

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

test('parents collapse their tasks with the caret, and the state survives a reload', async ({ page }) => {
  await page.goto('/#/all');
  const kitchen = page.locator('.row.parent', { hasText: 'Kitchen remodel' });
  await expect(page.locator('.row.task', { hasText: 'Order countertops' })).toBeVisible();
  await kitchen.locator('.caret').click();
  await expect(page.locator('.row.task', { hasText: 'Order countertops' })).toHaveCount(0);
  await expect(page.locator('.row.parent', { hasText: 'Kitchen remodel' })).toHaveClass(/collapsed/);
  await expect(page.locator('.row.parent', { hasText: 'Kitchen remodel' }).locator('.task-count')).toHaveText(/\(\d+\)/);
  await page.reload();
  await expect(page.locator('.row.task', { hasText: 'Order countertops' })).toHaveCount(0);
  // Adding a task re-opens the parent.
  await page.locator('.row.parent', { hasText: 'Kitchen remodel' }).locator('button[title="Add task"]').click();
  await expect(page.locator('.row[data-editing="new"]')).toHaveCount(2); // row + detail
  await expect(page.locator('.row.task', { hasText: 'Order countertops' })).toBeVisible();
  await page.locator('button[title=Discard]').click();
  // Every row, including an Ongoing without a description, can be expanded.
  const finance = page.locator('.row.parent', { hasText: 'Finance' });
  await finance.locator('.toggle button').click();
  await expect(page.locator('.row.description .md.placeholder')).toBeVisible();
});

test('Flat shows tasks only, with the parent key and title as leading columns', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await expect(page.locator('.table')).toHaveClass(/flat/);
  await expect(page.locator('.row.parent')).toHaveCount(0);
  const row = page.locator('.row.task', { hasText: 'Order countertops' });
  const cells = row.locator(':scope > *');
  await expect(cells.nth(1)).toHaveText('P-1');              // parent key
  await expect(cells.nth(2)).toContainText('T-9');           // task key
  await expect(cells.nth(3)).toHaveText('Kitchen remodel');  // parent title
  await expect(cells.nth(4)).toContainText('Order countertops');
  await expect(page.locator('.row.header > *').nth(3)).toHaveText('Ongoing / Project');
  // The expanded row keeps the description under the task title.
  await row.locator('.toggle button').click();
  const detail = page.locator('.row.description[data-desc-for]');
  await expect(detail.locator(':scope > .title')).toBeVisible();
  const title = await cells.nth(4).boundingBox();
  const desc = await detail.locator(':scope > .title').boundingBox();
  expect(Math.abs(title.x - desc.x)).toBeLessThan(1);
  // Timeline beside the flat table shows task bars only.
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('.table.flat.title-only')).toBeVisible();
  await expect(page.locator('.timeline-bar.parent')).toHaveCount(0);
  await page.locator('button[data-view=table]').click();
  await page.locator('#btn-flat').click();
  await expect(page.locator('.row.parent').first()).toBeVisible();
});

test('Ctrl+Z undoes edits, deletions, creations, reorders and dependency changes', async ({ page, request }) => {
  await page.goto('/#/all');
  const gutters = await byTitle(request, 'Clean gutters');
  // Edit urgency 7 -> 3, undo.
  const row = page.locator('.row.task', { hasText: 'Clean gutters' });
  await row.locator('input[name=urgency]').press('3');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).urgency).toBe(3);
  await page.locator('body').click({ position: { x: 5, y: 400 } }); // leave the input
  await page.keyboard.press('Control+z');
  await expect(page.locator('#toast')).toContainText('Undid editing T-1');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).urgency).toBe(gutters.urgency);
  // Delete a task, undo restores it.
  page.on('dialog', (d) => d.accept());
  await page.locator('.row.task', { hasText: 'Review budget' }).locator('button[title=Delete]').click();
  await expect(page.locator('.row.task', { hasText: 'Review budget' })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.row.task', { hasText: 'Review budget' })).toBeVisible();
  // Create a project, undo removes it.
  await page.locator('#btn-new-project').click();
  await page.locator('input[name=title]').fill('Undo me');
  await page.locator('input[name=title]').press('Enter');
  await expect(page.locator('.row.parent', { hasText: 'Undo me' })).toBeVisible();
  expect(await byTitle(request, 'Undo me')).toBeDefined();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.row.parent', { hasText: 'Undo me' })).toHaveCount(0);
  expect(await byTitle(request, 'Undo me')).toBeUndefined();
  // Add a dependency, undo removes it.
  const budget = await byTitle(request, 'Review budget');
  await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.toggle button').click();
  await page.locator('.row.description[data-desc-for] [data-deps=blocked_by] select.dep-add').selectOption(String(budget.id));
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).blocked_by).toEqual([budget.id]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).blocked_by).toEqual([]);
  // Reorder by drag, undo restores the order (one step for a move between parents).
  const maint = await byTitle(request, 'Maintenance');
  const order = async () => (await (await request.get('/api/items')).json()).filter((i) => i.parent_id === maint.id).map((i) => i.title);
  const before = await order();
  await page.locator('.row.task', { hasText: 'Replace HVAC filter' }).locator('.drag-handle').dragTo(page.locator('.row.task', { hasText: 'Clean gutters' }), { targetPosition: { x: 200, y: 4 } });
  await expect.poll(order).not.toEqual(before);
  await page.keyboard.press('Control+z');
  await expect.poll(order).toEqual(before);
  // Nothing left that we did: a further undo of unrelated stack entries is not attempted here.
  // Ctrl+Z inside a text field is left to the browser.
  await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.title-text').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#toast')).not.toContainText('Nothing to undo');
  await page.keyboard.press('Escape');
});

test('switching views does not move the rows (the toolbar keeps its height)', async ({ page }) => {
  for (const width of [1440, 1366]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/all');
    await expect(page.locator('.row[data-id]').first()).toBeVisible();
    const pos = () => page.evaluate(() => ({ top: document.querySelector('.row[data-id]').getBoundingClientRect().top, bar: document.querySelector('.topbar').getBoundingClientRect().height }));
    const table = await pos();
    await page.locator('button[data-view=timeline]').click();
    await expect(page.locator('.timeline-canvas')).toBeVisible();
    expect(await pos()).toEqual(table);
    await page.locator('button[data-view=matrix]').click();
    await expect(page.locator('.matrix-plot')).toBeVisible();
    expect(await pos()).toEqual(table);
    await expect(page.locator('#btn-narrow')).toBeDisabled();
    await page.locator('button[data-view=table]').click();
    await expect(page.locator('#btn-narrow')).toBeEnabled();
  }
});
