import { test, expect } from '@playwright/test';

// Accounts: the user picked in the account menu owns the view, layout and
// sort preferences, stored on the server so they follow the user to any
// browser. The menu lists only users; a browser that has not picked one
// gets the first listed user. Only with no users do the browser's own
// preferences apply.

const userByName = async (request, name) => (await (await request.get('/api/users')).json()).find((u) => u.name === name);

// The e2e browsers keep their preferences to themselves (playwright.config.js
// remembers an empty account, and browser.newContext() inherits that); a
// context opened with empty storage behaves like a first visit and gets the
// first listed user.
const freshPage = async (browser) => {
  const ctx = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE, storageState: { cookies: [], origins: [] } });
  return { ctx, page: await ctx.newPage() };
};

test('a first visit picks the first user; preferences follow the account across reloads and browsers', async ({ browser, request }) => {
  const users = await (await request.get('/api/users')).json(); // sorted by name: Alex, Evan, Sam
  const alex = users.find((u) => u.name === 'Alex');
  const sam = users.find((u) => u.name === 'Sam');
  const { ctx, page } = await freshPage(browser);
  try {
    await page.goto('/#/all');
    const select = page.locator('#account-select');
    await expect(select).toHaveValue(String(alex.id)); // the first user, picked automatically
    await expect(select.locator('option')).toHaveCount(3); // only users; no "No account"
    await expect(select.locator('option', { hasText: 'No account' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('planner.account'))).toBe(String(alex.id)); // and remembered
    await expect(select).toHaveAttribute('title', /^Alex:/);
    await expect(page.locator('.table')).not.toHaveClass(/flat/);

    // Switch to Sam: Sam has defaults (not Flat), and changes go to the server.
    await select.selectOption(String(sam.id));
    await expect(select).toHaveValue(String(sam.id));
    await page.locator('button[data-view=timeline]').click();
    await expect(page.locator('.timeline-canvas')).toBeVisible();
    await page.locator('#btn-flat').click();
    await expect(page.locator('.table')).toHaveClass(/flat/);
    await expect.poll(async () => (await (await request.get(`/api/users/${sam.id}/prefs`)).json())).toMatchObject({ view: 'timeline', flat: '1' });
    expect((await (await request.get(`/api/users/${alex.id}/prefs`)).json()).flat).toBe('0'); // Alex untouched

    // Reload: still Sam, still Timeline + Flat.
    await page.reload();
    await expect(page.locator('#account-select')).toHaveValue(String(sam.id));
    await expect(page.locator('.timeline-canvas')).toBeVisible();
    await expect(page.locator('.table')).toHaveClass(/flat/);

    // A different browser starts as Alex (its own first visit); picking Sam gets Sam's preferences.
    const other = await freshPage(browser);
    await other.page.goto('/#/all');
    await expect(other.page.locator('#account-select')).toHaveValue(String(alex.id));
    await expect(other.page.locator('.table')).not.toHaveClass(/flat/);
    await other.page.locator('#account-select').selectOption(String(sam.id));
    await expect(other.page.locator('.timeline-canvas')).toBeVisible();
    await expect(other.page.locator('.table')).toHaveClass(/flat/);
    await other.ctx.close();

    // A remembered user that no longer exists falls back to the first user.
    await page.evaluate(() => localStorage.setItem('planner.account', '999999'));
    await page.reload();
    await expect(page.locator('#account-select')).toHaveValue(String(alex.id));
    await expect(page.locator('.table')).not.toHaveClass(/flat/);
  } finally {
    await ctx.close();
    await request.patch(`/api/users/${sam.id}/prefs`, { data: { view: 'table', flat: '0', narrow: '0', sort: '[]', blocked_last: '0', collapsed: '[]', bar_color: 'assignee', filters: '' } });
    await request.patch(`/api/users/${alex.id}/prefs`, { data: { view: 'table', flat: '0', filters: '' } });
  }
});

test('a browser told to keep its preferences to itself shows a placeholder and stays local', async ({ page }) => {
  await page.goto('/#/all');
  const select = page.locator('#account-select');
  await expect(select).toHaveValue('');
  await expect(select).toBeEnabled();
  await expect(select.locator('option', { hasText: 'No account' })).toHaveCount(0);
  await expect(select.locator('option:not([hidden])')).toHaveCount(3);
  await page.locator('#btn-flat').click();
  await expect(page.locator('.table')).toHaveClass(/flat/);
  await page.reload();
  await expect(page.locator('#account-select')).toHaveValue('');
  await expect(page.locator('.table')).toHaveClass(/flat/);
  expect(await page.evaluate(() => localStorage.getItem('planner.pref.flat'))).toBe('1');
});

test('the preferences API validates keys and values and is per user', async ({ request }) => {
  const alex = await userByName(request, 'Alex');
  const evan = await userByName(request, 'Evan');
  try {
    const def = await (await request.get(`/api/users/${alex.id}/prefs`)).json();
    expect(def).toMatchObject({ view: 'table', flat: '0', sort: '[]', bar_color: 'assignee' });
    const r = await request.patch(`/api/users/${alex.id}/prefs`, { data: { sort: JSON.stringify([{ key: 'end', dir: 'desc' }]), bar_color: 'combo' } });
    expect(r.status()).toBe(200);
    expect((await r.json()).bar_color).toBe('combo');
    expect((await (await request.get(`/api/users/${evan.id}/prefs`)).json()).bar_color).toBe('assignee');
    expect((await request.patch(`/api/users/${alex.id}/prefs`, { data: { view: 'sideways' } })).status()).toBe(400);
    expect((await request.patch(`/api/users/${alex.id}/prefs`, { data: { nonsense: '1' } })).status()).toBe(400);
    expect((await request.get('/api/users/99999/prefs')).status()).toBe(404);
  } finally {
    await request.patch(`/api/users/${alex.id}/prefs`, { data: { sort: '[]', bar_color: 'assignee' } });
  }
});
