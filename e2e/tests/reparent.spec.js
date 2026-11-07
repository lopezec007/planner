import { test, expect } from '@playwright/test';

// The "move to another Ongoing/Project" button on task rows.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

test('a task can be moved to another parent from its row, in the Table and beside the Timeline, and undone', async ({ page, request }) => {
  const gutters = await byTitle(request, 'Clean gutters');
  const fin = await byTitle(request, 'Finance');
  const maint = await byTitle(request, 'Maintenance');
  try {
    await page.goto('/#/all');
    const row = page.locator('.row.task', { hasText: 'Clean gutters' });
    await expect(row).toHaveAttribute('data-parent', String(maint.id));
    await expect(page.locator('.row.parent button.reparent')).toHaveCount(0); // parents have no such button
    await row.locator('button.reparent').click();
    const box = row.locator('input[name=reparent]');
    await expect(box).toBeFocused();
    const list = page.locator('.dep-pick-list');
    await expect(list).toBeVisible();
    await expect(list.locator(`.dep-pick-opt[data-id="${maint.id}"]`)).toHaveCount(0); // not its current parent
    await expect(list.locator('.dep-pick-opt')).toHaveCount((await (await request.get('/api/items')).json()).filter((i) => i.type !== 'task').length - 1);
    await expect(list.locator('.dep-pick-opt').first().locator('.dep-pick-title')).toHaveText('Finance'); // keys and titles, as for dependencies
    // The list stays inside the window even though the box is at the far right.
    expect((await list.boundingBox()).x + (await list.boundingBox()).width).toBeLessThanOrEqual(1500);
    await box.type('nanc'); // any part of the title
    await expect(list.locator('.dep-pick-opt')).toHaveCount(1);
    await list.locator(`.dep-pick-opt[data-id="${fin.id}"]`).click();
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' })).toHaveAttribute('data-parent', String(fin.id));
    const finTasks = await page.locator(`.row.task[data-parent="${fin.id}"] .title-text`).allTextContents();
    expect(finTasks[finTasks.length - 1]).toBe('Clean gutters'); // goes last under its new parent
    await page.waitForTimeout(350);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#toast')).toContainText('Undid moving T-1');
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' })).toHaveAttribute('data-parent', String(maint.id));
    await expect.poll(() => page.locator(`.row.task[data-parent="${maint.id}"] .title-text`).first().textContent()).toBe('Clean gutters'); // back in first place

    // Escape closes the box without moving anything.
    await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button.reparent').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button.reparent')).toBeVisible();
    await expect(page.locator('.dep-pick-list')).toHaveCount(0);

    // The title-only table (Timeline view) has the button in the title cell.
    await page.locator('button[data-view=timeline]').click();
    const trow = page.locator('.row.task', { hasText: 'Clean gutters' });
    await trow.hover();
    await trow.locator('button.reparent').click();
    await trow.locator('input[name=reparent]').type(fin.key.toLowerCase()); // any part of the key
    await trow.locator('input[name=reparent]').press('Enter'); // the highlighted (only) match
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' })).toHaveAttribute('data-parent', String(fin.id));
  } finally {
    await request.patch(`/api/items/${gutters.id}`, { data: { parent_id: maint.id } });
    const ids = (await (await request.get('/api/items')).json()).filter((i) => i.parent_id === maint.id).sort((a, b) => a.id - b.id).map((i) => i.id);
    await request.put('/api/order', { data: { ids } });
  }
});
