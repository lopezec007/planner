import { test, expect } from '@playwright/test';

// Seed creates Evan, Sam and Alex, all referenced by items.

const row = (page, name) => page.locator('.user-row:not(.header)', { has: page.locator(`.user-name[value="${name}"]`) });

test('users page lists seeded users with colour chips', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/settings');
  await expect(page.locator('.user-row:not(.header)')).toHaveCount(3);
  for (const name of ['Alex', 'Evan', 'Sam']) {
    const r = page.locator('.user-row', { hasText: name });
    await expect(r.locator('.chip')).toHaveText(name);
    const bg = await r.locator('.chip').evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(bg).toMatch(/^rgb\(/);
    await expect(r.locator('input[type="color"]')).toHaveValue(/^#[0-9a-f]{6}$/);
  }
  await expect(page.locator('#toolbar > *:not(.spacer):not(.version)')).toHaveCount(0); // only the version badge
  expect(errors).toEqual([]);
});

test('add, rename, recolour and delete a user', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/#/settings');

  // Add: colour is auto-assigned by the server.
  await page.locator('#new-user-name').fill('Robin');
  await page.locator('#btn-add-user').click();
  const robin = page.locator('.user-row', { hasText: 'Robin' });
  await expect(robin).toHaveCount(1);
  await expect(robin.locator('input[type="color"]')).toHaveValue(/^#[0-9a-f]{6}$/);
  await expect(page.locator('#new-user-name')).toHaveValue('');

  // Rename inline: edit the name field and press Enter.
  await robin.locator('.user-name').fill('Robin Lee');
  await robin.locator('.user-name').press('Enter');
  await expect(page.locator('.user-row .chip', { hasText: 'Robin Lee' })).toBeVisible();
  await expect(page.locator('.user-row:not(.header)')).toHaveCount(4);

  // Recolour Evan and verify the chip colour changes here and on the homepage.
  const evan = row(page, 'Evan');
  await evan.locator('input[type="color"]').fill('#123456');
  await expect(evan.locator('.chip')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(evan.locator('.user-hex')).toHaveText('#123456');
  await page.goto('/#/');
  const maint = page.locator('.row.parent', { hasText: 'Maintenance' });
  await expect(maint.locator('.chip', { hasText: 'Evan' })).toHaveCSS('background-color', 'rgb(18, 52, 86)');

  // Deleting a referenced user fails with the server's 409 message and the user stays.
  await page.goto('/#/settings');
  await row(page, 'Evan').locator('.user-delete').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('referenced');
  await expect(row(page, 'Evan')).toHaveCount(1);
  await expect(page.locator('.user-row:not(.header)')).toHaveCount(4);

  // Deleting an unreferenced user removes it.
  await row(page, 'Robin Lee').locator('.user-delete').click();
  await expect(row(page, 'Robin Lee')).toHaveCount(0);
  await expect(page.locator('.user-row:not(.header)')).toHaveCount(3);
});

test('rename to a blank or duplicate name is rejected', async ({ page }) => {
  await page.goto('/#/settings');
  const sam = row(page, 'Sam');
  await sam.locator('.user-name').fill('   ');
  await sam.locator('.user-name').press('Enter');
  await expect(page.locator('#toast')).toContainText('required');
  await expect(sam.locator('.user-name')).toHaveValue('Sam');

  await sam.locator('.user-name').fill('Alex');
  await sam.locator('.user-name').press('Enter');
  await expect(page.locator('#toast')).toContainText('already exists');
  await expect(row(page, 'Sam').locator('.user-name')).toHaveValue('Sam');
});
