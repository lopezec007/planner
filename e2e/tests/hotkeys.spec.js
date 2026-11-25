import { test, expect } from '@playwright/test';

// Users can be given a letter key in Settings; pressing it in an Owner or
// Assignee cell (the chip focused, or its picker open) sets that user, and
// Backspace or Delete clears the cell. Seed: Evan, Sam and Alex, no keys.

const userRow = (page, name) => page.locator('.user-row:not(.header)', { has: page.locator(`.user-name[value="${name}"]`) });
const users = async (request) => (await request.get('/api/users')).json();
const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);
const setKeys = async (request, keys) => {
  for (const u of await users(request)) await request.patch(`/api/users/${u.id}`, { data: { hotkey: keys[u.name] || '' } });
};
const focused = (page) => page.evaluate(() => { const a = document.activeElement; return a.classList.contains('chip-pick') ? a.dataset.name : a.tagName; });

test.afterEach(async ({ request }) => { await setKeys(request, {}); });

test('a user is given a letter key in Settings; a letter in use or a non-letter is refused', async ({ page, request }) => {
  await page.goto('/#/settings');
  await expect(page.locator('.user-row.header')).toContainText('Key');
  for (const name of ['Alex', 'Evan', 'Sam']) await expect(userRow(page, name).locator('.user-hotkey')).toHaveValue('');

  // Typed lower-case, shown upper-case, stored lower-case; Enter saves.
  await userRow(page, 'Evan').locator('.user-hotkey').fill('e');
  await userRow(page, 'Evan').locator('.user-hotkey').press('Enter');
  await expect.poll(async () => (await users(request)).find((u) => u.name === 'Evan').hotkey).toBe('e');
  await expect(userRow(page, 'Evan').locator('.user-hotkey')).toHaveValue('E');
  await expect(userRow(page, 'Evan').locator('.user-hotkey')).toHaveCSS('text-transform', 'uppercase');

  // Leaving the field saves too.
  await userRow(page, 'Sam').locator('.user-hotkey').fill('S');
  await page.locator('#new-user-name').click();
  await expect.poll(async () => (await users(request)).find((u) => u.name === 'Sam').hotkey).toBe('s');

  // A letter another user has is refused with the server's message, whatever the case.
  await userRow(page, 'Alex').locator('.user-hotkey').fill('E');
  await userRow(page, 'Alex').locator('.user-hotkey').press('Enter');
  await expect(page.locator('#toast')).toContainText('E is already the key of Evan');
  await expect(userRow(page, 'Alex').locator('.user-hotkey')).toHaveValue('');
  // Only letters.
  await userRow(page, 'Alex').locator('.user-hotkey').fill('7');
  await userRow(page, 'Alex').locator('.user-hotkey').press('Enter');
  await expect(page.locator('#toast')).toContainText('single letter');
  await expect(userRow(page, 'Alex').locator('.user-hotkey')).toHaveValue('');
  expect((await users(request)).find((u) => u.name === 'Alex').hotkey).toBe('');

  // The keys survive a reload; emptying the field removes one and frees the letter.
  await page.reload();
  await expect(userRow(page, 'Evan').locator('.user-hotkey')).toHaveValue('E');
  await expect(userRow(page, 'Sam').locator('.user-hotkey')).toHaveValue('S');
  await userRow(page, 'Evan').locator('.user-hotkey').fill('');
  await userRow(page, 'Evan').locator('.user-hotkey').press('Enter');
  await expect.poll(async () => (await users(request)).find((u) => u.name === 'Evan').hotkey).toBe('');
  await userRow(page, 'Alex').locator('.user-hotkey').fill('e');
  await userRow(page, 'Alex').locator('.user-hotkey').press('Enter');
  await expect.poll(async () => (await users(request)).find((u) => u.name === 'Alex').hotkey).toBe('e');
});

test('a hotkey in an Owner or Assignee cell sets that user, Backspace clears it, and the cell keeps the focus', async ({ page, request }) => {
  await setKeys(request, { Evan: 'e', Sam: 's' });
  const all = await users(request);
  const id = Object.fromEntries(all.map((u) => [u.name, u.id]));
  const hvac = await byTitle(request, 'Replace HVAC filter'); // no owner, no assignee in the seed
  expect(hvac.assignee_id).toBeNull();
  const stored = async (field) => (await byTitle(request, 'Replace HVAC filter'))[field];

  await page.goto('/#/all');
  const row = page.locator(`.row[data-id="${hvac.id}"]`);
  const assignee = row.locator('.chip-pick[data-name=assignee]');
  const owner = row.locator('.chip-pick[data-name=owner]');

  // The chip focused (as Tab leaves it): a key sets the user and the focus stays, so the next key lands there too.
  await assignee.focus();
  await page.keyboard.press('s');
  await expect(assignee).toHaveText('Sam');
  await expect.poll(() => stored('assignee_id')).toBe(id.Sam);
  await expect.poll(() => focused(page)).toBe('assignee');
  await page.keyboard.press('Shift+E'); // upper-case works the same
  await expect(assignee).toHaveText('Eva');
  await expect.poll(() => stored('assignee_id')).toBe(id.Evan);
  await expect.poll(() => focused(page)).toBe('assignee');

  // Keys that belong to nobody, and shortcuts, change nothing.
  await page.keyboard.press('x');
  await page.keyboard.press('a'); // Alex has no key
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Alt+s');
  await page.waitForTimeout(300);
  expect(await stored('assignee_id')).toBe(id.Evan);
  await expect(assignee).toHaveText('Eva');

  // With the picker open (a click), the key picks and closes it; the tooltips name the keys.
  await assignee.click();
  const pick = row.locator('.user-pick[data-name=assignee]');
  await expect(pick).toBeVisible();
  await expect(pick.locator('.chip[data-user-name="Sam"]')).toHaveAttribute('title', 'Sam (key S)');
  await expect(pick.locator('.chip[data-user-name="Alex"]')).toHaveAttribute('title', 'Alex');
  await page.keyboard.press('s');
  await expect(pick).toHaveCount(0);
  await expect(assignee).toHaveText('Sam');
  await expect.poll(() => stored('assignee_id')).toBe(id.Sam);
  await expect.poll(() => focused(page)).toBe('assignee');

  // The Owner cell works the same way and is separate.
  await owner.focus();
  await page.keyboard.press('e');
  await expect(owner).toHaveText('Eva');
  await expect.poll(() => stored('owner_id')).toBe(id.Evan);
  expect(await stored('assignee_id')).toBe(id.Sam);

  // Backspace and Delete clear the cell.
  await expect.poll(() => focused(page)).toBe('owner');
  await page.keyboard.press('Backspace');
  await expect.poll(() => stored('owner_id')).toBeNull();
  await expect(owner).toHaveClass(/empty/);
  await assignee.focus();
  await page.keyboard.press('Delete');
  await expect.poll(() => stored('assignee_id')).toBeNull();
  await expect(assignee).toHaveClass(/empty/);

  // Ctrl+Z takes an assignment back like any other edit.
  await page.keyboard.press('s');
  await expect.poll(() => stored('assignee_id')).toBe(id.Sam);
  await expect(assignee).toHaveText('Sam');
  await page.keyboard.press('Control+z');
  await expect.poll(() => stored('assignee_id')).toBeNull();
});

test('a hotkey works in a new row before it is saved', async ({ page, request }) => {
  await setKeys(request, { Evan: 'e', Sam: 's' });
  await page.goto('/#/all');
  await page.locator('#btn-new-project').click();
  const row = page.locator('.row[data-editing="new"]:not(.description)');
  await expect(row).toHaveCount(1);
  await row.locator('.chip-pick[data-name=owner]').focus();
  await page.keyboard.press('s');
  await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('Sam');
  await expect.poll(() => focused(page)).toBe('owner');
  await page.keyboard.press('e');
  await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('Eva');
  // Typing the title is not hijacked by the keys.
  await row.locator('.title-input').fill('see sam');
  await expect(row.locator('.title-input')).toHaveValue('see sam');
  await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('Eva');
  await row.locator('.title-input').press('Escape');
  await expect(row).toHaveCount(0);
});
