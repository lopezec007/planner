import { test, expect } from '@playwright/test';

// Urgency and importance values can be described in Settings; the text shows
// on mouseover of the value in the table (Nested and Flat) and of the axis
// numbers and names in the Matrix.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);
const settings = async (request) => (await request.get('/api/settings')).json();

test.describe.configure({ mode: 'serial' });
let before;
test.beforeAll(async ({ request }) => { before = await settings(request); });
test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { urgency_descriptions: before.urgency_descriptions, importance_descriptions: before.importance_descriptions } });
});

test('the defaults describe importance -1 only, and the API validates the descriptions', async ({ request }) => {
  expect(before.urgency_descriptions).toBe('{}');
  expect(JSON.parse(before.importance_descriptions)).toEqual({ '-1': 'Not important at all' });
  for (const bad of [{ urgency_descriptions: '{"-1":"x"}' }, { importance_descriptions: '{"11":"x"}' }, { urgency_descriptions: '["x"]' }, { urgency_descriptions: `{"3":"${'x'.repeat(201)}"}` }]) {
    expect((await request.patch('/api/settings', { data: bad })).status()).toBe(400);
  }
  // Stored trimmed, and a blank one is dropped.
  const res = await (await request.patch('/api/settings', { data: { urgency_descriptions: '{"2":"  Some day  ","3":" "}' } })).json();
  expect(res.urgency_descriptions).toBe('{"2":"Some day"}');
  await request.patch('/api/settings', { data: { urgency_descriptions: '{}' } });
});

test('Settings has a text box per value; a description saves when the box is left and clears when emptied', async ({ page, request }) => {
  await page.goto('/#/settings');
  const urg = page.locator('[data-descriptions=urgency]');
  const imp = page.locator('[data-descriptions=importance]');
  await expect(urg.locator('input')).toHaveCount(11); // 0..10
  await expect(imp.locator('input')).toHaveCount(12); // -1..10
  // Importance comes first, as in the table.
  expect(await page.locator('.level-descriptions h3').allTextContents()).toEqual(['Importance', 'Urgency']);
  await expect(imp.locator('input[data-level="-1"]')).toHaveValue('Not important at all');
  await expect(urg.locator('input[data-level="7"]')).toHaveValue('');
  await expect(urg.locator('input[data-level="7"]')).toHaveAttribute('placeholder', 'No description');
  // The value beside each box is drawn in its ramp colour (7 is a warn value by default).
  await expect(urg.locator('.level-description', { has: page.locator('input[data-level="7"]') }).locator('.ramp-sample')).toHaveClass(/hl-level/);
  await expect(urg.locator('.level-description', { has: page.locator('input[data-level="2"]') }).locator('.ramp-sample')).toHaveClass(/unset/);

  await urg.locator('input[data-level="7"]').fill('  Needs doing this week ');
  await urg.locator('input[data-level="7"]').press('Enter');
  await expect.poll(async () => JSON.parse((await settings(request)).urgency_descriptions)).toEqual({ 7: 'Needs doing this week' });
  await expect(urg.locator('input[data-level="7"]')).toHaveValue('Needs doing this week');
  await urg.locator('input[data-level="10"]').fill('Drop everything');
  await imp.locator('input[data-level="4"]').click(); // leaving the box saves it
  await expect.poll(async () => JSON.parse((await settings(request)).urgency_descriptions)).toEqual({ 7: 'Needs doing this week', 10: 'Drop everything' });
  await imp.locator('input[data-level="4"]').fill('Nice to have');
  await imp.locator('input[data-level="4"]').press('Enter');
  await expect.poll(async () => JSON.parse((await settings(request)).importance_descriptions)).toEqual({ '-1': 'Not important at all', 4: 'Nice to have' });
  // Escape puts the stored text back without saving.
  await urg.locator('input[data-level="10"]').fill('typo');
  await urg.locator('input[data-level="10"]').press('Escape');
  await expect(urg.locator('input[data-level="10"]')).toHaveValue('Drop everything');
  // Survives a reload; emptying a box removes the description.
  await page.reload();
  await expect(page.locator('[data-descriptions=urgency] input[data-level="7"]')).toHaveValue('Needs doing this week');
  await page.locator('[data-descriptions=urgency] input[data-level="10"]').fill('');
  await page.locator('[data-descriptions=urgency] input[data-level="10"]').press('Enter');
  await expect.poll(async () => JSON.parse((await settings(request)).urgency_descriptions)).toEqual({ 7: 'Needs doing this week' });
});

test('the table shows a value\'s description on mouseover, in Nested and Flat', async ({ page, request }) => {
  const gutters = await byTitle(request, 'Clean gutters'); // urgency 7, importance 4
  expect([gutters.urgency, gutters.importance]).toEqual([7, 4]);
  await page.goto('/#/all');
  const row = () => page.locator(`.row.task[data-id="${gutters.id}"]`);
  await expect(row().locator('input[name=urgency]')).toHaveAttribute('title', 'Urgency 7: Needs doing this week');
  await expect(row().locator('input[name=importance]')).toHaveAttribute('title', 'Importance 4: Nice to have');
  // The cell around the box carries it too, so the padding answers as well.
  await expect(row().locator('.num[data-level-field=urgency]')).toHaveAttribute('title', 'Urgency 7: Needs doing this week');
  // A value without a description has no tooltip.
  const hvac = await byTitle(request, 'Replace HVAC filter'); // urgency 9
  await expect(page.locator(`.row.task[data-id="${hvac.id}"] input[name=urgency]`)).not.toHaveAttribute('title', /.*/);
  // The tooltip follows the value.
  try {
    await row().locator('input[name=urgency]').press('3');
    await expect.poll(async () => (await byTitle(request, 'Clean gutters')).urgency).toBe(3);
    await expect(row().locator('input[name=urgency]')).not.toHaveAttribute('title', /.*/);
    await row().locator('input[name=urgency]').press('7');
    await expect(row().locator('input[name=urgency]')).toHaveAttribute('title', 'Urgency 7: Needs doing this week');
  } finally {
    await request.patch(`/api/items/${gutters.id}`, { data: { urgency: 7 } });
  }
  await page.locator('#btn-flat').click();
  await expect(page.locator('.table')).toHaveClass(/flat/);
  await expect(row().locator('input[name=importance]')).toHaveAttribute('title', 'Importance 4: Nice to have');
});

test('the Matrix axis numbers and names carry the descriptions', async ({ page, request }) => {
  await page.goto('/#/all');
  await page.locator('.toolbar button[data-view="matrix"]').click();
  await expect(page.locator('.matrix-plot')).toBeVisible();
  const tick = (axis, v) => page.locator(`.matrix-plot .tick[data-axis=${axis}][data-value="${v}"]`);
  await expect(page.locator('.matrix-plot .tick[data-axis=urgency]')).toHaveCount(11);
  await expect(page.locator('.matrix-plot .tick[data-axis=importance]')).toHaveCount(12);
  await expect(tick('urgency', 7).locator('title')).toHaveText('Urgency 7: Needs doing this week');
  await expect(tick('urgency', 7)).toHaveClass(/described/);
  await expect(tick('importance', -1).locator('title')).toHaveText('Importance -1: Not important at all');
  await expect(tick('importance', 4).locator('title')).toHaveText('Importance 4: Nice to have');
  // An undescribed number has no tooltip and is not emphasised.
  await expect(tick('urgency', 6).locator('title')).toHaveCount(0);
  await expect(tick('urgency', 6)).not.toHaveClass(/described/);
  // The number still reads as before, and has a hit box big enough to hover.
  await expect(tick('urgency', 7).locator('text')).toHaveText('7');
  const hit = await tick('urgency', 7).locator('.tick-hit').boundingBox();
  expect(hit.width).toBeGreaterThanOrEqual(18);
  expect(hit.height).toBeGreaterThanOrEqual(16);
  const num = await tick('urgency', 7).locator('text').boundingBox();
  expect(hit.x).toBeLessThanOrEqual(num.x + 0.5);
  expect(hit.x + hit.width).toBeGreaterThanOrEqual(num.x + num.width - 0.5);
  expect(hit.y).toBeLessThanOrEqual(num.y + 0.5);
  expect(hit.y + hit.height).toBeGreaterThanOrEqual(num.y + num.height - 0.5);
  // The pointer over a described number really is over the element with the tooltip.
  const over = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.tick')?.dataset.value, [hit.x + hit.width / 2, hit.y + hit.height / 2]);
  expect(over).toBe('7');
  // The axis names list every described value, highest first.
  await expect(page.locator('.matrix-plot .axis-label[data-axis=importance] title')).toHaveText('Importance\n4: Nice to have\n-1: Not important at all');
  await expect(page.locator('.matrix-plot .axis-label[data-axis=urgency] title')).toHaveText('Urgency\n7: Needs doing this week');
  expect(await page.locator('.matrix-plot .axis-label[data-axis=urgency]').evaluate((e) => e.childNodes[e.childNodes.length - 1].textContent)).toBe('Urgency');
  // With nothing described the name says where to do it.
  await request.patch('/api/settings', { data: { urgency_descriptions: '{}' } });
  await expect(page.locator('.matrix-plot .axis-label[data-axis=urgency] title')).toHaveText(/under Settings/); // arrives live
  await expect(page.locator('.matrix-plot .tick.described[data-axis=urgency]')).toHaveCount(0);
});
