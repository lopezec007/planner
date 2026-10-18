import { test, expect } from '@playwright/test';

// Colour-coding of timeline bars: a per-user preference picked with the
// #timeline-color select (assignee, owner, importance, urgency or the
// importance × urgency blend), with a legend for the non-person modes.

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const channels = (s) => s.match(/\d+/g).slice(0, 3).map(Number);

async function openTimeline(page) {
  await page.goto('/#/all');
  await expect(page.locator('.row[data-id].parent').first()).toBeVisible();
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('#panel .timeline-canvas')).toBeVisible();
}

/** Locator for the bar of the item row whose title matches. */
async function barFor(page, title) {
  const id = await page.locator('.row[data-id]', { hasText: title }).first().getAttribute('data-id');
  return page.locator(`.timeline-bar[data-id="${id}"]`);
}

const bg = async (page, title) => (await barFor(page, title)).evaluate((b) => getComputedStyle(b).backgroundColor);

async function pick(page, mode) {
  await page.locator('#timeline-color').selectOption(mode);
  // The page re-renders: wait for the fresh select to carry the choice.
  await expect(page.locator('#timeline-color')).toHaveValue(mode);
}

test('timeline bars can be coloured by assignee, owner, urgency, importance or the combo, and the choice persists', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const users = await (await request.get('/api/users')).json();
  const color = (name) => users.find((u) => u.name === name).color;
  const settings = await (await request.get('/api/settings')).json();
  const neutral = settings.color_unassigned; // #9aa3ad by default
  expect(neutral).toBe('#9aa3ad');

  await openTimeline(page);
  const sel = page.locator('#timeline-color');
  await expect(sel).toHaveValue('assignee');
  await expect(sel).toHaveAttribute('aria-label', 'Colour bars by');
  expect(await sel.locator('option').allTextContents()).toEqual(['Assignee', 'Owner', 'Importance', 'Urgency', 'Importance × Urgency', 'Ongoing / Project']);
  await expect(page.locator('.timeline-legend')).toHaveCount(0);

  // Default: by assignee. Order countertops is assigned to Sam.
  await expect(await barFor(page, 'Order countertops')).toHaveCSS('background-color', rgb(color('Sam')));
  // The tooltip names both people when present.
  await (await barFor(page, 'Kitchen remodel')).hover();
  const tip = page.locator('.timeline-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Assignee: Evan');
  await expect(tip).toContainText('Owner: Evan');
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();

  // By owner: Clean gutters is owned by Evan; Order countertops has no owner.
  await pick(page, 'owner');
  await expect.poll(() => bg(page, 'Clean gutters')).toBe(rgb(color('Evan')));
  await expect.poll(() => bg(page, 'Order countertops')).toBe(rgb(neutral));
  await expect(page.locator('.timeline-legend')).toHaveCount(0);

  // By urgency: 10 is the alert colour on the default ramp; 5 is blank, so neutral.
  await pick(page, 'urgency');
  await expect.poll(() => bg(page, 'Pay insurance')).toBe(rgb('#e5484d'));
  await expect.poll(() => bg(page, 'Buy seeds')).toBe(rgb(neutral));
  await expect.poll(() => bg(page, 'Clean gutters')).toBe(rgb('#f5a524')); // urgency 7: warn colour
  await expect.poll(() => bg(page, 'Kitchen remodel')).toBe(rgb(neutral)); // parents have no level
  const legend = page.locator('.timeline-legend');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.timeline-legend-item')).toHaveCount(11);
  await expect(legend.locator('.timeline-legend-item').first()).toHaveText('0');
  await expect(legend.locator('.timeline-legend-item').last()).toHaveText('10');
  await expect(legend.locator('.timeline-legend-item[data-value="10"] .timeline-legend-swatch')).toHaveCSS('background-color', rgb('#e5484d'));
  await expect(legend).toHaveCSS('pointer-events', 'none');

  // By importance: Review budget is 8 (warn), Pay insurance 9 (alert).
  await pick(page, 'importance');
  await expect.poll(() => bg(page, 'Pay insurance')).toBe(rgb('#e5484d'));
  await expect.poll(() => bg(page, 'Review budget')).toBe(rgb('#f5a524'));

  // Combo: four corners in the legend; (10, 9) is near the red corner and a
  // low/low task (Paint walls, 3/4) stays close to grey.
  await pick(page, 'combo');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.timeline-legend-item')).toHaveCount(4);
  expect(await legend.locator('.timeline-legend-item').allTextContents()).toEqual(['Neither', 'Urgent', 'Important', 'Urgent & important']);
  await expect.poll(async () => {
    const [r, g, b] = channels(await bg(page, 'Pay insurance'));
    return r > b && r > g && r > 200 && b < 100;
  }).toBe(true);
  await expect.poll(async () => {
    const c = channels(await bg(page, 'Paint walls'));
    return Math.max(...c) - Math.min(...c);
  }).toBeLessThan(40);
  await expect.poll(() => bg(page, 'Kitchen remodel')).toBe(rgb('#9aa3ad')); // parents: the neutral corner

  // The bar geometry is untouched by the colouring: bars still sit on their rows.
  const row = page.locator('.row[data-id]', { hasText: 'Pay insurance' }).first();
  const rb = await row.boundingBox();
  const bb = await (await barFor(page, 'Pay insurance')).boundingBox();
  expect(Math.abs((rb.y + rb.height / 2) - (bb.y + bb.height / 2))).toBeLessThan(2);

  // The preference survives a reload (the view does too).
  await page.reload();
  await expect(page.locator('#panel .timeline-canvas')).toBeVisible();
  await expect(page.locator('#timeline-color')).toHaveValue('combo');
  await expect(page.locator('.timeline-legend .timeline-legend-item')).toHaveCount(4);

  // Changing the select does not start a pan: the scroll position is unchanged.
  const before = await page.locator('.timeline-scroll').evaluate((s) => s.scrollLeft);
  await pick(page, 'assignee');
  await expect.poll(() => bg(page, 'Order countertops')).toBe(rgb(color('Sam')));
  expect(Math.abs((await page.locator(".timeline-scroll").evaluate((s) => s.scrollLeft)) - before)).toBeLessThan(2);
  await expect(page.locator('.timeline-legend')).toHaveCount(0);
  expect(errors).toEqual([]);
});
