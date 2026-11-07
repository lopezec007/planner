import { test, expect } from '@playwright/test';

// The Validating status: work that is finished but still being checked. It
// behaves like In-Progress everywhere: open (not closed), shown by the
// Active template, a blocker in that status still blocks.

const items = async (request) => (await request.get('/api/items')).json();
const byTitle = async (request, title) => (await items(request)).find((i) => i.title === title);

test('Validating is a status like In-Progress: selectable, open, and part of the Active template', async ({ page, request }) => {
  const maint = await byTitle(request, 'Maintenance');
  const created = await (await request.post('/api/items', { data: { type: 'task', parent_id: maint.id, title: 'E2E Validating probe', status: 'validating', urgency: 6, importance: 6 } })).json();
  expect(created.status).toBe('validating');
  expect(created.closed_at).toBeNull();
  const waiting = await (await request.post('/api/items', { data: { type: 'task', parent_id: maint.id, title: 'E2E Waits on validating', status: 'todo' } })).json();
  expect((await request.post('/api/dependencies', { data: { blocker_id: created.id, blocked_id: waiting.id } })).ok()).toBeTruthy();
  try {
    // The default view is the Active template, and it shows the task.
    await page.goto('/');
    await expect(page.locator('.search-preset[data-preset=active]')).toHaveAttribute('aria-pressed', 'true');
    const row = page.locator(`.row.task[data-id="${created.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).not.toHaveClass(/closed/);
    await expect(row.locator('.status')).toHaveClass(/validating/);
    await expect(row.locator('select[name=status]')).toHaveValue('validating');
    // Highlighting still applies (it does not on closed items): urgency 6 is a warn value.
    await expect(row.locator('input[name=urgency]')).toHaveClass(/hl-level/);
    // The status dot has a colour of its own.
    const dot = (cls) => page.evaluate((c) => { const s = document.createElement('span'); s.className = `status ${c}`; document.body.append(s); const v = getComputedStyle(s, '::before').color; s.remove(); return v; }, cls);
    expect(await dot('validating')).not.toBe(await dot('in-progress'));
    expect(await dot('validating')).not.toBe(await dot('done'));
    // What it blocks stays blocked (it is still open).
    await expect(page.locator(`.row.task[data-id="${waiting.id}"]`)).toHaveClass(/blocked/);
    // The status menu lists it between In-Progress and Done, on every row.
    expect(await row.locator('select[name=status] option').allTextContents()).toEqual(['Idea', 'Backlog', 'To-Do', 'In-Progress', 'Validating', 'Done', 'Cancelled']);
    // The Filters panel has its chip, lit as part of Active.
    await page.locator('#btn-filters').click();
    const chip = page.locator('#search-panel [data-search-key="status:validating"]');
    await expect(chip).toHaveText('Validating');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#search-panel [data-search-key="status:in-progress"]')).toHaveAttribute('aria-pressed', 'true');
    // Without it the row goes and Active is no longer the lit template; back again.
    await chip.click();
    await expect(row).toHaveCount(0);
    await expect(page.locator('.search-preset[data-preset=active]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#search-panel [data-search-key="status:validating"]').click();
    await expect(row).toBeVisible();
    await expect(page.locator('.search-preset[data-preset=active]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    // Backlog alone does not show it.
    await page.goto('/#/backlog');
    await expect(page.locator('.row.parent').first()).toBeVisible();
    await expect(row).toHaveCount(0);

    // Picking it from the menu saves it, with a history entry; Done then closes the item.
    await page.goto('/#/all');
    const w = page.locator(`.row.task[data-id="${waiting.id}"]`);
    await w.locator('select[name=status]').selectOption('validating');
    await expect.poll(async () => (await byTitle(request, 'E2E Waits on validating')).status).toBe('validating');
    await expect(w.locator('.status')).toHaveClass(/validating/);
    const history = await (await request.get(`/api/items/${waiting.id}/history`)).json();
    expect(history.map((h) => h.status)).toEqual(['todo', 'validating']);
    // Sorting by status puts it after In-Progress and before Done.
    await page.locator('.row.header [data-sort=status]').click();
    const statuses = await page.locator(`.row.task[data-parent="${maint.id}"] select[name=status]`).evaluateAll((els) => els.map((e) => e.value));
    const order = ['idea', 'backlog', 'todo', 'in-progress', 'validating', 'done', 'cancelled'];
    expect(statuses).toEqual([...statuses].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(statuses).toContain('validating');
    // The Matrix draws it as an open task, not a faint closed one.
    await page.locator('button[data-view=matrix]').click();
    await expect(page.locator(`.matrix-plot .pt[data-id="${created.id}"]`)).not.toHaveClass(/closed/);
    // It can be the default status for new items.
    const res = await request.patch('/api/settings', { data: { default_status: 'validating' } });
    expect(res.ok()).toBeTruthy();
  } finally {
    await request.patch('/api/settings', { data: { default_status: 'todo' } });
    await request.delete(`/api/items/${created.id}`);
    await request.delete(`/api/items/${waiting.id}`);
  }
});
