import { test, expect } from '@playwright/test';

// Ongoing and Project keys are chips in their type colour (with a type
// glyph), whatever tint the row has, so the two kinds of parent are told
// apart even when both rows carry colours of their own; task keys stay
// plain text.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const rowVar = (loc) => loc.evaluate((e) => e.style.getPropertyValue('--row-color'));
const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);

/** The chip is one of the two type colours, carries the matching glyph and the key, and fits inside its cell. */
async function expectChip(chip, { type, color, key }) {
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute('data-type', type);
  await expect(chip).toHaveCSS('background-color', rgb(color));
  await expect(chip.locator(`svg.icon-${type}`)).toHaveCount(1);
  await expect(chip.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(chip).toHaveText(key);
  await expect(chip).toHaveAttribute('title', `${type === 'ongoing' ? 'Ongoing' : 'Project'} ${key}`);
  expect(await chip.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono/i);
  const cell = await chip.evaluateHandle((e) => e.parentElement);
  const cb = await cell.boundingBox(), kb = await chip.boundingBox();
  expect(kb.x).toBeGreaterThanOrEqual(cb.x);
  expect(kb.x + kb.width).toBeLessThanOrEqual(cb.x + cb.width + 0.5);
  expect(kb.height).toBeLessThan(cb.height);
}

test('Ongoing and Project keys are type-coloured chips with a glyph, in Nested, Flat, the title-only table and the tooltips; task keys are plain', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json();
  const kitchen = await byTitle(request, 'Kitchen remodel');
  const maint = await byTitle(request, 'Maintenance');
  const project = { type: 'project', color: settings.color_project, key: kitchen.key };
  const ongoing = { type: 'ongoing', color: settings.color_ongoing, key: maint.key };
  try {
    await page.goto('/#/all');
    const kRow = () => page.locator('.row.parent', { hasText: 'Kitchen remodel' });
    const mRow = () => page.locator('.row.parent', { hasText: 'Maintenance' });
    const tRow = () => page.locator('.row.task', { hasText: 'Order countertops' });
    await expectChip(kRow().locator('.key .type-chip'), project);
    await expectChip(mRow().locator('.key .type-chip'), ongoing);
    // The text contrasts with the chip (white on the default teal and indigo).
    await expect(kRow().locator('.key .type-chip')).toHaveCSS('color', 'rgb(255, 255, 255)');
    // Tests keep selecting the key text.
    await expect(kRow().locator('.key-text')).toHaveText(kitchen.key);
    // Task keys: plain text, no chip, no glyph.
    await expect(page.locator('.row.task .type-chip')).toHaveCount(0);
    await expect(tRow().locator('.key svg')).toHaveCount(0);
    await expect(tRow().locator('.key-text')).toHaveText(/^T-\d+$/);
    // A closed parent's chip dims with its row.
    const shed = page.locator('.row.parent', { hasText: 'Repaint shed' });
    await expect(shed).toHaveClass(/closed/);
    expect(parseFloat(await shed.locator('.type-chip').evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(1);
    expect(parseFloat(await kRow().locator('.type-chip').evaluate((e) => getComputedStyle(e).opacity))).toBe(1);

    // The chip keeps the type colour when the parent has a colour of its own
    // (the row is tinted with it) and when the Colours menu asks for the type colour on rows.
    await request.patch(`/api/items/${kitchen.id}`, { data: { color: '#e15759' } });
    await page.reload();
    await expect(kRow()).toBeVisible();
    expect(await rowVar(kRow())).toBe('#e15759');
    await expectChip(kRow().locator('.key .type-chip'), project);
    await page.locator('#btn-colors').click();
    await page.locator('#colors-panel input[name=parent-colors][value=type]').check();
    expect(await rowVar(kRow())).toBe(settings.color_project);
    await expectChip(kRow().locator('.key .type-chip'), project);
    await page.locator('#colors-panel input[name=parent-colors][value=custom]').check();
    await page.locator('#colors-panel input[name=task-colors][value=parent]').check();
    expect(await rowVar(tRow())).toBe('#e15759');
    await expect(page.locator('.row.task .type-chip')).toHaveCount(0); // still no chip on task keys
    await page.locator('#colors-panel input[name=task-colors][value=type]').check();
    await page.keyboard.press('Escape');

    // Flat: the parent key column carries the chip; the task's own key stays plain.
    await page.locator('#btn-flat').click();
    await expect(page.locator('.table')).toHaveClass(/flat/);
    await expectChip(tRow().locator('.key.parent-ref .type-chip'), project);
    await expectChip(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.key.parent-ref .type-chip'), ongoing);
    await expect(tRow().locator('.key:not(.parent-ref) .type-chip')).toHaveCount(0);
    await expect(tRow().locator('.key-text')).toHaveText(/^T-\d+$/);
    await expect(page.locator('.row.task .parent-ref .key-text')).toHaveCount(0); // the key column's text class stays its own

    // The title-only table beside the Timeline, in Flat and in Nested.
    await page.locator('button[data-view=timeline]').click();
    await expect(page.locator('.table.flat.title-only')).toBeVisible();
    await expectChip(page.locator('.table.title-only .row.task', { hasText: 'Order countertops' }).locator('.key.parent-ref .type-chip'), project);
    await page.locator('#btn-nested').click();
    await expect(page.locator('.table.title-only:not(.flat)')).toBeVisible();
    await expectChip(page.locator('.table.title-only .row.parent', { hasText: 'Kitchen remodel' }).locator('.key .type-chip'), project);
    await expectChip(page.locator('.table.title-only .row.parent', { hasText: 'Maintenance' }).locator('.key .type-chip'), ongoing);
    await expect(page.locator('.table.title-only .row.task .type-chip')).toHaveCount(0);
    // The Timeline tooltip's parent line carries the chip too.
    const countertops = await byTitle(request, 'Order countertops');
    await page.locator(`.timeline-bar[data-id="${countertops.id}"]`).hover();
    const ttip = page.locator('.timeline-tooltip');
    await expect(ttip).toBeVisible();
    await expect(ttip.locator('.timeline-tip-parent')).toHaveText(new RegExp(`${kitchen.key}\\s+Kitchen remodel`));
    await expect(ttip.locator('.timeline-tip-parent .type-chip[data-type=project] svg.icon-project')).toHaveCount(1);
    await expect(ttip.locator('.timeline-tip-parent .type-chip')).toHaveCSS('background-color', rgb(settings.color_project));
    await page.mouse.move(5, 5);
    // ...and the Matrix point tooltip's.
    await page.locator('button[data-view=matrix]').click();
    await expect(page.locator('.matrix-plot')).toBeVisible();
    await page.locator(`.matrix-plot .pt[data-key="${countertops.key}"]`).hover();
    const tip = page.locator('.item-tip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.tip-parent')).toHaveText(new RegExp(`${kitchen.key}\\s+Kitchen remodel`));
    await expect(tip.locator('.tip-parent .type-chip[data-type=project] svg.icon-project')).toHaveCount(1);
    await expect(tip.locator('.tip-parent .type-chip')).toHaveCSS('background-color', rgb(settings.color_project));
    await page.mouse.move(5, 5);
    await page.locator('button[data-view=table]').click();

    // Settings without a Project colour: a neutral outline chip, still with the glyph.
    await request.patch('/api/settings', { data: { color_project: '' } });
    await page.reload();
    await expect(kRow()).toBeVisible();
    const plain = kRow().locator('.key .type-chip');
    await expect(plain).toHaveClass(/plain/);
    expect(await bg(plain)).toBe('rgba(0, 0, 0, 0)');
    await expect(plain.locator('svg.icon-project')).toHaveCount(1);
    await expect(plain).toHaveText(kitchen.key);
    await expectChip(mRow().locator('.key .type-chip'), ongoing); // the Ongoing colour is untouched
  } finally {
    await request.patch(`/api/items/${kitchen.id}`, { data: { color: kitchen.color || '' } });
    await request.patch('/api/settings', { data: { color_project: settings.color_project } });
  }
});
