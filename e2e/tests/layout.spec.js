import { test, expect } from '@playwright/test';

// Collapsible parents, the Flat layout, and undo (Ctrl+Z).

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

// HTML5 drag of a row handle onto a target row with a stepped pointer path.
// Chromium does not always start a drag from locator.dragTo's single move
// (depending on what was edited before), while a few real moves are reliable.
export async function dragRow(page, handle, target, { x = 200, y = 4 } = {}) {
  // Both rows must be on screen and clear of the sticky title bar, which
  // would otherwise swallow the drop.
  const bar = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().bottom);
  let t = await target.boundingBox();
  let h = await handle.boundingBox();
  const top = Math.min(t.y, h.y), bottom = Math.max(t.y + t.height, h.y + h.height);
  if (top < bar + 8) { await page.evaluate((dy) => window.scrollBy(0, dy), top - bar - 40); }
  else if (bottom > await page.evaluate(() => window.innerHeight)) { await page.evaluate((dy) => window.scrollBy(0, dy), bottom - await page.evaluate(() => window.innerHeight) + 40); }
  t = await target.boundingBox();
  h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 10, h.y + h.height / 2 + 5);
  await page.mouse.move(t.x + x, t.y + y, { steps: 5 });
  await page.mouse.up();
}

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
  await page.locator('#btn-nested').click();
  await expect(page.locator('.row.parent').first()).toBeVisible();
});

test('Ctrl+Z undoes edits, deletions, creations, reorders and dependency changes', async ({ page, request }) => {
  await page.goto('/#/all');
  const gutters = await byTitle(request, 'Clean gutters');
  // The undo entry is recorded when the browser sees the response and the
  // table is then re-rendered; the API alone can be ahead of that, so each
  // step waits for the re-render before pressing Ctrl+Z.
  const settled = async () => { await expect(page.locator('.row[data-id]').first()).toBeVisible(); await page.waitForTimeout(350); };
  // Edit urgency 7 -> 3, undo.
  const row = page.locator('.row.task', { hasText: 'Clean gutters' });
  await row.locator('input[name=urgency]').press('3');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).urgency).toBe(3);
  await settled();
  await page.locator('body').click({ position: { x: 5, y: 400 } }); // leave the input
  await page.keyboard.press('Control+z');
  await expect(page.locator('#toast')).toContainText('Undid editing T-1');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).urgency).toBe(gutters.urgency);
  // Delete a task, undo restores it.
  page.on('dialog', (d) => d.accept());
  await page.locator('.row.task', { hasText: 'Review budget' }).locator('button[title=Delete]').click();
  await expect(page.locator('.row.task', { hasText: 'Review budget' })).toHaveCount(0);
  await settled();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.row.task', { hasText: 'Review budget' })).toBeVisible();
  // Create a project, undo removes it.
  await page.locator('#btn-new-project').click();
  await page.locator('input[name=title]').fill('Undo me');
  await page.locator('input[name=title]').press('Enter');
  await expect(page.locator('.row.parent', { hasText: 'Undo me' })).toBeVisible();
  expect(await byTitle(request, 'Undo me')).toBeDefined();
  await settled();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.row.parent', { hasText: 'Undo me' })).toHaveCount(0);
  expect(await byTitle(request, 'Undo me')).toBeUndefined();
  // Add a dependency, undo removes it.
  const budget = await byTitle(request, 'Review budget');
  await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.toggle button').click();
  await page.locator('.row.description[data-desc-for] [data-deps=blocked_by] .dep-add-btn').click();
  await page.locator('.row.description[data-desc-for] [data-deps=blocked_by] select.dep-add').selectOption(String(budget.id));
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).blocked_by).toEqual([budget.id]);
  await expect(page.locator(`.row.description[data-desc-for] [data-deps=blocked_by] .dep-chip[data-id="${budget.id}"]`)).toBeVisible();
  await settled();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await byTitle(request, 'Clean gutters')).blocked_by).toEqual([]);
  // Reorder by drag, undo restores the order (one step for a move between parents).
  const maint = await byTitle(request, 'Maintenance');
  const order = async () => (await (await request.get('/api/items')).json()).filter((i) => i.parent_id === maint.id).map((i) => i.title);
  const before = await order();
  await dragRow(page, page.locator('.row.task', { hasText: 'Replace HVAC filter' }).locator('.drag-handle'), page.locator('.row.task', { hasText: 'Clean gutters' }));
  await expect.poll(order).not.toEqual(before);
  await settled();
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
    const pos = () => page.evaluate(() => {
      const row = document.querySelector('.row.parent[data-id]');
      const caret = row.querySelector('.caret').getBoundingClientRect(), title = row.querySelector('.title-text').getBoundingClientRect();
      return { top: document.querySelector('.row[data-id]').getBoundingClientRect().top, bar: document.querySelector('.topbar').getBoundingClientRect().height, caretGap: title.left - caret.right };
    });
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

test('in Flat a drag reorders within the parent only and never moves the task elsewhere', async ({ page, request }) => {
  const maint = await byTitle(request, 'Maintenance');
  const order = async () => (await (await request.get('/api/items')).json()).filter((i) => i.parent_id === maint.id).map((i) => i.title);
  const before = await order();
  const gutters = await byTitle(request, 'Clean gutters');
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await expect(page.locator('.table')).toHaveClass(/flat/);
  // Onto another parent's task: refused (no drop marker, nothing changes).
  await dragRow(page, page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.drag-handle'), page.locator('.row.task', { hasText: 'Pay insurance' }));
  await page.waitForTimeout(400);
  expect((await byTitle(request, 'Clean gutters')).parent_id).toBe(gutters.parent_id);
  expect(await order()).toEqual(before);
  // Among its own parent's tasks: reorders.
  await dragRow(page, page.locator('.row.task', { hasText: 'Replace HVAC filter' }).locator('.drag-handle'), page.locator('.row.task', { hasText: 'Clean gutters' }));
  await expect.poll(order).toEqual(['Replace HVAC filter', 'Clean gutters', 'Service lawnmower', 'Fix fence post', 'Install smart thermostat']);
  expect((await byTitle(request, 'Replace HVAC filter')).parent_id).toBe(maint.id);
  await page.waitForTimeout(350);
  await page.keyboard.press('Control+z');
  await expect.poll(order).toEqual(before);
  await page.locator('#btn-nested').click();
});

test('a heavier rule separates each parent from the previous group, in the table and in Flat', async ({ page }) => {
  await page.goto('/#/all');
  const width = (loc) => loc.evaluate((e) => getComputedStyle(e).borderTopWidth);
  expect(await width(page.locator('.row.parent', { hasText: 'Finance' }))).toBe('2px');
  expect(await width(page.locator('.row.task', { hasText: 'Review budget' }))).toBe('1px');
  expect(await page.locator('.row.parent', { hasText: 'Finance' }).evaluate((e) => e.getBoundingClientRect().height)).toBe(36);
  await page.locator('#btn-flat').click();
  const first = page.locator('.row.task', { hasText: 'Pay insurance' }); // first task of the second parent
  await expect(first).toHaveClass(/group-start/);
  expect(await width(first)).toBe('2px');
  expect(await width(page.locator('.row.task', { hasText: 'Review budget' }))).toBe('1px');
  await page.locator('button[data-view=timeline]').click();
  expect(await width(page.locator('.timeline-row.task').first())).toBe('1px');
  await page.locator('button[data-view=table]').click();
  await page.locator('#btn-nested').click();
  await page.locator('button[data-view=timeline]').click();
  expect(await width(page.locator('.timeline-row.parent').first())).toBe('2px');
  await page.locator('button[data-view=table]').click();
});
