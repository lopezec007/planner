import { test, expect } from '@playwright/test';

async function openPlan(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.row.parent:not(.header)').first()).toBeVisible();
  await page.locator('.toolbar button[data-view="timeline"]').click();
  await expect(page.locator('#panel .timeline-canvas')).toBeVisible();
  return errors;
}

/** Locator for the bar belonging to the row whose title matches. */
async function barFor(page, title) {
  const id = await page.locator('.row:not(.header)', { hasText: title }).first().getAttribute('data-id');
  return page.locator(`.timeline-bar[data-id="${id}"]`);
}

test('plan view hides non-title columns and draws bars only for dated items', async ({ page }) => {
  const errors = await openPlan(page);
  await expect(page.locator('.table.title-only')).toHaveCount(1);
  await expect(page.locator('.row.header div', { hasText: 'Status' })).toHaveCount(0);

  // Project with both dates: one bar. Ongoing (no dates) and a dateless task: none.
  await expect(await barFor(page, 'Kitchen remodel')).toHaveCount(1);
  await expect(await barFor(page, 'Maintenance')).toHaveCount(0);
  await expect(await barFor(page, 'Fix fence post')).toHaveCount(0);

  // Start-only and end-only items still get a bar (with a long fade).
  await expect(await barFor(page, 'Review budget')).toHaveClass(/no-end/);
  await expect(await barFor(page, 'Clean gutters')).toHaveClass(/no-start/);

  // Today marker and axis present.
  await expect(page.locator('.timeline-today')).toHaveCount(1);
  expect(await page.locator('.timeline-tick.major').count()).toBeGreaterThan(0);
  expect(await page.locator('.timeline-tick.minor').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('bars line up vertically with their table rows, including when descriptions are expanded', async ({ page }) => {
  await openPlan(page);
  const check = async (title) => {
    const row = page.locator('.row:not(.header)', { hasText: title }).first();
    const bar = await barFor(page, title);
    const rb = await row.boundingBox();
    const bb = await bar.boundingBox();
    expect(bb.y).toBeGreaterThanOrEqual(rb.y);
    expect(bb.y + bb.height).toBeLessThanOrEqual(rb.y + rb.height + 1);
    const rowMid = rb.y + rb.height / 2, barMid = bb.y + bb.height / 2;
    expect(Math.abs(rowMid - barMid)).toBeLessThan(2);
  };
  await check('Kitchen remodel');
  await check('Build raised beds');

  // Expanding descriptions inserts rows; bars below must follow their rows.
  await page.locator('#btn-expand-all').click();
  await expect(page.locator('.row.description').first()).toBeVisible();
  await check('Kitchen remodel');
  await check('Build raised beds');

  // The axis is level with the table header row (two tiers inside it).
  const headerBottom = (await page.locator('.row.header').boundingBox());
  const axis = await page.locator('.timeline-axis').boundingBox();
  expect(Math.abs((axis.y + axis.height) - (headerBottom.y + headerBottom.height))).toBeLessThan(2);
});

test('zoom buttons change the axis scale and Today recentres', async ({ page }) => {
  await openPlan(page);
  const canvas = page.locator('.timeline-canvas');
  const ppd0 = parseFloat(await canvas.getAttribute('data-ppd'));
  const units0 = await canvas.getAttribute('data-units');
  const w0 = (await canvas.boundingBox()).width;
  expect(units0).toBe('month/week'); // default window (~4 months) uses week ticks

  for (let i = 0; i < 4; i++) await page.locator('button[data-plan="zoom-in"]').click();
  const ppd1 = parseFloat(await canvas.getAttribute('data-ppd'));
  expect(ppd1).toBeGreaterThan(ppd0 * 2);
  expect((await canvas.boundingBox()).width).toBeGreaterThan(w0 * 2);
  await expect(canvas).toHaveAttribute('data-units', 'month/day');

  for (let i = 0; i < 8; i++) await page.locator('button[data-plan="zoom-out"]').click();
  const ppd2 = parseFloat(await canvas.getAttribute('data-ppd'));
  expect(ppd2).toBeLessThan(ppd0);
  await expect(canvas).toHaveAttribute('data-units', 'year/month');

  // Ctrl+wheel zooms too.
  await page.locator('.timeline-scroll').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => parseFloat(await canvas.getAttribute('data-ppd'))).toBeGreaterThan(ppd2);

  // Drag to pan changes the scroll position.
  const scrollEl = page.locator('.timeline-scroll');
  const before = await scrollEl.evaluate((s) => s.scrollLeft);
  const box = await scrollEl.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await scrollEl.evaluate((s) => s.scrollLeft)).toBeGreaterThan(before + 100);

  // Today marker is inside the viewport after pressing Today.
  await page.locator('button[data-plan="today"]').click();
  await expect.poll(async () => {
    const scroll = await page.locator('.timeline-scroll').boundingBox();
    const today = await page.locator('.timeline-today').boundingBox();
    return today.x >= scroll.x && today.x <= scroll.x + scroll.width;
  }).toBe(true);
});

test('bars are styled by assignee, status and blocked, and show a tooltip', async ({ page }) => {
  await openPlan(page);
  const alexColor = await page.evaluate(async () => (await (await fetch('/api/users')).json()).find((u) => u.name === 'Alex').color);
  const n = parseInt(alexColor.slice(1), 16);
  const rgb = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  await expect(await barFor(page, 'Spring garden')).toHaveCSS('background-color', rgb);

  await expect(await barFor(page, 'Demo old cabinets')).toHaveClass(/closed/);
  await expect(await barFor(page, 'Pay insurance')).toHaveClass(/blocked/);

  const bar = await barFor(page, 'Kitchen remodel');
  await bar.hover();
  const tip = page.locator('.timeline-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('P-1');
  await expect(tip).toContainText('Kitchen remodel');
  await expect(tip).toContainText('(firm)');
  await expect(tip).not.toContainText('null');
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();
});

test('switching back to table view restores the full columns', async ({ page }) => {
  await openPlan(page);
  await page.locator('.toolbar button[data-view="table"]').click();
  await expect(page.locator('.table.title-only')).toHaveCount(0);
  await expect(page.locator('#panel')).toHaveCount(0);
});

test('scroll position survives re-renders and page changes (today stays in view)', async ({ page }) => {
  const todayInView = () => page.evaluate(() => {
    const s = document.querySelector('.timeline-scroll').getBoundingClientRect();
    const t = document.querySelector('.timeline-today').getBoundingClientRect();
    return t.left >= s.left && t.left <= s.right;
  });
  await page.goto('/');
  await page.locator('button[data-view=timeline]').click();
  expect(await todayInView()).toBe(true);
  // Edit and cancel a row beside the timeline (re-renders the timeline twice).
  const row = page.locator('.row.task', { hasText: 'Demo old cabinets' });
  await row.hover();
  await row.locator('button[title=Edit]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.row[data-editing]')).toHaveCount(0);
  expect(await todayInView()).toBe(true);
  // Another page's timeline opens at the same window.
  await page.goto('/#/everything');
  await page.locator('button[data-view=timeline]').click();
  await page.waitForTimeout(200);
  expect(await todayInView()).toBe(true);
  await page.locator('button[data-view=table]').click();
});
