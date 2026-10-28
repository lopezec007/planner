import { test, expect } from '@playwright/test';

// Inline editing (no edit mode), new rows, dependencies, deleting and
// reordering. The tests run in order and share the items they create; they
// only touch their own items so the seeded data used by other specs is left
// alone (apart from a dependency added to and removed from "Clean gutters").
test.describe.configure({ mode: 'serial' });

async function items(request) {
  const res = await request.get('/api/items');
  return res.json();
}
async function byTitle(request, title) {
  return (await items(request)).find((i) => i.title === title);
}
async function userId(request, name) {
  return (await (await request.get('/api/users')).json()).find((u) => u.name === name).id;
}
function ymd(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const newRow = (page) => page.locator('.row[data-editing="new"]:not(.description)');
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (page, title) => page.locator('.title-text', { hasText: new RegExp(`^${esc(title)}$`) });
const taskRow = (page, title) => page.locator('.row.task', { has: exact(page, title) });
const parentRow = (page, title) => page.locator('.row.parent', { has: exact(page, title) });
// Clicking the title text swaps it for an input, so the row can no longer be
// found by its title text; the single open title input is page-wide.
const titleInput = (page) => page.locator('input[name=title]');
// Owner/assignee: the collapsed chip opens the picker; click a user chip to pick
// (clicking the pressed one clears).
const pickUser = async (row, which, name) => {
  await row.locator(`.chip-pick[data-name=${which}]`).click();
  await row.locator(`.user-pick[data-name=${which}] .chip[data-user-name="${name}"]`).click();
};
const editTitle = async (page, row, value) => {
  await row.locator('.title-text').click();
  await titleInput(page).fill(value);
  await titleInput(page).press('Enter');
};
const detailOf = (page, row) => row.locator('xpath=following-sibling::*[1]');

test('New project: a blank row with the title focused; Enter saves with the page status', async ({ page, request }) => {
  await page.goto('/#/all');
  await page.locator('#btn-new-project').click();
  await expect(newRow(page)).toBeVisible();
  await expect(newRow(page).locator('input[name=title]')).toBeFocused();
  await expect(newRow(page).locator('select[name=status]')).toHaveValue('todo');
  // The detail row (description) is open beneath it.
  await expect(page.locator('.row.description[data-editing="new"]')).toBeVisible();
  await pickUser(newRow(page), 'owner', 'Evan');
  await expect(newRow(page).locator('.chip-pick[data-name=owner]')).toHaveText('Eva'); // the choice is visible before saving
  await newRow(page).locator('input[name=title]').fill('E2E Project');
  await newRow(page).locator('input[name=title]').press('Enter');
  await expect(newRow(page)).toHaveCount(0);
  const row = parentRow(page, 'E2E Project');
  await expect(row).toBeVisible();
  const it = await byTitle(request, 'E2E Project');
  expect(it.type).toBe('project');
  expect(it.status).toBe('todo');
  expect(it.owner_id).toBe(await userId(request, 'Evan'));
});

test('New ongoing from the toolbar; Backlog defaults to backlog; discard works', async ({ page, request }) => {
  await page.goto('/#/backlog');
  await expect(page.locator('#btn-new-ongoing')).toBeEnabled(); // Ongoings are listed under Backlog, so one can be added
  await page.locator('#btn-new-project').click();
  await expect(newRow(page).locator('select[name=status]')).toHaveValue('backlog');
  await page.locator('button[title=Discard]').click();
  await expect(newRow(page)).toHaveCount(0);

  await page.locator('.search-preset[data-preset=active]').click();
  await page.locator('#btn-new-ongoing').click();
  await expect(newRow(page).locator('select[name=status]')).toHaveCount(0); // ongoing has no status
  await newRow(page).locator('input[name=title]').fill('Should be discarded');
  await newRow(page).locator('input[name=title]').press('Escape');
  await expect(newRow(page)).toHaveCount(0);
  expect(await byTitle(request, 'Should be discarded')).toBeUndefined();

  await page.locator('#btn-new-ongoing').click();
  await newRow(page).locator('input[name=title]').fill('E2E Ongoing');
  await pickUser(newRow(page), 'assignee', 'Sam');
  await page.locator('button[title=Save]').click();
  await expect(parentRow(page, 'E2E Ongoing')).toBeVisible();
  const it = await byTitle(request, 'E2E Ongoing');
  expect(it.type).toBe('ongoing');
  expect(it.assignee_id).toBe(await userId(request, 'Sam'));
});

test('Saving a new row without a title shows a toast and keeps the row', async ({ page, request }) => {
  await page.goto('/#/all');
  const before = (await items(request)).length;
  await page.locator('#btn-new-project').click();
  await page.locator('button[title=Save]').click();
  await expect(page.locator('#toast')).toContainText('title is required');
  await expect(newRow(page)).toBeVisible();
  await page.locator('button[title=Discard]').click();
  expect((await items(request)).length).toBe(before);
});

test('Add task puts a blank task row under the parent and saves it there', async ({ page, request }) => {
  await page.goto('/#/all');
  const project = parentRow(page, 'E2E Project');
  await project.locator('button[title="Add task"]').click();
  await expect(newRow(page)).toHaveAttribute('data-kind', 'task');
  await expect(newRow(page).locator('input[name=urgency]')).toHaveValue('5');
  await newRow(page).locator('input[name=title]').fill('E2E Task A');
  await newRow(page).locator('input[name=urgency]').press('7');
  await newRow(page).locator('input[name=title]').press('Enter');
  await expect(taskRow(page, 'E2E Task A')).toBeVisible();
  const p = await byTitle(request, 'E2E Project');
  const a = await byTitle(request, 'E2E Task A');
  expect(a.parent_id).toBe(p.id);
  expect(a.urgency).toBe(7);
  expect(a.status).toBe('todo');
  for (const t of ['E2E Task B', 'E2E Task C']) {
    await project.locator('button[title="Add task"]').click();
    await newRow(page).locator('input[name=title]').fill(t);
    await newRow(page).locator('input[name=title]').press('Enter');
    await expect(taskRow(page, t)).toBeVisible();
  }
});

test('Click-to-edit every field type on a task', async ({ page, request }) => {
  await page.goto('/#/all');
  const row = taskRow(page, 'E2E Task A');
  // Title.
  await editTitle(page, row, 'E2E Task A2');
  const r2 = taskRow(page, 'E2E Task A2');
  await expect(r2).toBeVisible();
  // Status.
  await r2.locator('select[name=status]').selectOption('in-progress');
  await expect(r2.locator('.status')).toHaveClass(/in-progress/);
  // Owner / assignee: the collapsed chip opens a chip picker (three seeded users).
  await expect(r2.locator('select[name=owner]')).toHaveCount(0);
  await pickUser(r2, 'owner', 'Sam');
  await expect(r2.locator('.chip-pick[data-name=owner]')).toHaveText('Sam');
  await pickUser(r2, 'assignee', 'Evan');
  await expect(r2.locator('.chip-pick[data-name=assignee]')).toHaveText('Eva');
  // Dates: click the text, type into the input (change saves); the tilde marks it approximate until clicked.
  await r2.locator('.date-text[data-field=start_date]').click();
  await r2.locator('input[name=start_date]').fill(ymd(-1));
  await expect(r2.locator('.date-text[data-field=start_date]')).toHaveText(ymd(-1));
  await expect(r2.locator('button[name=start_firm]')).toHaveClass(/approx/);
  await r2.locator('button[name=start_firm]').click();
  await expect(r2.locator('button[name=start_firm]')).toHaveClass(/firm/);
  await r2.locator('.date-text[data-field=end_date]').click();
  await r2.locator('input[name=end_date]').fill(ymd(2));
  await expect(r2.locator('.date-text[data-field=end_date]')).toHaveClass(/hl-warn/); // within a week
  // Urgency / importance single keys: 9, then ` -> 0, then 0 -> 10, then 2.
  // Each key saves at once; wait for the save (and the re-render it causes)
  // before the next key so the presses do not race each other.
  const saved = async (field, v) => expect.poll(async () => (await byTitle(request, 'E2E Task A2'))[field]).toBe(v);
  await r2.locator('input[name=urgency]').press('9');
  await saved('urgency', 9);
  await expect(r2.locator('input[name=urgency]')).toHaveValue('9');
  await expect(r2.locator('input[name=urgency]')).toHaveClass(/hl-level/);
  await r2.locator('input[name=importance]').press('`');
  await saved('importance', 0);
  await expect(r2.locator('input[name=importance]')).toHaveValue('0');
  await r2.locator('input[name=importance]').press('0');
  await saved('importance', 10);
  await expect(r2.locator('input[name=importance]')).toHaveValue('10');
  await r2.locator('input[name=importance]').press('2');
  await saved('importance', 2);
  await expect(r2.locator('input[name=importance]')).toHaveValue('2');
  // Blocked.
  await r2.locator('input[name=blocked]').check();
  await expect(r2).toHaveClass(/blocked/);
  await saved('blocked', true); // the row class comes from the re-render; the API may still be a step behind

  const it = await byTitle(request, 'E2E Task A2');
  expect(it.status).toBe('in-progress');
  expect(it.owner_id).toBe(await userId(request, 'Sam'));
  expect(it.assignee_id).toBe(await userId(request, 'Evan'));
  expect(it.start_date).toBe(ymd(-1));
  expect(it.start_firm).toBe(true);
  expect(it.end_date).toBe(ymd(2));
  expect(it.end_firm).toBe(false);
  expect(it.urgency).toBe(9);
  expect(it.importance).toBe(2);
  expect(it.blocked).toBe(true);
});

test('Clearing fields, Escape reverts, and an empty title is rejected', async ({ page, request }) => {
  await page.goto('/#/all');
  const row = taskRow(page, 'E2E Task A2');
  // Clear the start date by emptying the input.
  await row.locator('.date-text[data-field=start_date]').click();
  await row.locator('input[name=start_date]').fill('');
  await expect(row.locator('.date-text[data-field=start_date]')).toHaveText('');
  await expect(row.locator('button[name=start_firm]')).toBeHidden();
  // Clicking the pressed owner chip clears the owner; assignee switches to Alex.
  await pickUser(row, 'owner', 'Sam');
  await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('');
  await pickUser(row, 'assignee', 'Alex');
  await expect(row.locator('.chip-pick[data-name=assignee]')).toHaveText('Ale');
  // Escape in the title reverts without saving.
  await row.locator('.title-text').click();
  await titleInput(page).fill('Not saved');
  await titleInput(page).press('Escape');
  await expect(row.locator('.title-text')).toHaveText('E2E Task A2');
  // An empty title is rejected and restored.
  await editTitle(page, row, '');
  await expect(page.locator('#toast')).toContainText('title is required');
  await expect(row.locator('.title-text')).toHaveText('E2E Task A2');
  await row.locator('input[name=blocked]').uncheck();
  await expect.poll(async () => (await byTitle(request, 'E2E Task A2')).blocked).toBe(false); // the last save has landed

  const it = await byTitle(request, 'E2E Task A2');
  expect(it.start_date).toBeNull();
  expect(it.start_firm).toBe(false);
  expect(it.end_date).toBe(ymd(2));
  expect(it.owner_id).toBeNull();
  expect(it.assignee_id).toBe(await userId(request, 'Alex'));
  expect(it.blocked).toBe(false);
  expect(it.title).toBe('E2E Task A2');
});

test('Description edits in place in the expanded row', async ({ page, request }) => {
  await page.goto('/#/all');
  const row = taskRow(page, 'E2E Task A2');
  await row.locator('.toggle button').click();
  const detail = detailOf(page, row);
  await expect(detail.locator('.md.placeholder')).toBeVisible();
  await detail.locator('.md').click();
  await detail.locator('textarea[name=description]').fill('Edited **description**');
  await detail.locator('textarea[name=description]').press('Control+Enter');
  await expect(detailOf(page, taskRow(page, 'E2E Task A2')).locator('.md strong')).toHaveText('description');
  expect((await byTitle(request, 'E2E Task A2')).description).toBe('Edited **description**');
  // Escape discards.
  const d2 = detailOf(page, taskRow(page, 'E2E Task A2'));
  await d2.locator('.md').click();
  await d2.locator('textarea[name=description]').fill('discard me');
  await d2.locator('textarea[name=description]').press('Escape');
  await expect(d2.locator('.md strong')).toHaveText('description');
});

test('Dependencies: add, lock Blocked, reject cycles, remove', async ({ page, request }) => {
  await page.goto('/#/all');
  const a2 = taskRow(page, 'E2E Task A2');
  await a2.locator('.toggle button').click();
  let detail = detailOf(page, a2);
  // Clean gutters (todo, open) blocks E2E Task A2.
  const gutters = await byTitle(request, 'Clean gutters');
  await detail.locator('[data-deps=blocked_by] .dep-add-btn').click();
  await detail.locator('[data-deps=blocked_by] select.dep-add').selectOption(String(gutters.id));
  const chip = detailOf(page, taskRow(page, 'E2E Task A2')).locator(`[data-deps=blocked_by] .dep-chip.open[data-id="${gutters.id}"]`);
  await expect(chip.locator('.dep-key')).toHaveText(gutters.key); // key only; the rest is in the tooltip
  await chip.hover();
  await expect(page.locator('.item-tip')).toBeVisible();
  await expect(page.locator('.item-tip')).toContainText('Clean gutters');
  await page.mouse.move(5, 500);
  const locked = taskRow(page, 'E2E Task A2');
  await expect(locked).toHaveClass(/blocked/);
  await expect(locked.locator('input[name=blocked]')).toBeChecked();
  await expect(locked.locator('input[name=blocked]')).toBeDisabled();
  expect((await byTitle(request, 'E2E Task A2')).blocked_by).toEqual([gutters.id]);
  expect((await byTitle(request, 'E2E Task A2')).blocked).toBe(false); // the stored flag is untouched

  // The other side shows it under "Blocks"; the reverse edge is rejected.
  const g = taskRow(page, 'Clean gutters');
  await g.locator('.toggle button').click();
  const gd = detailOf(page, g);
  await expect(gd.locator(`[data-deps=blocks] .dep-chip[data-id="${(await byTitle(request, 'E2E Task A2')).id}"]`)).toBeVisible();
  const a2id = (await byTitle(request, 'E2E Task A2')).id;
  await gd.locator('[data-deps=blocked_by] .dep-add-btn').click();
  await gd.locator('[data-deps=blocked_by] select.dep-add').selectOption(String(a2id));
  await expect(page.locator('#toast')).toContainText('That would create a cycle');

  // A closed blocker does not lock: E2E Task B (done) blocks A2 too.
  const b = taskRow(page, 'E2E Task B');
  await b.locator('select[name=status]').selectOption('done');
  const bid = (await byTitle(request, 'E2E Task B')).id;
  detail = detailOf(page, taskRow(page, 'E2E Task A2'));
  await detail.locator('[data-deps=blocked_by] .dep-add-btn').click();
  await detail.locator('[data-deps=blocked_by] select.dep-add').selectOption(String(bid));
  await expect(detailOf(page, taskRow(page, 'E2E Task A2')).locator(`[data-deps=blocked_by] .dep-chip.closed[data-id="${(await byTitle(request, 'E2E Task B')).id}"]`)).toBeVisible();
  // Remove the open blocker: unlocked again (the closed one remains).
  detail = detailOf(page, taskRow(page, 'E2E Task A2'));
  await detail.locator(`.dep-chip[data-id="${gutters.id}"]`).locator('.dep-remove').click();
  const free = taskRow(page, 'E2E Task A2');
  await expect(free).not.toHaveClass(/blocked/);
  await expect(free.locator('input[name=blocked]')).toBeEnabled();
  expect((await byTitle(request, 'E2E Task A2')).blocked_by).toEqual([bid]);
  expect((await byTitle(request, 'Clean gutters')).blocks).toEqual([]);
});

test('A project blocked by an open project shows the locked state', async ({ page }) => {
  await page.goto('/#/all');
  const garden = parentRow(page, 'Spring garden'); // seeded: blocked by Kitchen remodel (in progress)
  await expect(garden).toHaveClass(/blocked/);
  await expect(garden.locator('input[name=blocked]')).toBeChecked();
  await expect(garden.locator('input[name=blocked]')).toBeDisabled();
  await expect(parentRow(page, 'Kitchen remodel').locator('input[name=blocked]')).toHaveCount(0);
});

test('Beside the Timeline only the title is editable in the row; the expanded row still works', async ({ page, request }) => {
  await page.goto('/#/all');
  await page.locator('button[data-view=timeline]').click();
  await expect(page.locator('.table.title-only')).toBeVisible();
  const row = taskRow(page, 'E2E Task B');
  await expect(row.locator('select[name=status]')).toHaveCount(0);
  await editTitle(page, row, 'E2E Task B2');
  await expect(taskRow(page, 'E2E Task B2')).toBeVisible();
  expect(await byTitle(request, 'E2E Task B2')).toBeDefined();
  await taskRow(page, 'E2E Task B2').locator('.toggle button').click();
  await expect(detailOf(page, taskRow(page, 'E2E Task B2')).locator('.deps')).toBeVisible();
  await page.locator('button[data-view=table]').click();
});

test('With more than three users the picker is a dropdown', async ({ page, request }) => {
  const res = await request.post('/api/users', { data: { name: 'E2E Fourth' } });
  const u = await res.json();
  try {
    await page.goto('/#/all');
    const row = taskRow(page, 'Clean gutters');
    await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('Eva');
    await row.locator('.chip-pick[data-name=owner]').click();
    await expect(row.locator('select[name=owner]')).toBeVisible();
    await expect(row.locator('select[name=owner] option')).toHaveCount(5); // blank + 4 users
    await expect(row.locator('.user-pick')).toHaveCount(0);
    await row.locator('select[name=owner]').evaluate((e) => e.blur()); // closes without a change
    await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('Eva');
  } finally {
    await request.delete(`/api/users/${u.id}`);
  }
});

test('Reorder tasks and top-level rows by drag-and-drop; drop into another parent; order persists', async ({ page, request }) => {
  // Source and target of each drag must both be on screen: a scroll between
  // mouse-down and the first move would start the drag on whatever row ends
  // up under the pointer.
  await page.setViewportSize({ width: 1500, height: 1500 });
  await page.goto('/#/all');
  const p = await byTitle(request, 'E2E Project');
  const taskOrder = async () => (await items(request)).filter((i) => i.parent_id === p.id).map((i) => i.title);
  expect(await taskOrder()).toEqual(['E2E Task A2', 'E2E Task B2', 'E2E Task C']);

  // Drag C's handle onto the top half of B2: C goes before B2.
  await taskRow(page, 'E2E Task C').locator('.drag-handle').dragTo(taskRow(page, 'E2E Task B2'), { targetPosition: { x: 200, y: 4 } });
  await expect.poll(taskOrder).toEqual(['E2E Task A2', 'E2E Task C', 'E2E Task B2']);
  await page.reload();
  expect(await taskOrder()).toEqual(['E2E Task A2', 'E2E Task C', 'E2E Task B2']);

  // Dropping above another parent's task moves it there, in that position.
  const maint = await byTitle(request, 'Maintenance');
  await taskRow(page, 'E2E Task B2').locator('.drag-handle').dragTo(taskRow(page, 'Clean gutters'), { targetPosition: { x: 200, y: 4 } });
  await expect(taskRow(page, 'E2E Task B2')).toHaveAttribute('data-parent', String(maint.id));
  const maintOrder = (await items(request)).filter((i) => i.parent_id === maint.id).map((i) => i.title);
  expect(maintOrder.indexOf('E2E Task B2')).toBe(maintOrder.indexOf('Clean gutters') - 1);
  // Dropping onto a parent row moves the task to the start of that parent's tasks.
  await taskRow(page, 'E2E Task B2').locator('.drag-handle').dragTo(parentRow(page, 'E2E Project'), { targetPosition: { x: 200, y: 10 } });
  await expect(taskRow(page, 'E2E Task B2')).toHaveAttribute('data-parent', String(p.id));
  expect(await taskOrder()).toEqual(['E2E Task B2', 'E2E Task A2', 'E2E Task C']);

  // Top-level: drag E2E Ongoing above E2E Project.
  const topOrder = async () => (await items(request)).filter((i) => i.parent_id == null).map((i) => i.title);
  let order = await topOrder();
  expect(order.indexOf('E2E Project')).toBeLessThan(order.indexOf('E2E Ongoing'));
  await parentRow(page, 'E2E Ongoing').locator('.drag-handle').dragTo(parentRow(page, 'E2E Project'), { targetPosition: { x: 200, y: 4 } });
  await expect.poll(async () => { const o = await topOrder(); return o.indexOf('E2E Ongoing') < o.indexOf('E2E Project'); }).toBe(true);
  order = await topOrder();
  expect(order.indexOf('File taxes')).toBeLessThan(order.indexOf('E2E Ongoing')); // hidden siblings keep their place
});

test('Urgency and Importance accept digits only', async ({ page, request }) => {
  await page.goto('/#/all');
  const row = taskRow(page, 'E2E Task C');
  const inp = row.locator('input[name=urgency]');
  await expect(inp).toHaveAttribute('inputmode', 'numeric');
  const v = await inp.inputValue();
  await inp.click();
  for (const key of ['e', 'a', '+', '-', '.', 'x']) {
    await inp.press(key);
    await expect(inp).toHaveValue(v);
  }
  await inp.press('ArrowRight'); // navigation keys pass
  await expect(inp).toHaveValue(v);
  await page.keyboard.insertText('99'); // pasted text that is not a value on its own is dropped
  await expect(inp).toHaveValue(v);
  await inp.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  expect((await byTitle(request, 'E2E Task C')).urgency).toBe(Number(v));
});

test('Importance takes -1 from the "-" key; urgency ignores it', async ({ page, request }) => {
  await page.goto('/#/all');
  const row = taskRow(page, 'E2E Task C');
  const imp = row.locator('input[name=importance]');
  const urg = row.locator('input[name=urgency]');
  await expect(imp).toHaveAttribute('min', '-1');
  await expect(urg).toHaveAttribute('min', '0');
  const u = await urg.inputValue();
  await urg.click();
  await urg.press('-');
  await expect(urg).toHaveValue(u);
  await imp.click();
  await imp.press('-');
  await expect.poll(async () => (await byTitle(request, 'E2E Task C')).importance).toBe(-1);
  await expect(taskRow(page, 'E2E Task C').locator('input[name=importance]')).toHaveValue('-1');
  await expect(taskRow(page, 'E2E Task C').locator('input[name=importance]')).not.toHaveClass(/hl-level/); // off the colour ramp
  // Pasted "-1" is dropped by urgency and kept by importance.
  await taskRow(page, 'E2E Task C').locator('input[name=urgency]').click();
  await page.keyboard.insertText('-1');
  await expect(taskRow(page, 'E2E Task C').locator('input[name=urgency]')).toHaveValue(u);
  await page.keyboard.press('Escape');
  await taskRow(page, 'E2E Task C').locator('input[name=importance]').press('3');
  await expect.poll(async () => (await byTitle(request, 'E2E Task C')).importance).toBe(3);
  expect((await byTitle(request, 'E2E Task C')).urgency).toBe(Number(u));
});

test('Delete a task and a parent (with its tasks)', async ({ page, request }) => {
  await page.goto('/#/all');
  page.on('dialog', (d) => d.accept());
  await taskRow(page, 'E2E Task C').locator('button[title=Delete]').click();
  await expect(taskRow(page, 'E2E Task C')).toHaveCount(0);
  expect(await byTitle(request, 'E2E Task C')).toBeUndefined();

  await parentRow(page, 'E2E Project').locator('button[title=Delete]').click();
  await expect(parentRow(page, 'E2E Project')).toHaveCount(0);
  await expect(taskRow(page, 'E2E Task B2')).toHaveCount(0);
  expect(await byTitle(request, 'E2E Task B2')).toBeUndefined();

  await parentRow(page, 'E2E Ongoing').locator('button[title=Delete]').click();
  await expect(parentRow(page, 'E2E Ongoing')).toHaveCount(0);
  expect(await byTitle(request, 'E2E Task A2')).toBeUndefined();
});
