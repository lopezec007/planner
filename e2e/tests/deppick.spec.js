import { test, expect } from '@playwright/test';

// Adding a dependency: the "+" opens a search box that lists the items whose
// key or title contains what is typed (any part of it, every word), as it is
// typed; Enter or a click adds the highlighted match.

const items = async (request) => (await request.get('/api/items')).json();
const byTitle = async (request, title) => (await items(request)).find((i) => i.title === title);

test('the dependency search box matches any part of the key or title and filters as you type', async ({ page, request }) => {
  const budget = await byTitle(request, 'Review budget');
  const gutters = await byTitle(request, 'Clean gutters');
  const fence = await byTitle(request, 'Fix fence post');
  await page.goto('/#/all');
  await page.locator('.row.task', { hasText: 'Review budget' }).locator('.toggle button').click();
  const detail = page.locator(`.row.description[data-desc-for="${budget.id}"]`);
  await detail.locator('[data-deps=blocked_by] .dep-add-btn').click();
  const input = detail.locator('[data-deps=blocked_by] .dep-pick-input');
  await expect(input).toBeFocused();
  const list = page.locator('.dep-pick-list');
  const opts = list.locator('.dep-pick-opt');
  // Everything but Ongoings and the item itself, before anything is typed; the first is highlighted.
  const all = (await items(request)).filter((i) => i.type !== 'ongoing' && i.id !== budget.id);
  await expect(opts).toHaveCount(all.length);
  await expect(opts.first()).toHaveClass(/active/);
  await expect(opts.first().locator('.dep-pick-key')).toHaveText(all[0].key);
  await expect(opts.first().locator('.dep-pick-title')).toHaveText(all[0].title);
  // The list sits right under the box, on top of everything.
  const ib = await input.boundingBox(), lb = await list.boundingBox();
  expect(lb.y).toBeGreaterThanOrEqual(ib.y + ib.height);
  expect(lb.y).toBeLessThan(ib.y + ib.height + 8);
  expect(Math.abs(lb.x - ib.x)).toBeLessThan(2);

  // Any part of the title, not just the start; case ignored.
  await input.type('utter');
  await expect(opts).toHaveCount(1);
  await expect(opts.first()).toHaveAttribute('data-id', String(gutters.id));
  // Any part of the key.
  await input.fill(fence.key.slice(1)); // "-4" of "T-4": every key containing it
  const keys = await opts.locator('.dep-pick-key').allTextContents();
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) expect(k.toLowerCase()).toContain(fence.key.slice(1).toLowerCase());
  await input.fill(fence.key.toLowerCase());
  await expect(opts.first()).toHaveAttribute('data-id', String(fence.id));
  // Every typed word must match somewhere.
  await input.fill('post fix');
  await expect(opts).toHaveCount(1);
  await expect(opts.first()).toHaveAttribute('data-id', String(fence.id));
  await input.fill('post fizz');
  await expect(opts).toHaveCount(0);
  await expect(list.locator('.dep-pick-empty')).toHaveText('No item matches');
  // Arrow keys move the highlight; Enter adds the highlighted item.
  await input.fill('f');
  const n = await opts.count();
  expect(n).toBeGreaterThan(2);
  await input.press('ArrowDown');
  await expect(opts.nth(1)).toHaveClass(/active/);
  await input.press('ArrowUp');
  await expect(opts.nth(0)).toHaveClass(/active/);
  await input.press('ArrowUp'); // wraps to the end
  await expect(opts.nth(n - 1)).toHaveClass(/active/);
  await input.fill('fence');
  await expect(opts).toHaveCount(1);
  await input.press('Enter');
  await expect.poll(async () => (await byTitle(request, 'Review budget')).blocked_by).toEqual([fence.id]);
  await expect(page.locator('.dep-pick-list')).toHaveCount(0);
  await expect(detail.locator('[data-deps=blocked_by] .dep-chip[data-id="' + fence.id + '"]')).toBeVisible();
  // An item already in the list is not offered again; Escape closes the box.
  await detail.locator('[data-deps=blocked_by] .dep-add-btn').click();
  await expect(page.locator('.dep-pick-list .dep-pick-opt[data-id="' + fence.id + '"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dep-pick-list')).toHaveCount(0);
  await expect(detail.locator('[data-deps=blocked_by] .dep-add-btn')).toBeVisible();
  // Clean up.
  await request.delete(`/api/dependencies/${fence.id}/${budget.id}`);
});
