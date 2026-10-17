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

  // Move onto a point near the top-right edge: tooltip flips to stay in view.
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
