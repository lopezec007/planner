import { test, expect } from '@playwright/test';

// The "Columns" width choice: on a window wide enough for two or more copies
// of the table, the rows continue in further columns beside the first (one
// header per column, groups never split between columns); on a narrower
// window the table is the ordinary single one.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);
const WIDE = { width: 3400, height: 900 };

// HTML5 drag of a row handle onto a target row with a stepped pointer path
// (as in layout.spec.js: a few real moves start a drag reliably).
async function dragRow(page, handle, target, { x = 200, y = 4 } = {}) {
  const t = await target.boundingBox();
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 10, h.y + h.height / 2 + 5);
  await page.mouse.move(t.x + x, t.y + y, { steps: 5 });
  await page.mouse.up();
}

/** Left edges (rounded) of the given rows, de-duplicated and sorted. */
const lefts = (loc) => loc.evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))].sort((a, b) => a - b));

test('Columns lays the table out in side-by-side columns on a very wide window, and as one table otherwise', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(WIDE);
  await page.goto('/#/all');
  await expect(page.locator('.row.parent').first()).toBeVisible();
  // Wide is the default: one table across the window.
  await expect(page.locator('#btn-wide')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.table')).not.toHaveClass(/multicol/);
  await expect(page.locator('.row.header')).toHaveCount(1);
  const nParents = await page.locator('.row.parent').count();
  const nTasks = await page.locator('.row.task').count();

  await page.locator('#btn-multicol').click();
  await expect(page.locator('#btn-multicol')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-wide')).toHaveAttribute('aria-pressed', 'false');
  const table = page.locator('.table');
  await expect(table).toHaveClass(/multicol/);
  await expect(table).toHaveAttribute('data-table-cols', '2');
  // Every row is still there, once.
  await expect(page.locator('.row.parent')).toHaveCount(nParents);
  await expect(page.locator('.row.task')).toHaveCount(nTasks);
  // One header per column, each lined up with its column of rows.
  await expect(page.locator('.table-head > .row.header')).toHaveCount(2);
  const headX = await lefts(page.locator('.table-head > .row.header'));
  const rowX = await lefts(page.locator('.table-body .row.parent'));
  expect(headX).toHaveLength(2);
  expect(rowX).toEqual(headX);
  const widths = await page.locator('.table-head > .row.header, .table-body .row.parent').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().width)))]);
  expect(widths).toHaveLength(1); // header copies and rows are all one column wide
  expect(widths[0]).toBeGreaterThan(1500);
  // The columns do not overlap and fill the window between them.
  expect(headX[1]).toBeGreaterThanOrEqual(headX[0] + widths[0] + 8);
  expect(headX[1] + widths[0]).toBeLessThanOrEqual(WIDE.width);
  // Cells line up with their header in both columns (same grid in each).
  for (const x of rowX) {
    const cols = await page.evaluate((left) => {
      const at = (sel) => [...document.querySelectorAll(sel)].find((e) => Math.round(e.closest('.row').getBoundingClientRect().left) === left);
      const h = at('.table-head .row.header [data-sort=status]').getBoundingClientRect();
      const c = at('.table-body .row.task > div:has(> .status)').getBoundingClientRect();
      return [Math.round(h.left), Math.round(c.left)];
    }, x);
    expect(cols[0]).toBe(cols[1]);
  }
  // A parent and its tasks (and detail rows) are never split between columns,
  // and both columns start at the same height.
  const groups = await page.locator('.table-body .tgroup').evaluateAll((els) => els.map((g) => ({
    xs: [...new Set([...g.children].map((r) => Math.round(r.getBoundingClientRect().left)))],
    top: Math.round(g.querySelector('.row').getBoundingClientRect().top),
    left: Math.round(g.getBoundingClientRect().left),
    rows: g.querySelectorAll('.row[data-id]').length,
    first: g.firstElementChild.classList.contains('parent'),
  })));
  expect(groups).toHaveLength(nParents);
  for (const g of groups) { expect(g.xs).toHaveLength(1); expect(g.first).toBe(true); }
  const firstTop = (x) => Math.min(...groups.filter((g) => g.left === x).map((g) => g.top));
  expect(firstTop(rowX[0])).toBe(firstTop(rowX[1]));
  // Balanced: neither column holds everything.
  const count = (x) => groups.filter((g) => g.left === x).reduce((n, g) => n + g.rows, 0);
  expect(count(rowX[0])).toBeGreaterThan(0);
  expect(count(rowX[1])).toBeGreaterThan(0);
  expect(count(rowX[0]) + count(rowX[1])).toBe(nParents + nTasks);
  // Each group keeps its frame: the last row of every group has a bottom border.
  const open = await page.locator('.table-body .tgroup').evaluateAll((els) => els.filter((g) => parseFloat(getComputedStyle(g.lastElementChild).borderBottomWidth) < 1).length);
  expect(open).toBe(0);

  // An expanded row stays with its group.
  const gutters = page.locator('.row.task', { hasText: 'Clean gutters' });
  await gutters.locator('.toggle button').click();
  const detail = page.locator('.row.description').first();
  await expect(detail).toBeVisible();
  expect(Math.round((await detail.boundingBox()).x)).toBe(Math.round((await gutters.boundingBox()).x));
  await gutters.locator('.toggle button').click();

  // Sorting from the second column's header sorts the whole table.
  await page.locator('.table-head > .row.header').nth(1).locator('[data-sort=title]').click();
  await expect(page.locator('.table-head > .row.header').nth(0).locator('[data-sort=title]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('.table-head > .row.header').nth(1).locator('[data-sort=title]')).toHaveAttribute('aria-sort', 'ascending');
  const sorted = await page.locator('.table-body .row.parent .title-text').allTextContents();
  expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })));
  await page.locator('.table-head > .row.header').nth(0).locator('[data-sort=title]').click();
  await page.locator('.table-head > .row.header').nth(0).locator('[data-sort=title]').click();
  await expect(table).not.toHaveClass(/sorted/);

  // The choice is a preference: it survives a reload.
  await page.reload();
  await expect(page.locator('.table')).toHaveClass(/multicol/);
  await expect(page.locator('#btn-multicol')).toHaveAttribute('aria-pressed', 'true');

  // A window with room for one table only: the ordinary single table, with
  // the choice still on; widening brings the columns back without a reload.
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.locator('.table')).not.toHaveClass(/multicol/);
  await expect(page.locator('.row.header')).toHaveCount(1);
  await expect(page.locator('.table-head, .table-body, .tgroup')).toHaveCount(0);
  await expect(page.locator('#btn-multicol')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.row.parent')).toHaveCount(nParents);
  await page.setViewportSize(WIDE);
  await expect(page.locator('.table')).toHaveClass(/multicol/);
  await expect(page.locator('.table-head > .row.header')).toHaveCount(2);
  // Wider still: a third column.
  await page.setViewportSize({ width: 5200, height: 900 });
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '3');
  await expect(page.locator('.table-head > .row.header')).toHaveCount(3);
  await page.setViewportSize(WIDE);
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '2');
  // Hiding columns makes room for more of them.
  await page.locator('#btn-columns').click();
  for (const c of ['status', 'owner', 'assignee', 'start', 'end', 'effort', 'blocked']) await page.locator(`#columns-panel input[data-column=${c}]`).uncheck();
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', /^[3-6]$/);
  await page.locator('#columns-panel .columns-all').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '2');

  // The Timeline's and Matrix's title-only table is never split, and Width is off there.
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('.table.title-only')).toBeVisible();
  await expect(page.locator('.table.multicol')).toHaveCount(0);
  await expect(page.locator('#btn-multicol')).toBeDisabled();
  await page.locator('button[data-view=table]').click();
  await expect(page.locator('.table')).toHaveClass(/multicol/);

  // Narrow and Wide leave it.
  await page.locator('#btn-narrow').click();
  await expect(page.locator('.table')).not.toHaveClass(/multicol/);
  await expect(page.locator('.table-wrap')).toHaveClass(/constrained/);
  await page.locator('#btn-multicol').click();
  await expect(page.locator('.table')).toHaveClass(/multicol/);
  await expect(page.locator('.table-wrap')).not.toHaveClass(/constrained/);
  await page.locator('#btn-wide').click();
  await expect(page.locator('.table')).not.toHaveClass(/multicol/);
  await expect(page.locator('.row.header')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the number of columns can be fixed beside the Width group: Auto, or 2 to 6, squeezing the columns to fit', async ({ page }) => {
  await page.setViewportSize({ width: 5200, height: 900 });
  await page.goto('/#/all');
  await expect(page.locator('#multicol-count')).toHaveCount(0); // only while Columns is on
  await page.locator('#btn-multicol').click();
  const count = page.locator('#multicol-count');
  await expect(count).toHaveValue('auto');
  expect(await count.locator('option').allTextContents()).toEqual(['Auto', '2 columns', '3 columns', '4 columns', '5 columns', '6 columns']);
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '3'); // as many as fit comfortably
  await count.selectOption('2');
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '2');
  await expect(page.locator('.table-head > .row.header')).toHaveCount(2);
  await expect(page.locator('.table')).not.toHaveAttribute('data-table-scale', /.*/); // room enough: full-size columns
  // A preference: it survives a reload.
  await page.reload();
  await expect(page.locator('#multicol-count')).toHaveValue('2');
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '2');
  // More than fit at full size: the grid is squeezed to make room (five
  // columns of 1390px would need 7000px; here each gets ~1027px).
  const cellWidths = () => page.locator('.table-body .row.task').first().locator('> div').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const full = await cellWidths();
  await page.locator('#multicol-count').selectOption('5');
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '5');
  await expect(page.locator('.table-head > .row.header')).toHaveCount(5);
  const scale = Number(await page.locator('.table').getAttribute('data-table-scale'));
  expect(scale).toBeGreaterThan(0.6);
  expect(scale).toBeLessThan(0.8);
  const squeezed = await cellWidths();
  expect(squeezed.length).toBe(full.length);
  for (let i = 0; i < full.length; i++) if (i !== full.indexOf(Math.max(...full))) expect(squeezed[i]).toBeLessThan(full[i]); // every fixed column narrower
  // Every row still fits its column: nothing spills past the right edge.
  const spill = await page.locator('.table-body .row').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(spill).toBe(0);
  expect(await lefts(page.locator('.table-body .row.parent'))).toHaveLength(5);
  // Past the squeeze limit (60%), as many as fit: 6 columns need 834px each, more than 5200px gives.
  await page.locator('#multicol-count').selectOption('6');
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '6');
  await page.setViewportSize({ width: 4200, height: 900 });
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '4');
  await page.setViewportSize({ width: 5200, height: 900 });
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '6');
  // Narrower than two squeezed columns' worth: the single table, at full size, with the choice kept.
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.locator('.table')).not.toHaveClass(/multicol/);
  await expect(page.locator('.table')).not.toHaveAttribute('data-table-scale', /.*/);
  await expect(page.locator('#multicol-count')).toHaveValue('6');
  await page.setViewportSize({ width: 5200, height: 900 });
  await page.locator('#multicol-count').selectOption('auto');
  await expect(page.locator('.table')).toHaveAttribute('data-table-cols', '3');
  await expect(page.locator('.table')).not.toHaveAttribute('data-table-scale', /.*/);
  // Gone again with Wide; the Timeline view has no such control.
  await page.locator('#btn-wide').click();
  await expect(page.locator('#multicol-count')).toHaveCount(0);
  await page.locator('#btn-multicol').click();
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('#multicol-count')).toHaveCount(0);
});

test('the headers of a multi-column table stay pinned where they rest while the page scrolls, in Nested and Flat', async ({ page }) => {
  await page.setViewportSize({ width: 3400, height: 320 });
  await page.goto('/#/all');
  await page.locator('#btn-multicol').click();
  await expect(page.locator('.table')).toHaveClass(/multicol/);
  const edges = () => page.evaluate(() => ({
    bar: document.querySelector('.topbar').getBoundingClientRect().bottom,
    tops: [...document.querySelectorAll('.table-head > .row.header')].map((h) => h.getBoundingClientRect().top),
  }));
  for (const layout of ['nested', 'flat']) {
    await page.locator(`#btn-${layout}`).click();
    await expect(page.locator('.table')).toHaveClass(/multicol/);
    await page.evaluate(() => window.scrollTo(0, 0));
    const rest = await edges();
    expect(rest.tops).toHaveLength(2);
    // At rest in the page gap under the title bar, like the single header (inside the table's frame in Flat).
    for (const t of rest.tops) expect(t - rest.bar).toBeCloseTo(layout === 'flat' ? 13 : 12, 0);
    await page.evaluate(() => window.scrollBy(0, 200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const e = await edges();
    expect(e.bar).toBe(rest.bar);
    for (let i = 0; i < 2; i++) expect(Math.abs(e.tops[i] - rest.tops[i])).toBeLessThan(1);
  }
});

test('Flat in several columns: tasks only, the rules between rows kept, an expanded row stays with its task', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await page.goto('/#/all');
  await page.locator('#btn-flat').click();
  await page.locator('#btn-multicol').click();
  const table = page.locator('.table');
  await expect(table).toHaveClass(/flat/);
  await expect(table).toHaveClass(/multicol/);
  const n = await page.locator('.row.task').count();
  await expect(page.locator('.table-body .tgroup')).toHaveCount(n); // one unbreakable group per task
  await expect(page.locator('.row.parent')).toHaveCount(0);
  const xs = await lefts(page.locator('.table-body .row.task'));
  expect(xs.length).toBeGreaterThanOrEqual(2);
  expect(await lefts(page.locator('.table-head > .row.header'))).toEqual(xs);
  // Every task still has the rule above it; the first task of a parent the heavier one.
  const borders = await page.locator('.table-body .row.task').evaluateAll((els) => els.map((e) => [e.classList.contains('group-start'), parseFloat(getComputedStyle(e).borderTopWidth)]));
  for (const [start, w] of borders) expect(w).toBe(start ? 2 : 1);
  expect(borders.some(([start]) => start)).toBe(true);
  const row = page.locator('.row.task', { hasText: 'Clean gutters' });
  await row.locator('.toggle button').click();
  const detail = page.locator('.row.description').first();
  await expect(detail).toBeVisible();
  expect(Math.round((await detail.boundingBox()).x)).toBe(Math.round((await row.boundingBox()).x));
  expect((await detail.boundingBox()).y).toBeGreaterThan((await row.boundingBox()).y);
});

test('rows can be edited, added and dragged between columns', async ({ page, request }) => {
  await page.setViewportSize(WIDE);
  await page.goto('/#/all');
  await page.locator('#btn-multicol').click();
  await expect(page.locator('.table')).toHaveClass(/multicol/);
  const parentsOrder = () => page.locator('.table-body .row.parent .title-text').allTextContents();
  const before = await parentsOrder();
  const x = async (title) => Math.round((await page.locator('.row.parent', { hasText: title }).boundingBox()).x);
  // The last parent is in the second column, the first in the first.
  const first = before[0], last = before[before.length - 1];
  expect(await x(last)).toBeGreaterThan(await x(first));
  try {
    // Editing in place works in the second column and keeps the layout.
    const lastRow = page.locator('.row.parent', { hasText: last });
    await lastRow.locator('.title-text').click();
    await page.locator('input[name=title]').fill(`${last} (edited)`);
    await page.locator('input[name=title]').press('Enter');
    await expect(page.locator('.row.parent', { hasText: `${last} (edited)` })).toBeVisible();
    await expect(page.locator('.table')).toHaveClass(/multicol/);
    await page.locator('.row.parent', { hasText: `${last} (edited)` }).locator('.title-text').click();
    await page.locator('input[name=title]').fill(last);
    await page.locator('input[name=title]').press('Enter');
    await expect.poll(async () => (await byTitle(request, last))?.title).toBe(last);

    // A new task row appears inside its parent's group.
    await page.locator('.row.parent', { hasText: first }).locator('button[title="Add task"]').click();
    const draft = page.locator('.row[data-editing="new"]:not(.description)');
    await expect(draft).toBeVisible();
    expect(await draft.evaluate((e) => e.parentElement === document.querySelector('.table-body .tgroup'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(draft).toHaveCount(0);

    // Drag the last parent (second column) above the first one (first column).
    await dragRow(page, page.locator('.row.parent', { hasText: last }).locator('.drag-handle'), page.locator('.row.parent', { hasText: first }), { x: 300, y: 4 });
    await expect.poll(parentsOrder).toEqual([last, ...before.slice(0, -1)]);
    expect(await x(last)).toBe(await x(before[1])); // now heads the first column
    // Ctrl+Z puts it back.
    await page.locator('body').click({ position: { x: 5, y: 500 } });
    await page.keyboard.press('Control+z');
    await expect.poll(parentsOrder).toEqual(before);
  } finally {
    const it = await byTitle(request, `${last} (edited)`);
    if (it) await request.patch(`/api/items/${it.id}`, { data: { title: last } });
    const ids = [];
    const all = await (await request.get('/api/items')).json();
    for (const t of before) ids.push(all.find((i) => i.title === t && i.parent_id == null).id);
    await request.put('/api/order', { data: { ids } });
  }
});
