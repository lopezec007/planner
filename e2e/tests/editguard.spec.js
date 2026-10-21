import { test, expect } from '@playwright/test';

// An edit in progress (a new row, an open title/date/description editor) is
// protected: in-app navigation shows a snack and stays on the page without
// discarding the edit, and leaving the page asks first.

const newRow = (page) => page.locator('.row[data-editing="new"]:not(.description)');

test('in-app navigation while a new row is being edited shows a snack and keeps the draft', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('#btn-new-ongoing').click();
  await expect(newRow(page)).toHaveCount(1);
  await newRow(page).locator('.title-input').fill('Half-typed');

  // The gear sets the hash; the draft stays, the hash is put back.
  await page.locator('#btn-settings').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Finish (Enter) or discard (Escape)');
  await expect(page.locator('h1', { hasText: 'Settings' })).toHaveCount(0);
  await expect(newRow(page)).toHaveCount(1);
  await expect(newRow(page).locator('.title-input')).toHaveValue('Half-typed');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/all');

  // A filter route is refused in the same way (and not applied).
  await page.evaluate(() => { location.hash = '#/ideas'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/all');
  await expect(newRow(page).locator('.title-input')).toHaveValue('Half-typed');
  await expect(page.locator('.search-preset[data-preset=ideas]')).toHaveAttribute('aria-pressed', 'false');

  // Once the draft is discarded, navigation works again.
  await newRow(page).locator('.title-input').press('Escape');
  await expect(newRow(page)).toHaveCount(0);
  await page.locator('#btn-settings').click();
  await expect(page.locator('h1')).toHaveText('Settings');
});

// Clicking the gear blurs an editor on a saved row, which saves it first (by
// design), so these editors meet the guard through a hash change that does
// not blur: the back button or a typed address, simulated with location.hash.
const navigate = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

test('an open title or description editor on a saved row blocks navigation too; a picker does not', async ({ page }) => {
  await page.goto('/#/all');
  // The row is pinned by id: once the title is an input, its text is gone from the row.
  const id = await page.locator('.row.task', { hasText: 'Clean gutters' }).getAttribute('data-id');
  const gutters = page.locator(`.row[data-id="${id}"]`);
  await gutters.locator('.title-text').click();
  await expect(gutters.locator('.title-input')).toBeVisible();
  await navigate(page, '#/settings');
  await expect(page.locator('#toast')).toContainText('Finish (Enter) or discard (Escape)');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/all');
  await expect(gutters.locator('.title-input')).toBeVisible();
  await gutters.locator('.title-input').press('Escape');
  await expect(gutters.locator('.title-input')).toHaveCount(0);

  // An open owner picker is not an edit in progress.
  await gutters.locator('.chip-pick[data-name=owner]').click();
  await expect(gutters.locator('.user-pick[data-name=owner]')).toBeVisible();
  await navigate(page, '#/settings');
  await expect(page.locator('h1')).toHaveText('Settings');
  await navigate(page, '#/all');
  await expect(page.locator('.row.parent').first()).toBeVisible();

  // The description textarea counts; closing it with Escape frees the page.
  await gutters.locator('.toggle button').click();
  const desc = page.locator('.row.description[data-desc-for]');
  await desc.locator('.md').click();
  await expect(desc.locator('.desc-textarea')).toBeVisible();
  await navigate(page, '#/settings');
  await expect(page.locator('#toast')).toContainText('Finish (Enter) or discard (Escape)');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/all');
  await expect(desc.locator('.desc-textarea')).toBeVisible();
  await desc.locator('.desc-textarea').press('Escape');
  await page.locator('#btn-settings').click();
  await expect(page.locator('h1')).toHaveText('Settings');
});

test('leaving the page with a draft asks first', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE });
  const page = await ctx.newPage();
  await page.goto('/#/all');
  await page.locator('#btn-new-project').click();
  await expect(newRow(page)).toHaveCount(1);
  const dialog = page.waitForEvent('dialog');
  const closing = page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.accept();
  await closing;
  await ctx.close();
});
