import { test, expect } from '@playwright/test';

// The scratch pad: a panel at the left with a Shared pane and the account's
// own pane, toggled from the title bar. Its state is a preference; the text
// is saved as you type and shared live between browsers.

const userByName = async (request, name) => (await (await request.get('/api/users')).json()).find((u) => u.name === name);
const textOf = async (request, path) => (await (await request.get(path)).json()).text;
const SCRATCH_PREFS = { scratch_open: '0', scratch_width: '320', scratch_split: '50', scratch_wrap: '1' };

test.afterEach(async ({ request }) => {
  await request.put('/api/scratch', { data: { text: '' } });
  for (const u of await (await request.get('/api/users')).json()) {
    await request.put(`/api/users/${u.id}/scratch`, { data: { text: '' } });
    await request.patch(`/api/users/${u.id}/prefs`, { data: SCRATCH_PREFS });
  }
});

test('the toggle opens the panel, which stays open across a reload', async ({ page }) => {
  await page.goto('/#/all');
  const btn = page.locator('#btn-scratch');
  const panel = page.locator('#scratch');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toBeHidden();
  await btn.click();
  await expect(panel).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.scratch-name').first()).toHaveText('Shared');
  await expect(panel.locator('#scratch-global')).toBeVisible();
  // No account picked: the lower pane is a note rather than a textarea.
  await expect(panel.locator('#scratch-user-note')).toBeVisible();
  await expect(panel.locator('#scratch-user')).toHaveCount(0);
  // Left of the items, under the title bar, as tall as the window.
  const [p, m, top] = await Promise.all([panel.boundingBox(), page.locator('#main').boundingBox(), page.locator('.topbar').boundingBox()]);
  expect(p.x + p.width).toBeLessThanOrEqual(m.x + 1);
  expect(Math.round(p.y)).toBe(Math.round(top.y + top.height));
  expect(Math.round(p.height)).toBe(900 - Math.round(top.height));
  expect(Math.round(p.width)).toBe(320);

  await page.reload();
  await expect(page.locator('#scratch')).toBeVisible();
  await expect(page.locator('#btn-scratch')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btn-scratch').click();
  await expect(page.locator('#scratch')).toBeHidden();
  await page.reload();
  await expect(page.locator('#scratch')).toBeHidden();
});

test('typing is saved and survives a reload; the account pane follows the account', async ({ page, request }) => {
  const sam = await userByName(request, 'Sam');
  await page.goto('/#/all');
  await page.locator('#btn-scratch').click();
  const shared = page.locator('#scratch-global');
  await shared.fill('shared line 1\nshared line 2');
  await expect(page.locator('.scratch-pane').first().locator('.scratch-status')).toHaveText('Saved');
  await expect.poll(() => textOf(request, '/api/scratch')).toBe('shared line 1\nshared line 2');

  // Pick an account: the panel follows Sam's own preferences (closed, so
  // far) and the lower pane becomes Sam's pad.
  await page.locator('#account-select').selectOption(String(sam.id));
  await expect(page.locator('#scratch')).toBeHidden();
  await page.locator('#btn-scratch').click();
  await expect(page.locator('#scratch')).toBeVisible();
  await expect(page.locator('.scratch-pane').nth(1).locator('.scratch-name')).toHaveText('Sam');
  const own = page.locator('#scratch-user');
  await own.fill("Sam's notes");
  await expect.poll(() => textOf(request, `/api/users/${sam.id}/scratch`)).toBe("Sam's notes");
  // The shared pane kept its text across the account switch.
  await expect(shared).toHaveValue('shared line 1\nshared line 2');

  await page.reload();
  await expect(page.locator('#scratch-global')).toHaveValue('shared line 1\nshared line 2');
  await expect(page.locator('#scratch-user')).toHaveValue("Sam's notes");
  expect(await textOf(request, '/api/scratch')).toBe('shared line 1\nshared line 2');
});

test('two browsers see each other\'s text as it is typed, but not while editing the same pane', async ({ page, browser, request }) => {
  const other = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE });
  const pageB = await other.newPage();
  try {
    await page.goto('/#/all');
    await pageB.goto('/#/all');
    await page.locator('#btn-scratch').click();
    await pageB.locator('#btn-scratch').click();
    await page.locator('#scratch-global').fill('from A');
    await expect(pageB.locator('#scratch-global')).toHaveValue('from A');
    // The pane in B is being edited: A's next change waits until B is done.
    await pageB.locator('#scratch-global').focus();
    await page.locator('#scratch-global').fill('from A, again');
    await expect.poll(() => textOf(request, '/api/scratch')).toBe('from A, again');
    await page.waitForTimeout(500);
    await expect(pageB.locator('#scratch-global')).toHaveValue('from A');
    await pageB.locator('#scratch-global').blur();
    await expect(pageB.locator('#scratch-global')).toHaveValue('from A, again');
    // And the other way, by B (A's pane is no longer focused after the fill).
    await page.locator('#scratch-global').blur();
    await pageB.locator('#scratch-global').fill('from B');
    await expect(page.locator('#scratch-global')).toHaveValue('from B');
  } finally {
    await other.close();
  }
});

test('the splitters resize the panel and the panes and persist; Wrap toggles line wrapping', async ({ page, request }) => {
  const alex = await userByName(request, 'Alex');
  await page.goto('/#/all');
  await page.locator('#account-select').selectOption(String(alex.id));
  await page.locator('#btn-scratch').click();
  const panel = page.locator('#scratch');
  await expect(panel).toBeVisible();

  // Width: drag the right edge.
  const v = await panel.locator('.scratch-vsplit').boundingBox();
  await page.mouse.move(v.x + v.width / 2, v.y + 200);
  await page.mouse.down();
  await page.mouse.move(v.x + v.width / 2 + 130, v.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await panel.boundingBox()).width)).toBe(450);
  await expect.poll(async () => (await (await request.get(`/api/users/${alex.id}/prefs`)).json()).scratch_width).toBe('450');

  // Split: drag the rule between the panes down.
  const before = await page.locator('.scratch-pane').first().boundingBox();
  const h = await panel.locator('.scratch-hsplit').boundingBox();
  await page.mouse.move(h.x + 100, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 100, h.y + h.height / 2 + 150, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('.scratch-pane').first().boundingBox();
  expect(after.height).toBeGreaterThan(before.height + 100);
  const split = Number((await (await request.get(`/api/users/${alex.id}/prefs`)).json()).scratch_split);
  expect(split).toBeGreaterThan(55);

  // Wrap: on by default; off makes long lines scroll sideways.
  const ta = page.locator('#scratch-global');
  await expect(ta).toHaveCSS('white-space', 'pre-wrap');
  await page.locator('#scratch-wrap').uncheck();
  await expect(ta).toHaveCSS('white-space', 'pre');
  await expect.poll(async () => (await (await request.get(`/api/users/${alex.id}/prefs`)).json()).scratch_wrap).toBe('0');

  await page.reload();
  await expect(page.locator('#scratch')).toBeVisible();
  expect(Math.round((await page.locator('#scratch').boundingBox()).width)).toBe(450);
  const reloaded = await page.locator('.scratch-pane').first().boundingBox();
  expect(Math.abs(reloaded.height - after.height)).toBeLessThan(12);
  await expect(page.locator('#scratch-global')).toHaveCSS('white-space', 'pre');
  await expect(page.locator('#scratch-wrap')).not.toBeChecked();
});

test('the scratch API caps the text at 1 MiB and knows its users', async ({ request }) => {
  const r = await request.put('/api/scratch', { data: { text: 'x'.repeat(1024 * 1024 + 1) } });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toContain('1 MiB');
  expect((await request.get('/api/users/99999/scratch')).status()).toBe(404);
});
