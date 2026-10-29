import { test, expect } from '@playwright/test';

async function openPlan(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/all');
  await expect(page.locator('.row[data-id].parent').first()).toBeVisible();
  await page.locator('.toolbar button[data-view="timeline"]').click();
  await expect(page.locator('#panel .timeline-canvas')).toBeVisible();
  return errors;
}

/** Locator for the bar belonging to the row whose title matches. Only rows
 *  with a data-id are item rows; detail rows may quote other items' titles. */
async function barFor(page, title) {
  const id = await page.locator('.row[data-id]', { hasText: title }).first().getAttribute('data-id');
  return page.locator(`.timeline-bar[data-id="${id}"]`);
}

test('plan view hides non-title columns and draws bars only for dated items', async ({ page }) => {
  const errors = await openPlan(page);
  await expect(page.locator('.table.title-only')).toHaveCount(1);
  await expect(page.locator('.row.header div', { hasText: 'Status' })).toHaveCount(0);

  // Project with both dates: one bar. A project whose tasks have no dates
  // either, and a dateless task: none. (An Ongoing with dated tasks gets a
  // derived bar, see below.)
  await expect(await barFor(page, 'Kitchen remodel')).toHaveCount(1);
  await expect(await barFor(page, 'Solar panels')).toHaveCount(0);
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
    const row = page.locator('.row[data-id]', { hasText: title }).first();
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
  await page.goto('/#/all');
  await page.locator('button[data-view=timeline]').click();
  expect(await todayInView()).toBe(true);
  // Edit and cancel a title beside the timeline (re-renders the timeline twice).
  const row = page.locator('.row[data-id].task', { hasText: 'Demo old cabinets' });
  await row.locator('.title-text').click();
  await page.keyboard.press('Escape');
  await expect(row.locator('input[name=title]')).toHaveCount(0);
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

// ---- wheel ----

test('a plain wheel scrolls the page, not the timeline; Shift+wheel pans it; Ctrl+wheel zooms', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 500 }); // the list is taller than this: the page can scroll
  await openPlan(page);
  const scrollEl = page.locator('.timeline-scroll');
  const canvas = page.locator('.timeline-canvas');
  const left0 = await scrollEl.evaluate((s) => s.scrollLeft);
  const ppd0 = parseFloat(await canvas.getAttribute('data-ppd'));
  await scrollEl.hover();

  // Plain wheel: the timeline's scrollLeft is untouched and the page moved.
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(150);
  expect(await scrollEl.evaluate((s) => s.scrollLeft)).toBe(left0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  expect(parseFloat(await canvas.getAttribute('data-ppd'))).toBe(ppd0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await scrollEl.hover(); // may scroll the page a little to bring the canvas into view
  const y0 = await page.evaluate(() => window.scrollY);

  // Shift+wheel pans sideways (whichever axis the browser reports it on)
  // and leaves the page where it is.
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Shift');
  await expect.poll(() => scrollEl.evaluate((s) => s.scrollLeft)).toBeGreaterThan(left0 + 100);
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);
  const left1 = await scrollEl.evaluate((s) => s.scrollLeft);
  // Alt+wheel pans too (back).
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Alt');
  await expect.poll(() => scrollEl.evaluate((s) => s.scrollLeft)).toBeLessThan(left1 - 100);

  // The zoom buttons' titles say which keys do what.
  await expect(page.locator('button[data-plan="zoom-in"]')).toHaveAttribute('title', /Ctrl\+wheel/);
  await expect(page.locator('button[data-plan="zoom-in"]')).toHaveAttribute('title', /Shift\+wheel/);
});

// ---- derived parent bars ----

const ymd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('an Ongoing gets an inert bar spanning its tasks; the band shows the tooltip', async ({ page }) => {
  await openPlan(page);
  const ppd = parseFloat(await page.locator('.timeline-canvas').getAttribute('data-ppd'));
  const todayX = (await page.locator('.timeline-today').boundingBox()).x;
  // Maintenance's tasks: Replace HVAC filter ends today, Clean gutters ends
  // +3, none has a start: the bar runs from today (the earliest end) to +3.
  const bar = await barFor(page, 'Maintenance');
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveClass(/derived-start/);
  await expect(bar).toHaveClass(/derived-end/);
  await expect(bar).not.toHaveClass(/no-start|no-end|firm-start|firm-end/);
  const bb = await bar.boundingBox();
  expect(Math.abs(bb.x - todayX)).toBeLessThan(1.5);
  expect(Math.abs(bb.width - 4 * ppd)).toBeLessThan(1.5);
  // Styled apart: a hatched fill over the colour and no × buttons; the
  // wrapper lets the pointer through to the band.
  expect(await bar.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('repeating-linear-gradient');
  const id = await bar.getAttribute('data-id');
  await expect(page.locator(`.timeline-x[data-id="${id}"]`)).toHaveCount(0);
  await expect(bar.locator('xpath=..')).toHaveCSS('pointer-events', 'none');

  // Hovering the band (over the bar) shows the tooltip with the derived dates.
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const tip = page.locator('.timeline-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Maintenance');
  await expect(tip).toContainText(`Start: ${ymd(0)} (from its tasks)`);
  await expect(tip).toContainText(`End: ${ymd(3)} (from its tasks)`);
  await expect(tip).toContainText('no dates of its own');
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();
});

test('a project with only a start gets its end from its tasks; clicking that edge pins a real end date', async ({ page, request }) => {
  const project = await (await request.post('/api/items', {
    data: { type: 'project', title: 'Derived end probe', status: 'todo', start_date: ymd(5) },
  })).json();
  try {
    await request.post('/api/items', { data: { type: 'task', parent_id: project.id, title: 'Probe task A', status: 'todo', start_date: ymd(8), end_date: ymd(12) } });
    await request.post('/api/items', { data: { type: 'task', parent_id: project.id, title: 'Probe task B', status: 'todo', end_date: ymd(20) } });
    await openPlan(page);
    const ppd = parseFloat(await page.locator('.timeline-canvas').getAttribute('data-ppd'));
    const todayX = (await page.locator('.timeline-today').boundingBox()).x;
    const bar = page.locator(`.timeline-bar[data-id="${project.id}"]`);
    await expect(bar).toHaveClass(/derived-end/);
    await expect(bar).not.toHaveClass(/derived-start|no-end|no-start/);
    await bar.scrollIntoViewIfNeeded(); // the new project is the last row
    const bb = await bar.boundingBox();
    expect(Math.abs(bb.x - (todayX + 5 * ppd))).toBeLessThan(1.5);           // its own start
    expect(Math.abs(bb.x + bb.width - (todayX + 21 * ppd))).toBeLessThan(1.5); // the latest task end (+20, inclusive)
    // Only the start has a × button.
    await bar.hover();
    await expect(page.locator(`.timeline-x.start[data-id="${project.id}"]`)).toBeVisible();
    await expect(page.locator(`.timeline-x.end[data-id="${project.id}"]`)).toHaveCount(0);
    const tip = page.locator('.timeline-tooltip');
    await expect(tip).toContainText(`Start: ${ymd(5)}  ·  End: ${ymd(20)} (from its tasks)`);

    // The derived edge is a "pin a date" zone, not a resize: a click there
    // sets a real end date on the project.
    await page.mouse.move(bb.x + bb.width - 4, bb.y + bb.height / 2, { steps: 3 });
    await expect(tip).toContainText('set the end date');
    await page.mouse.click(bb.x + bb.width - 4, bb.y + bb.height / 2);
    await expect.poll(async () => (await (await request.get(`/api/items/${project.id}`)).json()).end_date).toBe(ymd(20));
    await expect(bar).not.toHaveClass(/derived/);
    await expect(page.locator(`.timeline-x.end[data-id="${project.id}"]`)).toHaveCount(1);
  } finally {
    await request.delete(`/api/items/${project.id}`);
  }
});

test('the tooltip names a task\'s Ongoing/Project above its title', async ({ page }) => {
  await openPlan(page);
  const bar = await barFor(page, 'Build raised beds');
  await bar.hover();
  const tip = page.locator('.timeline-tooltip');
  await expect(tip).toBeVisible();
  const parent = tip.locator('.timeline-tip-parent');
  await expect(parent).toHaveText(/P-2\s+Spring garden/);
  // The parent line comes first, in the muted smaller style.
  expect(await tip.evaluate((t) => t.firstElementChild.className)).toBe('timeline-tip-parent');
  const sizes = await tip.evaluate((t) => [parseFloat(getComputedStyle(t.querySelector('.timeline-tip-parent')).fontSize), parseFloat(getComputedStyle(t.querySelector('.timeline-tip-title')).fontSize)]);
  expect(sizes[0]).toBeLessThan(sizes[1]);
  // Parents have no such line.
  await (await barFor(page, 'Spring garden')).hover();
  await expect(tip).toContainText('Spring garden');
  await expect(tip.locator('.timeline-tip-parent')).toHaveCount(0);
});

test('in Nested the chart has no frame of its own; the axis and each parent group are outlined to match the table', async ({ page }) => {
  await openPlan(page);
  const border = (loc) => loc.evaluate((e) => getComputedStyle(e).borderLeftWidth);
  expect(await border(page.locator('.timeline-scroll'))).toBe('0px');
  const parents = page.locator('.row[data-id].parent');
  await expect(page.locator('.timeline-frame.group')).toHaveCount(await parents.count());
  await expect(page.locator('.timeline-frame.axis')).toHaveCount(1);
  // The Finance frame spans from its row's top to its last task's bottom, at the panel's edges.
  const finance = page.locator('.row[data-id].parent', { hasText: 'Finance' });
  const i = await parents.evaluateAll((els, t) => els.findIndex((e) => e.textContent.includes(t)), 'Finance');
  const f = await page.locator('.timeline-frame.group').nth(i).evaluate((e) => e.getBoundingClientRect());
  const top = await finance.evaluate((e) => e.getBoundingClientRect().top);
  const bottom = await page.locator('.row[data-id]', { hasText: 'Review budget' }).evaluate((e) => e.getBoundingClientRect().bottom);
  const panel = await page.locator('#panel').evaluate((e) => e.getBoundingClientRect());
  expect(Math.abs(f.top - top)).toBeLessThanOrEqual(1);
  expect(Math.abs(f.bottom - bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(f.left - panel.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(f.right - panel.right)).toBeLessThanOrEqual(1);
  expect(await border(page.locator('.timeline-frame.group').nth(i))).toBe('1px');
  // The axis frame matches the table header; a frame follows an expanded row.
  const a = await page.locator('.timeline-frame.axis').evaluate((e) => e.getBoundingClientRect());
  const h = await page.locator('.row.header').evaluate((e) => e.getBoundingClientRect());
  expect(Math.abs(a.bottom - h.bottom)).toBeLessThanOrEqual(1);
  await page.locator('.row[data-id]', { hasText: 'Review budget' }).locator('.toggle button').click();
  const bottom2 = await page.locator('.row.description[data-desc-for]').last().evaluate((e) => e.getBoundingClientRect().bottom);
  const f2 = await page.locator('.timeline-frame.group').nth(i).evaluate((e) => e.getBoundingClientRect());
  expect(Math.abs(f2.bottom - bottom2)).toBeLessThanOrEqual(1);
  // Flat: one framed chart, no group frames; only the axis band keeps a
  // frame of its own (rounded at the top like the chart's, no halo), so it
  // still looks framed once pinned while the chart scrolls under it.
  await page.locator('#btn-flat').click();
  await expect(page.locator('.timeline-frame')).toHaveCount(1);
  await expect(page.locator('.timeline-frame.axis.flat')).toHaveCount(1);
  expect(await page.locator('.timeline-frame.axis').evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).not.toBe('0px');
  expect(await page.locator('.timeline-frame.axis').evaluate((e) => getComputedStyle(e).borderBottomLeftRadius)).toBe('0px');
  expect(await page.locator('.timeline-frame.axis').evaluate((e) => getComputedStyle(e).boxShadow)).toBe('none');
  expect(await border(page.locator('.timeline-scroll'))).toBe('1px');
  await page.locator('#btn-nested').click();
});

test('the tooltip shows a task\'s effort when it has one, and importance -1 as such', async ({ page, request }) => {
  const items = await (await request.get('/api/items')).json();
  const counter = items.find((i) => i.title === 'Order countertops'); // dated task, importance 9
  expect((await request.patch(`/api/items/${counter.id}`, { data: { effort: 120, importance: -1 } })).ok()).toBe(true);
  try {
    await openPlan(page);
    const tip = page.locator('.timeline-tooltip');
    await (await barFor(page, 'Order countertops')).hover();
    await expect(tip).toBeVisible();
    await expect(tip.locator('.timeline-tip-effort')).toHaveText('Effort: 2h');
    // A task without an effort has no such line.
    await (await barFor(page, 'Clean gutters')).hover();
    await expect(tip).toContainText('Clean gutters');
    await expect(tip.locator('.timeline-tip-effort')).toHaveCount(0);
    // In the combo colour mode the levels are named; -1 is shown, not clamped.
    await page.locator('.timeline-controls select.timeline-color').selectOption('combo');
    await expect(page.locator('.timeline-legend.combo')).toBeVisible();
    await (await barFor(page, 'Order countertops')).hover();
    await expect(tip).toContainText('Importance: -1');
    await expect(tip.locator('.timeline-tip-effort')).toHaveText('Effort: 2h');
  } finally {
    await page.locator('.timeline-controls select.timeline-color').selectOption('assignee').catch(() => {});
    await request.patch(`/api/items/${counter.id}`, { data: { effort: null, importance: counter.importance } });
  }
});
