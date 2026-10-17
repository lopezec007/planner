import { test, expect } from '@playwright/test';

// Direct manipulation in the side views: dragging timeline bars to change
// dates, dragging matrix points to change urgency/importance, dependency-
// pinned fades, and wheel scrolling. Each test restores what it changes.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);
const ymd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const barFor = (page, id) => page.locator(`.timeline-bar[data-id="${id}"]`);

test('a missing start fades in from the latest blocker end; a missing end fades out to the earliest blocked start', async ({ page, request }) => {
  const garden = await byTitle(request, 'Spring garden');   // blocked by Kitchen remodel (ends +45) and Repaint shed (ended -3)
  const kitchen = await byTitle(request, 'Kitchen remodel');
  const countertops = await byTitle(request, 'Order countertops'); // blocks Electrical rough-in (starts +2)
  const elec = await byTitle(request, 'Electrical rough-in');
  try {
    await request.patch(`/api/items/${garden.id}`, { data: { start_date: null } });
    await request.patch(`/api/items/${countertops.id}`, { data: { end_date: null, start_date: ymd(-10) } });
    await page.goto('/#/all');
    await page.locator('button[data-view=timeline]').click();
    const g = await barFor(page, garden.id).boundingBox();
    const k = await barFor(page, kitchen.id).boundingBox();
    expect(Math.abs(g.x - (k.x + k.width))).toBeLessThan(1.5); // starts exactly where the latest blocker ends
    await expect(barFor(page, garden.id)).toHaveClass(/no-start/);
    const c = await barFor(page, countertops.id).boundingBox();
    const e = await barFor(page, elec.id).boundingBox();
    expect(Math.abs((c.x + c.width) - e.x)).toBeLessThan(1.5);   // ends exactly where the earliest blocked item starts
    await expect(barFor(page, countertops.id)).toHaveClass(/no-end/);
  } finally {
    await request.patch(`/api/items/${garden.id}`, { data: { start_date: garden.start_date } });
    await request.patch(`/api/items/${countertops.id}`, { data: { end_date: countertops.end_date, start_date: countertops.start_date } });
  }
});

test('dragging a timeline bar moves its dates; dragging an edge resizes', async ({ page, request }) => {
  const elec = await byTitle(request, 'Electrical rough-in'); // start +2, end +9
  try {
    await page.goto('/#/all');
    await page.locator('button[data-view=timeline]').click();
    const ppd = parseFloat(await page.locator('.timeline-canvas').getAttribute('data-ppd'));
    // Move the whole bar three days later.
    let bb = await barFor(page, elec.id).boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 3 * ppd, bb.y + bb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await byTitle(request, 'Electrical rough-in')).start_date).toBe(addDays(elec.start_date, 3));
    expect((await byTitle(request, 'Electrical rough-in')).end_date).toBe(addDays(elec.end_date, 3));
    // Wait for the re-render (the bar has moved right) before the next drag.
    const movedX = bb.x + 3 * ppd;
    await expect.poll(async () => (await barFor(page, elec.id).boundingBox()).x).toBeGreaterThan(movedX - 2);
    await page.waitForTimeout(300); // let the re-rendered timeline settle (pointer capture, tooltip)
    // Drag the right edge two days earlier: only the end changes.
    bb = await barFor(page, elec.id).boundingBox();
    await page.mouse.move(bb.x + bb.width - 3, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width - 3 - 2 * ppd, bb.y + bb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await byTitle(request, 'Electrical rough-in')).end_date).toBe(addDays(elec.end_date, 1));
    expect((await byTitle(request, 'Electrical rough-in')).start_date).toBe(addDays(elec.start_date, 3));
    // The timeline has no visible scrollbar and the wheel scrolls it sideways.
    const before = await page.locator('.timeline-scroll').evaluate((s) => s.scrollLeft);
    await page.mouse.move(bb.x, bb.y - 40);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.locator('.timeline-scroll').evaluate((s) => s.scrollLeft)).toBeGreaterThan(before + 100);
    expect(await page.locator('.timeline-scroll').evaluate((s) => getComputedStyle(s).scrollbarWidth)).toBe('none');
  } finally {
    await request.patch(`/api/items/${elec.id}`, { data: { start_date: elec.start_date, end_date: elec.end_date } });
  }
});

test('dragging a matrix point changes urgency and importance', async ({ page, request }) => {
  const gutters = await byTitle(request, 'Clean gutters'); // urgency 7, importance 4
  try {
    await page.goto('/#/all');
    await page.locator('button[data-view=matrix]').click();
    const bg = await page.locator('.matrix-plot .plot-bg').boundingBox();
    const cellX = bg.width / 11, cellY = bg.height / 11;
    const dot = page.locator(`.matrix-plot .pt[data-id="${gutters.id}"] .dot`);
    const d = await dot.boundingBox();
    const cx = d.x + d.width / 2, cy = d.y + d.height / 2;
    // Two cells left (urgency up, since 10 is on the left) and three cells up (importance up).
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 2 * cellX, cy - 3 * cellY, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => { const it = await byTitle(request, 'Clean gutters'); return [it.urgency, it.importance]; }).toEqual([9, 7]);
    // A click without movement does not change anything.
    const d2 = await page.locator(`.matrix-plot .pt[data-id="${gutters.id}"] .dot`).boundingBox();
    await page.mouse.click(d2.x + d2.width / 2, d2.y + d2.height / 2);
    await page.waitForTimeout(200);
    const it = await byTitle(request, 'Clean gutters');
    expect([it.urgency, it.importance]).toEqual([9, 7]);
  } finally {
    await request.patch(`/api/items/${gutters.id}`, { data: { urgency: gutters.urgency, importance: gutters.importance } });
  }
});

test('dates can be created on the timeline (empty rows and faded ends) and removed with the × buttons', async ({ page, request }) => {
  const fence = await byTitle(request, 'Fix fence post');   // done, no dates
  const budget = await byTitle(request, 'Review budget');   // start only
  try {
    await page.goto('/#/all');
    await page.locator('button[data-view=timeline]').click();
    const ppd = parseFloat(await page.locator('.timeline-canvas').getAttribute('data-ppd'));
    const todayX = async () => (await page.locator('.timeline-today').boundingBox()).x;
    const band = page.locator(`.timeline-row[data-id="${fence.id}"]`);
    await expect(band).toHaveClass(/empty-dates/);
    // Click on the empty row at day +5: start date set there.
    let bb = await band.boundingBox();
    await page.mouse.click((await todayX()) + 5.5 * ppd, bb.y + bb.height / 2);
    await expect.poll(async () => (await byTitle(request, 'Fix fence post')).start_date).toBe(ymd(5));
    expect((await byTitle(request, 'Fix fence post')).end_date).toBeNull();
    await expect(barFor(page, fence.id)).toBeVisible();
    await page.waitForTimeout(300);
    // Remove it with the × at the bar's start.
    await barFor(page, fence.id).hover();
    await page.locator(`.timeline-x.start[data-id="${fence.id}"]`).click();
    await expect.poll(async () => (await byTitle(request, 'Fix fence post')).start_date).toBeNull();
    await expect(page.locator(`.timeline-row[data-id="${fence.id}"]`)).toHaveClass(/empty-dates/);
    await page.waitForTimeout(300);
    // Drag on the empty row from day +2 to day +6: start and end set.
    bb = await page.locator(`.timeline-row[data-id="${fence.id}"]`).boundingBox();
    const tx = await todayX();
    await page.mouse.move(tx + 2.5 * ppd, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tx + 6.5 * ppd, bb.y + bb.height / 2, { steps: 5 });
    await expect(page.locator('.timeline-ghost')).toBeVisible();
    await page.mouse.up();
    await expect.poll(async () => { const it = await byTitle(request, 'Fix fence post'); return [it.start_date, it.end_date]; }).toEqual([ymd(2), ymd(6)]);
    await expect(barFor(page, fence.id)).toBeVisible();
    await page.waitForTimeout(300); // let the re-rendered timeline settle

    // Review budget has no end: drag in its faded tail to pin an end at day +12.
    const bar = barFor(page, budget.id);
    await expect(bar).toHaveClass(/no-end/);
    const rb = await bar.boundingBox();
    await page.mouse.move(rb.x + rb.width - 6, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move((await todayX()) + 12.5 * ppd, rb.y + rb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await byTitle(request, 'Review budget')).end_date).toBe(ymd(12));
    // And remove it again with the × at the end.
    await barFor(page, budget.id).hover();
    await page.locator(`.timeline-x.end[data-id="${budget.id}"]`).click();
    await expect.poll(async () => (await byTitle(request, 'Review budget')).end_date).toBeNull();
  } finally {
    await request.patch(`/api/items/${fence.id}`, { data: { start_date: fence.start_date, end_date: fence.end_date } });
    await request.patch(`/api/items/${budget.id}`, { data: { start_date: budget.start_date, end_date: budget.end_date } });
  }
});

test('month boundaries paint above week boundaries', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('button[data-view=timeline]').click();
  const z = async (sel) => Number(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).zIndex));
  expect(await z('.timeline-tick.month')).toBeGreaterThan(await z('.timeline-tick.week'));
});
