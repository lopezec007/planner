import { test, expect } from '@playwright/test';

// "Keep done and cancelled items for N days" (Settings, General): how long a
// closed item stays in the Active view. The Active template follows the
// setting; a number typed into the Filters panel is the user's own.
// Seed: "Fix fence post" (done) and "Choose backsplash" (cancelled) were
// closed moments ago.

const task = (page, title) => page.locator('.row.task', { hasText: title });
const preset = (page, name) => page.locator(`.search-preset[data-preset=${name}]`);
const days = (page) => page.locator('[data-search-key="recentDays"]');
const setting = async (request) => (await (await request.get('/api/settings')).json()).closed_days;
const openFilters = async (page) => { if (!(await page.locator('#search-panel').isVisible())) await page.locator('#btn-filters').click(); };

test.afterEach(async ({ request }) => { await request.patch('/api/settings', { data: { closed_days: '14' } }); });

test('the setting is 14 days by default and is edited in Settings', async ({ page, request }) => {
  expect(await setting(request)).toBe('14');
  await page.goto('/#/settings');
  const inp = page.locator('#setting-closed-days');
  await expect(inp).toHaveValue('14');
  await inp.fill('30');
  await inp.press('Tab');
  await expect.poll(() => setting(request)).toBe('30');
  await page.reload();
  await expect(page.locator('#setting-closed-days')).toHaveValue('30');
  // Out of range, or not a whole number: refused, the old value stays.
  for (const bad of ['-1', '366', '2.5', '']) {
    await page.locator('#setting-closed-days').fill(bad);
    await page.locator('#setting-closed-days').press('Tab');
    await expect(page.locator('#toast')).toContainText('0 to 365');
    await expect(page.locator('#setting-closed-days')).toHaveValue('30');
  }
  expect(await setting(request)).toBe('30');
});

test('the Active view keeps closed items for the configured number of days', async ({ page, request }) => {
  await page.goto('/#/active');
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
  await expect(preset(page, 'active')).toHaveAttribute('title', /closed in the last 14 days/);
  await expect(task(page, 'Fix fence post')).toBeVisible();
  await expect(task(page, 'Choose backsplash')).toBeVisible();
  await openFilters(page);
  await expect(days(page)).toHaveValue('14');
  await page.keyboard.press('Escape');

  // 0: closed items leave the Active view at once. This page hears of the change and redraws; Active stays lit.
  await request.patch('/api/settings', { data: { closed_days: '0' } });
  await expect(task(page, 'Fix fence post')).toHaveCount(0);
  await expect(task(page, 'Choose backsplash')).toHaveCount(0);
  await expect(task(page, 'Clean gutters')).toBeVisible();
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
  await expect(preset(page, 'active')).toHaveAttribute('title', /^Active: To-Do, In-Progress and Validating items\./);
  await openFilters(page);
  await expect(days(page)).toHaveValue('');
  await page.keyboard.press('Escape');

  // Any other number brings them back, and the panel shows it; the stored filters follow after a reload too.
  await request.patch('/api/settings', { data: { closed_days: '3' } });
  await expect(task(page, 'Fix fence post')).toBeVisible();
  await expect(preset(page, 'active')).toHaveAttribute('title', /closed in the last 3 days/);
  await page.goto('/#/');
  await page.reload();
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
  await openFilters(page);
  await expect(days(page)).toHaveValue('3');
});

test('a number typed into the Filters panel is kept when the setting changes; the setting\'s own value follows it', async ({ page, request }) => {
  await page.goto('/#/active');
  await openFilters(page);
  await days(page).fill('5');
  await days(page).press('Enter');
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'false'); // no longer the template
  await request.patch('/api/settings', { data: { closed_days: '0' } });
  await page.goto('/#/');
  await page.reload();
  await openFilters(page);
  await expect(days(page)).toHaveValue('5');
  await expect(task(page, 'Fix fence post')).toBeVisible();

  // Typing the setting's value is the template again, and follows the setting from then on.
  await request.patch('/api/settings', { data: { closed_days: '9' } });
  await page.reload();
  await openFilters(page);
  await days(page).fill('9');
  await days(page).press('Enter');
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
  await request.patch('/api/settings', { data: { closed_days: '0' } });
  await expect(task(page, 'Fix fence post')).toHaveCount(0);
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
});

test('filters stored before the setting existed (Active with 14 days) follow it', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { closed_days: '0' } });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('planner.pref.filters', JSON.stringify({
      types: [], statuses: ['todo', 'in-progress', 'validating'], recent_days: 14, hide_empty_parents: true,
      owner: '', assignee: '', blocked: '', end_after: '', end_before: '',
    }));
  });
  await page.goto('/#/');
  await expect(task(page, 'Clean gutters')).toBeVisible();
  await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
  await expect(task(page, 'Fix fence post')).toHaveCount(0);
});

test('an account\'s stored filters carry the flag and are accepted by the server', async ({ browser, request }) => {
  const users = await (await request.get('/api/users')).json();
  const sam = users.find((u) => u.name === 'Sam');
  const ctx = await browser.newContext({
    baseURL: process.env.PLANNER_E2E_BASE,
    storageState: { cookies: [], origins: [{ origin: process.env.PLANNER_E2E_BASE, localStorage: [{ name: 'planner.account', value: String(sam.id) }] }] },
  });
  const page = await ctx.newPage();
  const before = (await (await request.get(`/api/users/${sam.id}/prefs`)).json()).filters;
  try {
    await page.goto('/#/backlog');
    await expect(preset(page, 'backlog')).toHaveAttribute('aria-pressed', 'true');
    await preset(page, 'active').click(); // Active + Backlog
    await expect.poll(async () => JSON.parse((await (await request.get(`/api/users/${sam.id}/prefs`)).json()).filters || '{}').recent_auto).toBe(true);
    await expect(page.locator('#toast')).toBeHidden(); // the save was not refused
    await request.patch('/api/settings', { data: { closed_days: '0' } });
    await expect(task(page, 'Fix fence post')).toHaveCount(0);
    await expect(preset(page, 'active')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await request.patch(`/api/users/${sam.id}/prefs`, { data: { filters: before || '' } });
    await ctx.close();
  }
});
