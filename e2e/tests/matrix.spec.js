import { test, expect } from '@playwright/test';

async function openMatrix(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('.row.parent:not(.header)').first()).toBeVisible();
  await page.locator('.toolbar button[data-view="matrix"]').click();
  await expect(page.locator('.matrix-plot')).toBeVisible();
}

test('matrix view plots one point per visible task and no parents', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openMatrix(page);

  // Split layout: title-only table on the left, plot on the right.
  await expect(page.locator('.split .table.title-only')).toBeVisible();

  const points = page.locator('.matrix-plot .pt');
  const taskRows = page.locator('.row.task:not(.header)');
  const taskCount = await taskRows.count();
  expect(taskCount).toBeGreaterThan(5);
  await expect(points).toHaveCount(taskCount);

  // Every point corresponds to a task row, and no parent row is plotted.
  const pointIds = await points.evaluateAll((els) => els.map((e) => e.dataset.id).sort());
  const rowIds = await taskRows.evaluateAll((els) => els.map((e) => e.dataset.id).sort());
  expect(pointIds).toEqual(rowIds);
  const parentIds = await page.locator('.row.parent:not(.header)').evaluateAll((els) => els.map((e) => e.dataset.id));
  for (const id of parentIds) expect(pointIds).not.toContain(id);

  // Axes and ticks.
  const svgText = await page.locator('.matrix-plot').textContent();
  expect(svgText).toContain('Urgency');
  expect(svgText).toContain('Importance');
  const ticks = await page.locator('.matrix-plot .ticks text').allTextContents();
  for (let v = 0; v <= 10; v++) expect(ticks).toContain(String(v));

  expect(errors).toEqual([]);
});

// Helpers for reading the plot's pixel geometry.
async function dotsByKey(page) {
  const dots = await page.locator('.matrix-plot .pt').evaluateAll((els) => els.map((g) => {
    const d = g.querySelector('.dot');
    return { key: g.dataset.key, cx: +d.getAttribute('cx'), cy: +d.getAttribute('cy') };
  }));
  return Object.fromEntries(dots.map((d) => [d.key, d]));
}
async function plotGeometry(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.matrix-plot');
    const panel = document.querySelector('.split .panel');
    const box = svg.getBoundingClientRect();
    const rect = (sel) => {
      const r = svg.querySelector(sel);
      return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') };
    };
    const ticks = [...svg.querySelectorAll('.ticks text')]
      .filter((t) => t.getAttribute('text-anchor') === 'middle') // x-axis ticks
      .map((t) => ({ v: +t.textContent, x: +t.getAttribute('x') }));
    const label = svg.querySelector('.quad-label');
    const diag = svg.querySelector('.diagonal');
    return {
      svg: { x: box.x, y: box.y, width: box.width, height: box.height, attrW: +svg.getAttribute('width'), attrH: +svg.getAttribute('height') },
      panel: { width: panel.clientWidth, top: panel.getBoundingClientRect().top },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bg: rect('.plot-bg'), hot: rect('.quad-hot'), cold: rect('.quad-cold'),
      xTicks: Object.fromEntries(ticks.map((t) => [t.v, t.x])),
      label: { x: +label.getAttribute('x'), y: +label.getAttribute('y'), anchor: label.getAttribute('text-anchor') },
      diag: { x1: +diag.getAttribute('x1'), y1: +diag.getAttribute('y1'), x2: +diag.getAttribute('x2'), y2: +diag.getAttribute('y2') },
    };
  });
}

test('x axis is reversed: urgency 10 at the left, 0 at the right; hot quadrant top-left', async ({ page }) => {
  // Seed data has no urgency-0 task; add one for this test and remove it after.
  const items = await (await page.request.get('/api/items')).json();
  const parent = items.find((i) => i.title === 'Maintenance');
  const created = await (await page.request.post('/api/items', {
    data: { type: 'task', parent_id: parent.id, title: 'Zero urgency probe', status: 'todo', urgency: 0, importance: 10 },
  })).json();
  try {
    await openMatrix(page);
    const byKey = await dotsByKey(page);
    const u10 = byKey['T-6'], u0 = byKey[created.key];
    expect(u10).toBeTruthy();
    expect(u0).toBeTruthy();
    expect(u10.cx).toBeLessThan(u0.cx);
    // Monotonic: higher urgency is always further left.
    expect(byKey['T-6'].cx).toBeLessThan(byKey['T-2'].cx); // 10 < 9
    expect(byKey['T-2'].cx).toBeLessThan(byKey['T-9'].cx); // 9 < 8
    expect(byKey['T-9'].cx).toBeLessThan(byKey['T-1'].cx); // 8 < 7
    expect(byKey['T-1'].cx).toBeLessThan(byKey['T-7'].cx); // 7 < 4
    // Importance is unchanged: higher importance is higher up (smaller cy).
    expect(u0.cy).toBeLessThan(byKey['T-1'].cy); // importance 10 above 4
    expect(byKey['T-9'].cy).toBeLessThan(byKey['T-1'].cy); // 9 above 4

    const g = await plotGeometry(page);
    // Tick labels run 10..0 left to right.
    for (let v = 1; v <= 10; v++) expect(g.xTicks[v]).toBeLessThan(g.xTicks[v - 1]);
    // Hot wash occupies the top-left quarter of the frame, cold the bottom-right.
    expect(g.hot.x).toBeCloseTo(g.bg.x, 3);
    expect(g.hot.y).toBeCloseTo(g.bg.y, 3);
    expect(g.hot.w).toBeCloseTo(g.bg.w / 2, 3);
    expect(g.hot.h).toBeCloseTo(g.bg.h / 2, 3);
    expect(g.cold.x).toBeCloseTo(g.bg.x + g.bg.w / 2, 3);
    expect(g.cold.y).toBeCloseTo(g.bg.y + g.bg.h / 2, 3);
    expect(g.cold.w).toBeCloseTo(g.bg.w / 2, 3);
    expect(g.cold.h).toBeCloseTo(g.bg.h / 2, 3);
    // The urgency-10/importance-10 point sits inside the hot wash.
    expect(u10.cx).toBeGreaterThan(g.hot.x);
    expect(u10.cx).toBeLessThan(g.hot.x + g.hot.w);
    expect(u10.cy).toBeGreaterThan(g.hot.y);
    expect(u10.cy).toBeLessThan(g.hot.y + g.hot.h);
    // Quadrant label is anchored at the top-left; diagonal runs top-left to bottom-right.
    expect(g.label.anchor).toBe('start');
    expect(g.label.x).toBeLessThan(g.bg.x + g.bg.w / 4);
    expect(g.label.y).toBeLessThan(g.bg.y + g.bg.h / 4);
    expect(g.diag.x1).toBeCloseTo(g.bg.x, 3);
    expect(g.diag.y1).toBeCloseTo(g.bg.y, 3);
    expect(g.diag.x2).toBeCloseTo(g.bg.x + g.bg.w, 3);
    expect(g.diag.y2).toBeCloseTo(g.bg.y + g.bg.h, 3);
    // The label of the leftmost point is drawn to its right, so it stays inside the frame.
    const lblX = await page.locator('.matrix-plot .pt[data-key="T-6"] .label').evaluate((t) => +t.getAttribute('x'));
    expect(lblX).toBeGreaterThan(u10.cx);
  } finally {
    await page.request.delete(`/api/items/${created.id}`);
  }
});

test('plot fills the panel width and the remaining viewport height, and follows resizes', async ({ page }) => {
  await openMatrix(page);
  const check = async () => {
    const g = await plotGeometry(page);
    // Width: the SVG spans the panel. Height: its bottom edge sits ~16px above the viewport bottom.
    expect(g.svg.attrW).toBe(g.panel.width);
    expect(Math.abs(g.svg.width - g.panel.width)).toBeLessThanOrEqual(1);
    expect(g.svg.attrH).toBe(Math.round(g.viewport.height - g.panel.top - 16));
    expect(Math.abs(g.svg.y + g.svg.height - (g.viewport.height - 16))).toBeLessThanOrEqual(1);
    // Non-square plot area: each axis uses its own extent, with margins for the labels.
    expect(g.bg.w).toBeGreaterThan(g.bg.h);
    expect(g.bg.w).toBeGreaterThan(g.svg.attrW - 80);
    expect(g.bg.h).toBeGreaterThan(g.svg.attrH - 70);
    return g;
  };
  const small = await check(); // 1500x900 (playwright default for this suite)

  // Larger viewport: both width and height follow.
  await page.setViewportSize({ width: 2200, height: 1300 });
  await expect.poll(async () => (await plotGeometry(page)).svg.attrH).toBeGreaterThan(small.svg.attrH + 300);
  const large = await check();
  expect(large.svg.attrW).toBeGreaterThan(small.svg.attrW + 300);

  // Height-only change: the panel's width is unchanged, so only the window
  // resize listener can trigger this redraw.
  await page.setViewportSize({ width: 2200, height: 1000 });
  await expect.poll(async () => (await plotGeometry(page)).svg.attrH).toBeLessThan(large.svg.attrH - 200);
  const shorter = await check();
  expect(shorter.svg.attrW).toBe(large.svg.attrW);

  // Points move with the plot but stay ordered.
  const byKey = await dotsByKey(page);
  expect(byKey['T-6'].cx).toBeLessThan(byKey['T-7'].cx);
  expect(byKey['T-9'].cy).toBeLessThan(byKey['T-1'].cy);
});

test('points with identical values are jittered apart', async ({ page }) => {
  await openMatrix(page);
  // Seed data has three visible tasks at urgency 5 / importance 5
  // (Fix fence post, Buy seeds, Buy paint).
  const dots = await page.locator('.matrix-plot .pt').evaluateAll((els) => els.map((g) => {
    const d = g.querySelector('.dot');
    return { key: g.dataset.key, cx: +d.getAttribute('cx'), cy: +d.getAttribute('cy') };
  }));
  const byKey = Object.fromEntries(dots.map((d) => [d.key, d]));
  const cluster = [byKey['T-4'], byKey['T-13'], byKey['T-17']];
  for (const d of cluster) expect(d).toBeTruthy();
  const seen = new Set();
  for (const d of cluster) {
    const k = `${d.cx.toFixed(2)},${d.cy.toFixed(2)}`;
    expect(seen.has(k)).toBe(false);
    seen.add(k);
  }
  // Each pair is separated by at least a point diameter (10px).
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      const dx = cluster[i].cx - cluster[j].cx, dy = cluster[i].cy - cluster[j].cy;
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(10);
    }
  }
  // ...but all stay close to the shared grid point: no further than half a cell.
  const cell = Math.abs(byKey['T-1'].cx - byKey['T-2'].cx) / 2; // urgency 7 vs 9
  const mx = cluster.reduce((s, d) => s + d.cx, 0) / cluster.length;
  const my = cluster.reduce((s, d) => s + d.cy, 0) / cluster.length;
  for (const d of cluster) expect(Math.hypot(d.cx - mx, d.cy - my)).toBeLessThan(cell / 2);

  // Points with distinct values are not jittered: same importance -> same cy.
  expect(byKey['T-7'].cy).toBeCloseTo(byKey['T-8'].cy, 5); // importance 8 and 8
  expect(byKey['T-1'].cx).not.toBeCloseTo(byKey['T-2'].cx, 5);

  // Jitter is deterministic across re-renders.
  await page.locator('.toolbar button[data-view="table"]').click();
  await page.locator('.toolbar button[data-view="matrix"]').click();
  const again = await page.locator('.matrix-plot .pt').evaluateAll((els) => els.map((g) => {
    const d = g.querySelector('.dot');
    return { key: g.dataset.key, cx: +d.getAttribute('cx'), cy: +d.getAttribute('cy') };
  }));
  expect(again).toEqual(dots);
});

test('hovering a point shows a tooltip and highlights the table row', async ({ page }) => {
  await openMatrix(page);
  const tip = page.locator('.matrix-tip');
  await expect(tip).toBeHidden();

  const pt = page.locator('.matrix-plot .pt[data-key="T-9"]');
  await pt.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Order countertops');
  // Description is rendered markdown, not raw text.
  await expect(tip.locator('.tip-desc em')).toHaveText('white with grey veining');
  await expect(tip).toContainText('8');
  await expect(tip).toContainText('9');

  // Tooltip is inside the viewport.
  const box = await tip.boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

  // The matching table row is highlighted while hovering.
  const row = page.locator('.row.task[data-id]', { hasText: 'Order countertops' });
  await expect(row).toHaveClass(/matrix-hover/);

  // Move onto the point in the top-left corner (urgency 10): tooltip stays in view.
  await page.locator('.matrix-plot .pt[data-key="T-6"]').hover();
  await expect(tip).toContainText('Pay insurance');
  await expect(tip).toContainText('Blocked');
  const box2 = await tip.boundingBox();
  expect(box2.x + box2.width).toBeLessThanOrEqual(vp.width);
  await expect(row).not.toHaveClass(/matrix-hover/);

  // Leaving the plot hides the tooltip (after its short grace period).
  await page.mouse.move(5, 500);
  await expect(tip).toBeHidden();

  // Hovering a table row highlights its point in return.
  await row.hover();
  await expect(pt).toHaveClass(/hover/);
});

test('closed and blocked tasks are visually distinguished; assignee colour applied', async ({ page }) => {
  await openMatrix(page);
  await expect(page.locator('.matrix-plot .pt[data-key="T-8"]')).toHaveClass(/closed/); // done
  await expect(page.locator('.matrix-plot .pt[data-key="T-12"]')).toHaveClass(/closed/); // cancelled
  const blocked = page.locator('.matrix-plot .pt[data-key="T-6"]');
  await expect(blocked).toHaveClass(/blocked/);
  await expect(blocked.locator('.ring')).toHaveCount(1);
  // T-9 is assigned to Sam: its colour comes from the user, not the neutral default.
  const sam = await page.evaluate(async () => (await (await fetch('/api/users')).json()).find((u) => u.name === 'Sam').color);
  const fill = await page.locator('.matrix-plot .pt[data-key="T-9"] .dot').evaluate((e) => getComputedStyle(e).fill);
  const n = parseInt(sam.slice(1), 16);
  expect(fill).toBe(`rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`);
  // Each point carries its key label.
  await expect(page.locator('.matrix-plot .pt[data-key="T-9"] .label')).toHaveText('T-9');
});

test('matrix view on backlog and ideas pages shows only those tasks', async ({ page }) => {
  await openMatrix(page, '/#/backlog');
  const n = await page.locator('.row.task:not(.header)').count();
  await expect(page.locator('.matrix-plot .pt')).toHaveCount(n);
  await expect(page.locator('.matrix-plot .pt[data-key="T-3"]')).toHaveCount(1); // Service lawnmower (backlog)
  await expect(page.locator('.matrix-plot .pt[data-key="T-9"]')).toHaveCount(0);
});

// ---- dependency lines ----

const POINT_R = 5;

/** Dependency lines keyed "blocker->blocked", each with its endpoints, the
 *  two dot centres and styling. */
async function depLines(page) {
  const raw = await page.locator('.matrix-plot .deps .dep').evaluateAll((els) => els.map((l) => {
    const svg = l.ownerSVGElement;
    const centre = (id) => {
      const d = svg.querySelector(`.pt[data-id="${id}"] .dot`);
      return { x: +d.getAttribute('cx'), y: +d.getAttribute('cy') };
    };
    const key = (id) => svg.querySelector(`.pt[data-id="${id}"]`).dataset.key;
    return {
      edge: `${key(l.dataset.blocker)}->${key(l.dataset.blocked)}`,
      x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2'),
      a: centre(l.dataset.blocker), b: centre(l.dataset.blocked),
      open: l.classList.contains('open'), lit: l.classList.contains('lit'),
      stroke: getComputedStyle(l).stroke, opacity: +getComputedStyle(l).opacity,
      marker: l.getAttribute('marker-end'),
    };
  }));
  return Object.fromEntries(raw.map((l) => [l.edge, l]));
}

/** The line runs along the centre-to-centre direction, starting POINT_R from
 *  the blocker's centre and ending POINT_R short of the blocked centre. */
function expectOnDotEdges(l) {
  expect(Math.hypot(l.x1 - l.a.x, l.y1 - l.a.y)).toBeCloseTo(POINT_R, 3);
  expect(Math.hypot(l.x2 - l.b.x, l.y2 - l.b.y)).toBeCloseTo(POINT_R, 3);
  const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, len = Math.hypot(dx, dy);
  // Start point lies on the segment a->b (cross product ~0, positive projection).
  expect(Math.abs((l.x1 - l.a.x) * dy - (l.y1 - l.a.y) * dx) / len).toBeLessThan(0.01);
  expect((l.x1 - l.a.x) * dx + (l.y1 - l.a.y) * dy).toBeGreaterThan(0);
  expect(Math.abs((l.x2 - l.a.x) * dy - (l.y2 - l.a.y) * dx) / len).toBeLessThan(0.01);
  expect(Math.hypot(l.x2 - l.x1, l.y2 - l.y1)).toBeCloseTo(len - 2 * POINT_R, 3);
}

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

test('dependency lines run between the dots of blocking tasks, beneath the points', async ({ page }) => {
  // The seed has no edge from a closed task: add one (done Demo old cabinets
  // -> Buy seeds) for the muted styling and remove it afterwards.
  const items = await (await page.request.get('/api/items')).json();
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  const extra = { blocker_id: byKey['T-8'].id, blocked_id: byKey['T-13'].id };
  expect((await page.request.post('/api/dependencies', { data: extra })).ok()).toBe(true);
  try {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openMatrix(page);

    // Task-task edges among the plotted points; project edges are not drawn.
    const lines = await depLines(page);
    expect(Object.keys(lines).sort()).toEqual(['T-10->T-11', 'T-7->T-6', 'T-8->T-13', 'T-9->T-10']);
    for (const l of Object.values(lines)) {
      expectOnDotEdges(l);
      expect(l.marker).toMatch(/^url\(["']?#mx-dep-arrow(-open)?["']?\)$/);
      expect(l.lit).toBe(false);
    }
    // The lines group sits before the points group so the dots paint on top.
    expect(await page.evaluate(() => {
      const deps = document.querySelector('.matrix-plot .deps'), pts = document.querySelector('.matrix-plot .points');
      return Boolean(deps.compareDocumentPosition(pts) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);

    // Open blocker: alert colour; done blocker: muted and fainter.
    const alert = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hl-alert').trim());
    const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fg-muted').trim());
    expect(lines['T-7->T-6'].open).toBe(true); // Review budget is in progress
    expect(lines['T-7->T-6'].stroke).toBe(rgb(alert));
    expect(lines['T-7->T-6'].marker).toContain('mx-dep-arrow-open');
    expect(lines['T-8->T-13'].open).toBe(false);
    expect(lines['T-8->T-13'].stroke).toBe(rgb(muted));
    expect(lines['T-8->T-13'].marker).not.toContain('open');
    expect(lines['T-8->T-13'].opacity).toBeLessThan(lines['T-7->T-6'].opacity);
    expect(lines['T-7->T-6'].opacity).toBeLessThan(0.7);

    // A task blocked only through an open dependency gets the blocked ring.
    const paint = page.locator('.matrix-plot .pt[data-key="T-11"]');
    await expect(paint).toHaveClass(/blocked/);
    await expect(paint.locator('.ring')).toHaveCount(1);
    // ...but not one whose only blocker is done.
    const seeds = page.locator('.matrix-plot .pt[data-key="T-13"]');
    await expect(seeds).not.toHaveClass(/blocked/);
    await expect(seeds.locator('.ring')).toHaveCount(0);

    // Hovering a point lights the lines attached to it and names its blockers.
    await page.locator('.matrix-plot .pt[data-key="T-10"]').hover();
    await expect(page.locator('.matrix-tip')).toContainText('Blocked by T-9');
    await expect.poll(async () => {
      const l = await depLines(page);
      return [l['T-9->T-10'].lit, l['T-10->T-11'].lit, l['T-7->T-6'].lit];
    }).toEqual([true, true, false]);
    await expect.poll(async () => (await depLines(page))['T-9->T-10'].opacity).toBeGreaterThan(lines['T-9->T-10'].opacity + 0.3);
    await page.mouse.move(5, 500);
    await expect.poll(async () => (await depLines(page))['T-9->T-10'].lit).toBe(false);

    // Lines follow the points across a resize.
    await page.setViewportSize({ width: 2000, height: 1100 });
    await expect.poll(async () => (await depLines(page))['T-10->T-11'].x1).not.toBeCloseTo(lines['T-10->T-11'].x1, 0);
    for (const l of Object.values(await depLines(page))) expectOnDotEdges(l);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`/api/dependencies/${extra.blocker_id}/${extra.blocked_id}`);
  }
});
