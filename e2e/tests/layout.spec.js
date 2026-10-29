import { test, expect } from '@playwright/test';

// Collapsible parents, the Flat layout, and undo (Ctrl+Z).

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

// HTML5 drag of a row handle onto a target row with a stepped pointer path.
// Chromium does not always start a drag from locator.dragTo's single move
// (depending on what was edited before), while a few real moves are reliable.
export async function dragRow(page, handle, target, { x = 200, y = 4 } = {}) {
  // Both rows must be on screen and clear of the sticky title bar, which
  // would otherwise swallow the drop. The handle sits in the last column,
  // which lies past the right edge of a 1500px window in Flat (the page
  // scrolls sideways there), so it is scrolled into view first.
  await handle.scrollIntoViewIfNeeded();
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
  // No collapse column in Flat (there are no parent rows to collapse).
  await expect(page.locator('.collapse-cell')).toHaveCount(0);
  await expect(cells.nth(0)).toHaveText('P-1');              // parent key
  await expect(cells.nth(1)).toContainText('T-9');           // task key
  await expect(cells.nth(2)).toHaveText('Kitchen remodel');  // parent title
  await expect(cells.nth(3)).toContainText('Order countertops');
  await expect(page.locator('.row.header > *').nth(2)).toHaveText('Ongoing / Project');
  // The expanded row keeps the description under the task title.
  await row.locator('.toggle button').click();
  const detail = page.locator('.row.description[data-desc-for]');
  await expect(detail.locator(':scope > .title')).toBeVisible();
  const title = await cells.nth(3).boundingBox();
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

test('in Nested each parent and its tasks is a framed block of its own; Flat is one table with a heavier rule per group', async ({ page }) => {
  await page.goto('/#/all');
  const width = (loc) => loc.evaluate((e) => getComputedStyle(e).borderTopWidth);
  const gap = (loc) => loc.evaluate((e) => parseFloat(getComputedStyle(e).marginTop));
  const sides = (loc) => loc.evaluate((e) => { const s = getComputedStyle(e); return [s.borderLeftWidth, s.borderRightWidth]; });
  const first = page.locator('.row.parent').first();
  const finance = page.locator('.row.parent', { hasText: 'Finance' });
  for (const p of [first, finance]) {                             // every parent leaves a gap, the first one too (after the header)
    expect(await gap(p)).toBeGreaterThanOrEqual(5);
    expect(await gap(p)).toBeLessThanOrEqual(8);
  }
  expect(await width(finance)).toBe('1px');                        // no heavier rule any more
  expect(await width(page.locator('.row.task', { hasText: 'Review budget' }))).toBe('1px');
  expect(await finance.evaluate((e) => e.getBoundingClientRect().height)).toBe(36); // rows keep their height (the Timeline aligns to it)
  // The page shows through the gap: the previous row's bottom and the parent's top do not touch,
  // and nothing frames the gap: the table has no side borders of its own, each row has.
  const prev = await finance.evaluate((e) => e.previousElementSibling.getBoundingClientRect().bottom);
  const top = await finance.evaluate((e) => e.getBoundingClientRect().top);
  expect(top - prev).toBeGreaterThanOrEqual(5);
  expect(await sides(page.locator('.table'))).toEqual(['0px', '0px']);
  expect(await sides(finance)).toEqual(['1px', '1px']);
  expect(await sides(page.locator('.row.task', { hasText: 'Review budget' }))).toEqual(['1px', '1px']);
  // The group's last row closes the frame; a row in the middle does not.
  const last = page.locator('.row.task', { hasText: 'Review budget' }); // Finance's last task
  expect(await last.evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe('1px');
  expect(await last.evaluate((e) => getComputedStyle(e).borderBottomLeftRadius)).not.toBe('0px');
  expect(await finance.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).not.toBe('0px');
  expect(await page.locator('.row.task', { hasText: 'Pay insurance' }).evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe('0px');
  expect(await page.locator('.row.header').evaluate((e) => getComputedStyle(e).borderBottomLeftRadius)).not.toBe('0px'); // the header is its own block
  await page.locator('#btn-flat').click();
  expect(await sides(page.locator('.table'))).toEqual(['1px', '1px']); // Flat: one framed table
  expect(await sides(page.locator('.row.task', { hasText: 'Review budget' }))).toEqual(['0px', '0px']);
  const start = page.locator('.row.task', { hasText: 'Pay insurance' }); // first task of the second parent
  await expect(start).toHaveClass(/group-start/);
  expect(await width(start)).toBe('2px');
  expect(await gap(start)).toBe(0);
  expect(await width(page.locator('.row.task', { hasText: 'Review budget' }))).toBe('1px');
  await page.locator('#btn-nested').click();
});

test('the collapsed task count follows the filters', async ({ page, request }) => {
  await page.goto('/#/all');
  const m = await byTitle(request, 'Maintenance');
  const total = (await (await request.get('/api/items')).json()).filter((i) => i.parent_id === m.id).length;
  const maint = () => page.locator('.row.parent', { hasText: 'Maintenance' });
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' })).toBeVisible();
  await page.locator('#search-text').fill('gutters');
  await expect(page.locator('.row.task')).toHaveCount(1);
  await maint().locator('.caret').click();
  await expect(maint().locator('.task-count')).toHaveText('(1)');
  await expect(maint().locator('.task-count')).toHaveAttribute('title', `1 hidden task(s) (${total - 1} of ${total} hidden by the filters)`);
  await expect(maint().locator('.caret')).toHaveAttribute('title', 'Show 1 task(s)');
  await page.locator('#search-text').fill('');
  await expect(maint().locator('.task-count')).toHaveText(`(${total})`);
  await expect(maint().locator('.task-count')).toHaveAttribute('title', `${total} hidden task(s)`);
  await maint().locator('.caret').click();
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' })).toBeVisible();
});

test('the title bar and the header row stay put while the page scrolls, in every view and layout', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 300 }); // short, so even the Flat list scrolls past one screen
  await page.goto('/#/all');
  const edges = () => page.evaluate(() => ({
    barTop: document.querySelector('.topbar').getBoundingClientRect().top,
    bar: document.querySelector('.topbar').getBoundingClientRect().bottom,
    header: document.querySelector('.row.header').getBoundingClientRect().top,
    axis: document.querySelector('.timeline-axis')?.getBoundingClientRect().top ?? null,
    z: Number(getComputedStyle(document.querySelector('.row.header')).zIndex),
    scrollY: window.scrollY,
  }));
  for (const layout of ['nested', 'flat']) {
    await page.locator(`#btn-${layout}`).click();
    for (const view of ['table', 'timeline', 'matrix']) {
      await page.locator(`button[data-view=${view}]`).click();
      await expect(page.locator('.row[data-id]').first()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const rest = await edges();
      // The header rests in the page gap under the title bar (inside the
      // table's frame in Flat) and is pinned exactly there, so it does not
      // move at all: not by the gap at the start of a scroll, nor off the
      // screen after a long one (the title bar once did, past one screen).
      expect(rest.header - rest.bar).toBeCloseTo(layout === 'flat' ? 13 : 12, 0);
      for (const dy of [5, 300, 5000]) {
        await page.evaluate((dy) => window.scrollBy(0, dy), dy);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(rest.scrollY);
        const e = await edges();
        expect(e.barTop).toBe(0);
        expect(e.bar).toBe(rest.bar);
        expect(Math.abs(e.header - rest.header)).toBeLessThan(1);
        // The axis stays level with the header (its shift is applied on the scroll event, a frame later).
        if (view === 'timeline') await expect.poll(async () => { const m = await edges(); return Math.abs(m.axis - m.header); }).toBeLessThan(1);
        rest.scrollY = e.scrollY;
      }
      expect(rest.scrollY).toBeGreaterThan(300); // the page was scrolled further than one screen
      const e = await edges();
      expect(e.z).toBeGreaterThan(0);
      expect(e.z).toBeLessThan(20); // under menus (20), the item tooltip (50) and the colour popover (60)
    }
  }
  await page.locator('#btn-nested').click();
  await page.locator('button[data-view=table]').click();
  // The table is not a scroll container (that would pin the header to it, not the window).
  expect(await page.locator('.table').evaluate((e) => getComputedStyle(e).overflowX)).toBe('visible');
  // Rows scrolling through the gap between the title bar and the header are
  // hidden under a strip in the page colour (main::before).
  await page.evaluate(() => window.scrollTo(0, 300));
  const gapHit = await page.evaluate(() => {
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const hit = document.elementFromPoint(bar.left + 300, bar.bottom + 6);
    return hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}.${hit.className}` : null;
  });
  expect(gapHit).toBe('main#main.'); // the strip is main's own pseudo-element: nothing else is hit there
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('the carets, buttons and drag handle sit in the first and last columns', async ({ page, request }) => {
  await page.goto('/#/all');
  const kitchen = page.locator('.row.parent', { hasText: 'Kitchen remodel' });
  const task = page.locator('.row.task', { hasText: 'Order countertops' });
  // First column: the collapse caret on parents, empty on tasks; nothing inside the title cell before the text.
  await expect(kitchen.locator(':scope > *').first()).toHaveClass(/collapse-cell/);
  await expect(kitchen.locator(':scope > .collapse-cell .caret[data-collapse]')).toHaveCount(1);
  await expect(task.locator(':scope > .collapse-cell')).toBeEmpty();
  await expect(kitchen.locator('.title .caret, .title .color-swatch')).toHaveCount(0);
  await expect(kitchen.locator('.key .drag-handle')).toHaveCount(0);
  await expect(kitchen.locator('.key')).toHaveText(/^P-\d+$/);
  // Last column: [details caret] [+] [Delete] [drag handle] on a parent, [details caret] [move] [Delete] [drag handle] on a task.
  const names = (row) => row.locator(':scope > .actions > *').evaluateAll((els) => els.map((e) => e.classList.contains('toggle') ? 'toggle' : e.classList.contains('drag-handle') ? 'drag' : e.title));
  expect(await names(kitchen)).toEqual(['toggle', 'Add task', 'Delete', 'drag']);
  expect(await names(task)).toEqual(['toggle', 'Move to another Ongoing or Project', 'Delete', 'drag']);
  // Icon buttons: square, SVG inside, no text glyphs.
  for (const b of await kitchen.locator('.actions > button').all()) {
    const box = await b.boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    await expect(b.locator('svg')).toHaveCount(1);
    expect((await b.textContent()).trim()).toBe('');
  }
  await expect(kitchen.locator('.actions .toggle button')).toHaveAttribute('aria-expanded', 'false');
  await kitchen.locator('.actions .toggle button').click();
  await expect(kitchen.locator('.actions .toggle button')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.row.description[data-desc-for]')).toHaveCount(1);
  await kitchen.locator('.actions .toggle button').click();
  // Title-only (Timeline): the details caret at the end of the title cell, always visible; the buttons fade in on hover.
  await page.locator('button[data-view=timeline]').click();
  const k2 = page.locator('.table.title-only .row.parent', { hasText: 'Kitchen remodel' });
  await expect(k2.locator('.title .toggle button')).toBeVisible();
  await page.mouse.move(5, 5);
  expect(await k2.locator('.title .toggle').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  expect(await k2.locator('.title .actions').evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
  expect(await names(k2.locator('.title'))).toEqual(['Add task', 'Delete', 'drag']);
  const toggle = await k2.locator('.title .toggle').boundingBox(), acts = await k2.locator('.title .actions').boundingBox(), text = await k2.locator('.title-text').boundingBox();
  expect(toggle.x).toBeGreaterThanOrEqual(text.x + text.width);
  expect(acts.x).toBeGreaterThanOrEqual(toggle.x + toggle.width);
  // The handle at the right still reorders: drag Replace HVAC filter above Clean gutters, then undo.
  await page.locator('button[data-view=table]').click();
  const maint = await byTitle(request, 'Maintenance');
  const order = async () => (await (await request.get('/api/items')).json()).filter((i) => i.parent_id === maint.id).map((i) => i.title);
  const before = await order();
  const handle = page.locator('.row.task', { hasText: 'Replace HVAC filter' }).locator('.actions > .drag-handle:last-child');
  await expect(handle).toHaveAttribute('draggable', 'true');
  await dragRow(page, handle, page.locator('.row.task', { hasText: 'Clean gutters' }));
  await expect.poll(order).toEqual(['Replace HVAC filter', 'Clean gutters', ...before.filter((t) => !['Replace HVAC filter', 'Clean gutters'].includes(t))]);
  await page.waitForTimeout(350);
  await page.keyboard.press('Control+z');
  await expect.poll(order).toEqual(before);
});
