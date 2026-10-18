import { test, expect } from '@playwright/test';

// Accounts: the user picked in the account menu owns the view, layout and
// sort preferences, stored on the server so they follow the user to any
// browser. With no account the browser's own preferences apply.

const userByName = async (request, name) => (await (await request.get('/api/users')).json()).find((u) => u.name === name);

test('preferences follow the account across reloads and browsers; no account means this browser only', async ({ page, browser, request }) => {
  const sam = await userByName(request, 'Sam');
  try {
    await page.goto('/#/all');
    const select = page.locator('#account-select');
    await expect(select).toHaveValue('');
    await expect(select.locator('option')).toHaveCount(4); // No account + Alex, Evan, Sam

    // Browser preferences first: Flat on, Timeline view.
    await page.locator('#btn-flat').click();
    await expect(page.locator('.table')).toHaveClass(/flat/);

    // Switch to Sam: Sam has defaults (not Flat), and changes go to the server.
    await select.selectOption(String(sam.id));
    await expect(select).toHaveValue(String(sam.id));
    await expect(page.locator('.table')).not.toHaveClass(/flat/);
    await page.locator('button[data-view=timeline]').click();
    await expect(page.locator('.timeline-canvas')).toBeVisible();
    await page.locator('#btn-flat').click();
    await expect.poll(async () => (await (await request.get(`/api/users/${sam.id}/prefs`)).json())).toMatchObject({ view: 'timeline', flat: '1' });

    // Reload: still Sam, still Timeline + Flat.
    await page.reload();
    await expect(page.locator('#account-select')).toHaveValue(String(sam.id));
    await expect(page.locator('.timeline-canvas')).toBeVisible();
    await expect(page.locator('.table')).toHaveClass(/flat/);

    // A different browser picking Sam gets the same preferences.
    const other = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE });
    const p2 = await other.newPage();
    await p2.goto('/#/all');
    await expect(p2.locator('.table')).not.toHaveClass(/flat/); // its own (default) preferences
    await p2.locator('#account-select').selectOption(String(sam.id));
    await expect(p2.locator('.timeline-canvas')).toBeVisible();
    await expect(p2.locator('.table')).toHaveClass(/flat/);
    await other.close();

    // Back to no account: the browser's own preferences return (Flat on, Table view).
    await page.locator('#account-select').selectOption('');
    await expect(page.locator('.table')).toHaveClass(/flat/);
    await expect(page.locator('.timeline-canvas')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#account-select')).toHaveValue('');
    await expect(page.locator('.table')).toHaveClass(/flat/);
    await page.locator('#btn-nested').click();
  } finally {
    await request.patch(`/api/users/${sam.id}/prefs`, { data: { view: 'table', flat: '0', narrow: '0', sort: '[]', blocked_last: '0', collapsed: '[]', bar_color: 'assignee', filters: '' } });
  }
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
