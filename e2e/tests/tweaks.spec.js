import { test, expect } from '@playwright/test';

// Icon toolbar with tooltips, tiny sort-position badges, hidable columns,
// the firm-date pin, attachments beside the dependencies, key-only
// dependency chips with a tooltip, and the Move dropdown closing on an
// outside click.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

test('toolbar buttons are icons with mouseover descriptions and accessible names', async ({ page }) => {
  await page.goto('/#/all');
  for (const [id, name] of [['btn-new-ongoing', 'New Ongoing'], ['btn-new-project', 'New Project'], ['btn-expand-all', 'Expand all'], ['btn-collapse-all', 'Collapse all'],
    ['btn-filters', 'Filters'], ['btn-search-clear', 'Clear'], ['btn-sort', 'Sort'], ['btn-columns', 'Columns'], ['btn-colors', 'Colours'],
    ['btn-nested', 'Nested'], ['btn-flat', 'Flat'], ['btn-wide', 'Wide'], ['btn-narrow', 'Narrow']]) {
    const b = page.locator(`#${id}`);
    await expect(b).toHaveAttribute('aria-label', name);
    expect((await b.getAttribute('title') || '').length).toBeGreaterThan(5);
    expect((await b.textContent()).trim().length).toBeLessThan(3); // no words (at most "+N")
  }
  for (const v of ['table', 'timeline', 'matrix']) {
    await expect(page.locator(`button[data-view=${v}]`).locator('svg')).toHaveCount(1);
    expect((await page.locator(`button[data-view=${v}]`).getAttribute('title')).toLowerCase()).toContain(v);
  }
  await expect(page.locator('.search-preset[data-preset=active]')).toHaveAttribute('title', /To-Do and In-Progress/);
  expect(await page.locator('.topbar').evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(60); // one line at 1500px
  await page.goto('/#/settings');
  await expect(page.locator('#btn-back')).toHaveAttribute('title', 'Back to the items');
  await expect(page.locator('#btn-back svg')).toHaveCount(1);
});

test('sort-position badges sit under the arrow, whole, and the Urg/Imp labels stay visible', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('.row.header [data-sort="urgency"]').click();
  await page.locator('.row.header [data-sort="importance"]').click();
  for (const [key, n] of [['urgency', '1'], ['importance', '2']]) {
    const h = page.locator(`.row.header [data-sort="${key}"]`);
    await expect(h.locator('.sort-index')).toHaveText(n);
    const cell = await h.boundingBox();
    const label = await h.locator('.sort-label').boundingBox();
    const glyph = await h.locator('.sort-glyph').boundingBox();
    const badge = await h.locator('.sort-index').boundingBox();
    const header = await page.locator('.row.header').boundingBox();
    expect(label.x + label.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5);   // label not clipped
    expect(badge.x + badge.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5);   // badge whole, inside the cell
    expect(badge.x).toBeGreaterThanOrEqual(cell.x - 0.5);
    expect(badge.height).toBeLessThan(11);
    expect(badge.y).toBeGreaterThanOrEqual(glyph.y + glyph.height - 1);             // right under the arrow glyph
    expect(Math.abs((badge.x + badge.width / 2) - (glyph.x + glyph.width / 2))).toBeLessThan(3); // centred on it
    expect(badge.y + badge.height).toBeLessThanOrEqual(header.y + header.height + 0.5); // within the header row
    expect(header.height).toBe(36);
  }
  const urg = page.locator('.row.header [data-sort="urgency"]');
  for (let i = 0; i < 2; i++) { await urg.click(); } // off
  await page.locator('.row.header [data-sort="importance"]').click();
  await page.locator('.row.header [data-sort="importance"]').click();
  await expect(page.locator('#sort-badge')).toHaveCount(0);
});

test('columns can be hidden and shown from the Columns menu, per user, and the detail row follows', async ({ page }) => {
  await page.goto('/#/all');
  await expect(page.locator('.row.header [data-sort="owner"]')).toBeVisible();
  const row = page.locator('.row.task', { hasText: 'Clean gutters' });
  await expect(row.locator('.chip-pick[data-name=owner]')).toBeVisible();
  await page.locator('#btn-columns').click();
  await expect(page.locator('#columns-panel')).toBeVisible();
  await page.locator('#columns-panel input[data-column=owner]').uncheck();
  await expect(page.locator('.row.header [data-sort="owner"]')).toHaveCount(0);
  await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.chip-pick[data-name=owner]')).toHaveCount(0);
  await expect(page.locator('#columns-badge')).toHaveText('1');
  await page.locator('#columns-panel input[data-column=key]').uncheck();
  await expect(page.locator('.row.header [data-sort="key"]')).toHaveCount(0);
  await expect(page.locator('.key-text')).toHaveCount(0);
  await expect(page.locator('.row.task .actions .drag-handle').first()).toBeAttached(); // the handle lives in the actions, so it stays
  // The description still sits under the title column.
  await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.toggle button').click();
  const title = await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.title').boundingBox();
  const desc = await page.locator('.row.description[data-desc-for] > .title').boundingBox();
  expect(Math.abs(title.x - desc.x)).toBeLessThan(1);
  await expect(page.locator('.table')).toHaveAttribute('data-columns', /^collapse title status assignee/);
  await page.reload();
  await expect(page.locator('.row.header [data-sort="owner"]')).toHaveCount(0); // a preference
  await page.locator('#btn-columns').click();
  await page.locator('#columns-panel .columns-all').click();
  await expect(page.locator('.row.header [data-sort="owner"]')).toBeVisible();
  await expect(page.locator('.row.header [data-sort="key"]')).toBeVisible();
  // Flat adds the Ongoing / Project columns to the menu.
  await page.locator('#btn-flat').click();
  await page.locator('#btn-columns').click();
  await page.locator('#columns-panel input[data-column=parent]').uncheck();
  await expect(page.locator('.row.header [data-sort="parent"]')).toHaveCount(0);
  await expect(page.locator('.row.task .parent-ref')).toHaveCount(0);
  await page.locator('#columns-panel input[data-column=parent]').check();
  await page.locator('#btn-nested').click();
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('#btn-columns')).toBeDisabled();
  await page.locator('button[data-view=table]').click();
});

test('the firm toggle shows ~ for approximate and a pin for firm', async ({ page, request }) => {
  const gutters = await byTitle(request, 'Clean gutters'); // end date, not firm
  try {
    await page.goto('/#/all');
    const t = page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button[name=end_firm]');
    await expect(t).toHaveText('~');
    await expect(t).toHaveAttribute('aria-pressed', 'false');
    await t.click();
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button[name=end_firm]')).toHaveText('📌');
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button[name=end_firm]')).toHaveClass(/firm/);
    await expect.poll(async () => (await byTitle(request, 'Clean gutters')).end_firm).toBe(true);
    await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button[name=end_firm]').click();
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('button[name=end_firm]')).toHaveText('~');
  } finally {
    await request.patch(`/api/items/${gutters.id}`, { data: { end_firm: gutters.end_firm } });
  }
});

test('dependency chips show the key only with the item in a tooltip; attachments sit to the right of them', async ({ page, request }) => {
  const insurance = await byTitle(request, 'Pay insurance'); // blocked by Review budget
  const budget = await byTitle(request, 'Review budget');
  await page.goto('/#/all');
  await page.locator('.row.task', { hasText: 'Pay insurance' }).locator('.toggle button').click();
  const chip = page.locator(`.row.description[data-desc-for="${insurance.id}"] .dep-chip[data-id="${budget.id}"]`);
  await expect(chip.locator('.dep-key')).toHaveText(budget.key);
  await expect(chip.locator('.dep-title')).toHaveCount(0);
  await chip.hover();
  const tip = page.locator('.item-tip');
  await expect(tip).toBeVisible();
  await expect(tip.locator('.tip-key')).toHaveText(budget.key);
  await expect(tip.locator('.tip-title')).toHaveText('Review budget');
  await expect(tip).toContainText('In-Progress');
  await page.mouse.move(5, 600);
  await expect(tip).toBeHidden();
  const deps = await page.locator(`.row.description[data-desc-for="${insurance.id}"] .deps`).boundingBox();
  const files = await page.locator(`.attachments[data-attachments="${insurance.id}"]`).boundingBox();
  const desc = await page.locator(`.row.description[data-desc-for="${insurance.id}"] > .title`).boundingBox();
  expect(files.x).toBeGreaterThan(deps.x + deps.width - 1);          // right of the dependencies
  expect(Math.abs(files.y - deps.y)).toBeLessThan(8);                 // on the same line
  expect(desc.x + desc.width).toBeLessThanOrEqual(deps.x + 1);        // not squeezing the description
});

test('the Move dropdown closes on a click elsewhere', async ({ page }) => {
  await page.goto('/#/all');
  const row = page.locator('.row.task', { hasText: 'Clean gutters' });
  await row.locator('button.reparent').click();
  await expect(row.locator('select[name=reparent]')).toBeVisible();
  await page.mouse.click(5, 600); // one click, anywhere
  await expect(row.locator('button.reparent')).toBeVisible();
  await expect(row.locator('select[name=reparent]')).toHaveCount(0);
});
