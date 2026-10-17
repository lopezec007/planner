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

// ---- dependency connectors ----

/** Every connector with its endpoints (canvas coordinates) and the edges of
 *  the two bars it should join, keyed "blocker->blocked" by item key. */
async function connectors(page) {
  const items = await (await page.request.get('/api/items')).json();
  const keyOf = Object.fromEntries(items.map((i) => [String(i.id), i.key]));
  const raw = await page.evaluate(() => {
    const canvas = document.querySelector('.timeline-canvas');
    const c = canvas.getBoundingClientRect();
    const bar = (id) => {
      const r = canvas.querySelector(`.timeline-bar[data-id="${id}"]`).getBoundingClientRect();
      return { x0: r.left - c.left, x1: r.right - c.left, yc: r.top + r.height / 2 - c.top };
    };
    return [...canvas.querySelectorAll('.timeline-deps .timeline-dep')].map((p) => {
      const len = p.getTotalLength();
      const s = p.getPointAtLength(0), e = p.getPointAtLength(len);
      let minX = Infinity, maxX = -Infinity;
      for (let l = 0; l <= len; l += 2) {
        const q = p.getPointAtLength(l);
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
      }
      return {
        blocker: p.dataset.blocker, blocked: p.dataset.blocked,
        open: p.classList.contains('open'), stroke: getComputedStyle(p).stroke,
        marker: p.getAttribute('marker-end'),
        start: { x: s.x, y: s.y }, end: { x: e.x, y: e.y }, minX, maxX,
        a: bar(p.dataset.blocker), b: bar(p.dataset.blocked),
      };
    });
  });
  const out = {};
  for (const l of raw) out[`${keyOf[l.blocker]}->${keyOf[l.blocked]}`] = l;
  return out;
}

/** The connector starts at the end of the blocker's bar and ends at the start
 *  of the blocked bar, both at the bar's vertical centre. */
function expectJoined(l) {
  expect(Math.abs(l.start.x - l.a.x1)).toBeLessThan(1);
  expect(Math.abs(l.start.y - l.a.yc)).toBeLessThan(1);
  expect(Math.abs(l.end.x - l.b.x0)).toBeLessThan(1);
  expect(Math.abs(l.end.y - l.b.yc)).toBeLessThan(1);
}

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

test('dependency connectors join the blocker bar end to the blocked bar start', async ({ page }) => {
  const errors = await openPlan(page);
  const svg = page.locator('.timeline-canvas > svg.timeline-deps');
  await expect(svg).toHaveCount(1);
  await expect(svg).toHaveCSS('pointer-events', 'none');

  // Seeded edges whose two items both have a bar on the Active page.
  const lines = await connectors(page);
  expect(Object.keys(lines).sort()).toEqual(['P-1->P-2', 'P-5->P-2', 'T-10->T-11', 'T-7->T-6', 'T-9->T-10']);
  for (const l of Object.values(lines)) {
    expectJoined(l);
    expect(l.marker).toMatch(/^url\(["']?#tl-dep-arrow(-open)?["']?\)$/);
  }

  // Open blockers use the alert colour; a done blocker stays muted.
  const alert = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hl-alert').trim());
  const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fg-muted').trim());
  expect(lines['T-7->T-6'].open).toBe(true); // Review budget is in progress
  expect(lines['T-7->T-6'].stroke).toBe(rgb(alert));
  expect(lines['T-7->T-6'].marker).toContain('tl-dep-arrow-open');
  expect(lines['P-1->P-2'].open).toBe(true);
  expect(lines['P-5->P-2'].open).toBe(false); // Repaint shed is done
  expect(lines['P-5->P-2'].stroke).toBe(rgb(muted));
  expect(lines['P-5->P-2'].marker).not.toContain('open');

  // Electrical rough-in starts before Order countertops ends: the connector
  // is routed out past the blocker's end and back in from the left.
  const back = lines['T-9->T-10'];
  expect(back.b.x0).toBeLessThan(back.a.x1);
  expect(back.maxX).toBeGreaterThan(back.a.x1 + 5);
  expect(back.minX).toBeLessThan(back.b.x0 - 5);
  // Paint walls starts well after Electrical ends: a simple elbow in the gap.
  const fwd = lines['T-10->T-11'];
  expect(fwd.b.x0).toBeGreaterThan(fwd.a.x1);
  expect(fwd.maxX).toBeLessThanOrEqual(fwd.b.x0 + 0.5);
  expect(fwd.minX).toBeGreaterThanOrEqual(fwd.a.x1 - 0.5);

  // A project blocked by an open project reads as blocked.
  await expect(await barFor(page, 'Spring garden')).toHaveClass(/blocked/);
  expect(errors).toEqual([]);
});

test('dependency connectors move with their bars when zooming', async ({ page }) => {
  await openPlan(page);
  const canvas = page.locator('.timeline-canvas');
  const ppd0 = parseFloat(await canvas.getAttribute('data-ppd'));
  const before = (await connectors(page))['T-10->T-11'];
  expectJoined(before);
  // Electrical ends day +9 (bar edge at +10), Paint walls starts day +30: 20 days apart.
  expect(Math.abs((before.end.x - before.start.x) - 20 * ppd0)).toBeLessThan(1);

  for (let i = 0; i < 3; i++) await page.locator('button[data-plan="zoom-in"]').click();
  const ppd1 = parseFloat(await canvas.getAttribute('data-ppd'));
  expect(ppd1).toBeGreaterThan(ppd0 * 2);
  const after = (await connectors(page))['T-10->T-11'];
  expectJoined(after);
  expect(Math.abs((after.end.x - after.start.x) - 20 * ppd1)).toBeLessThan(1);
  expect(Math.abs(after.start.x - before.start.x)).toBeGreaterThan(10);
  // Rows did not move: the vertical positions are unchanged.
  expect(Math.abs(after.start.y - before.start.y)).toBeLessThan(1);
  expect(Math.abs(after.end.y - before.end.y)).toBeLessThan(1);
  // The overlay is the size of the canvas.
  const size = await page.evaluate(() => {
    const c = document.querySelector('.timeline-canvas').getBoundingClientRect();
    const s = document.querySelector('.timeline-deps').getBoundingClientRect();
    return { dw: Math.abs(c.width - s.width), dh: Math.abs(c.height - s.height) };
  });
  expect(size.dw).toBeLessThan(2);
  expect(size.dh).toBeLessThan(2);
});
