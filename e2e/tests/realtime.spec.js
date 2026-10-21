import { test, expect } from '@playwright/test';

// Live updates: the server announces every change on /api/events and a page
// reloads itself when another client changed something, unless an edit is in
// progress there (then the update waits for the edit to finish).

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (page, title) => page.locator('.title-text', { hasText: new RegExp(`^${esc(title)}$`) });
const taskRow = (page, title) => page.locator('.row.task', { has: exact(page, title) });
const titleInput = (page) => page.locator('input[name=title]');
const itemByTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

test('a change made in one browser appears in another without a reload', async ({ page, browser, request }) => {
  const seeds = await itemByTitle(request, 'Buy seeds');
  const other = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE });
  const pageB = await other.newPage();
  try {
    await page.goto('/#/all');
    await pageB.goto('/#/all');
    await expect(taskRow(page, 'Buy seeds')).toBeVisible();
    await expect(taskRow(pageB, 'Buy seeds')).toBeVisible();

    // Edit the title in B through the page itself; A sees it without any
    // navigation or reload.
    await taskRow(pageB, 'Buy seeds').locator('.title-text').click();
    await titleInput(pageB).fill('Buy seeds (live)');
    await titleInput(pageB).press('Enter');
    await expect(taskRow(page, 'Buy seeds (live)')).toBeVisible();
    await expect(taskRow(page, 'Buy seeds')).toHaveCount(0);

    // Changes from outside any page (the API, the Android app) arrive too.
    await request.patch(`/api/items/${seeds.id}`, { data: { urgency: 9 } });
    await expect(taskRow(page, 'Buy seeds (live)').locator('input[name=urgency]')).toHaveValue('9');
    await expect(taskRow(pageB, 'Buy seeds (live)').locator('input[name=urgency]')).toHaveValue('9');
  } finally {
    await other.close();
    await request.patch(`/api/items/${seeds.id}`, { data: { title: 'Buy seeds', urgency: 5 } });
  }
});

test('an edit in progress is not clobbered; the update arrives once it is finished', async ({ page, browser, request }) => {
  const gutters = await itemByTitle(request, 'Clean gutters');
  const beds = await itemByTitle(request, 'Build raised beds');
  const other = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE });
  const pageB = await other.newPage();
  try {
    await page.goto('/#/all');
    await pageB.goto('/#/all');
    // A opens the title editor of one task and starts typing.
    await taskRow(page, 'Clean gutters').locator('.title-text').click();
    await titleInput(page).fill('Clean gutters, typing');
    // B changes another task; A keeps its editor and its typed text.
    await taskRow(pageB, 'Build raised beds').locator('.title-text').click();
    await titleInput(pageB).fill('Build raised beds (B)');
    await titleInput(pageB).press('Enter');
    await expect(taskRow(pageB, 'Build raised beds (B)')).toBeVisible();
    await page.waitForTimeout(1200); // longer than the debounce and the busy recheck
    await expect(titleInput(page)).toHaveValue('Clean gutters, typing');
    await expect(taskRow(page, 'Build raised beds')).toBeVisible(); // still the old title in A
    // Finishing the edit (Escape reverts) lets the deferred update through.
    await titleInput(page).press('Escape');
    await expect(titleInput(page)).toHaveCount(0);
    await expect(taskRow(page, 'Build raised beds (B)')).toBeVisible();
    await expect(taskRow(page, 'Clean gutters')).toBeVisible();
  } finally {
    await other.close();
    await request.patch(`/api/items/${beds.id}`, { data: { title: 'Build raised beds' } });
    await request.patch(`/api/items/${gutters.id}`, { data: { title: 'Clean gutters' } });
  }
});

test('the event stream names the kind of change and the originating client', async ({ page, request }) => {
  await page.goto('/#/all');
  // Read one event in the page (its own client id is on every request it makes).
  const got = page.evaluate(() => new Promise((resolve, reject) => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => { es.close(); resolve(JSON.parse(e.data)); };
    es.onerror = () => { es.close(); reject(new Error('stream error')); };
  }));
  await page.waitForTimeout(300); // let the stream open before the change
  const r = await request.patch('/api/settings', { data: { week_start: '6' }, headers: { 'X-Planner-Client': 'e2e-client' } });
  expect(r.status()).toBe(200);
  const ev = await got;
  expect(ev).toMatchObject({ kind: 'settings', client: 'e2e-client' });
  expect(ev.rev).toBeGreaterThan(0);
});
