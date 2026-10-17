import { test, expect } from '@playwright/test';

// In-table creating, editing, deleting and reordering. The tests run in
// order and share the items they create; they only touch their own items so
// the seeded data used by smoke.spec.js is left alone.
test.describe.configure({ mode: 'serial' });

async function items(request) {
  const res = await request.get('/api/items');
  return res.json();
}
async function byTitle(request, title) {
  return (await items(request)).find((i) => i.title === title);
}
function ymd(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const newRow = (page) => page.locator('.row[data-editing="new"]:not(.description)');
const editRow = (page) => page.locator('.row[data-editing="edit"]:not(.description)');
const detailRow = (page) => page.locator('.row.edit-detail');

test('New project: blank row with description expanded, saves with page status', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('#btn-new-project').click();
  await expect(newRow(page)).toBeVisible();
  await expect(detailRow(page).locator('textarea')).toBeVisible(); // description pre-expanded
  await expect(newRow(page).locator('input[name=title]')).toBeFocused();
  // Status defaults to the page's new status (todo on Home).
  await expect(newRow(page).locator('select[name=status]')).toHaveValue('todo');

  await newRow(page).locator('input[name=title]').fill('E2E Project');
  await detailRow(page).locator('textarea').fill('Created **in** e2e');
  await newRow(page).locator('select[name=owner]').selectOption({ label: 'Evan' });
  await newRow(page).locator('input[name=end_date]').fill(ymd(30));
  await newRow(page).locator('input[name=title]').press('Enter');

  await expect(newRow(page)).toHaveCount(0);
  const row = page.locator('.row.parent', { hasText: 'E2E Project' });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip')).toHaveText('Evan');
  const it = await byTitle(request, 'E2E Project');
  expect(it.type).toBe('project');
  expect(it.status).toBe('todo');
  expect(it.description).toBe('Created **in** e2e');
  expect(it.end_date).toBe(ymd(30));
});

test('New ongoing from the toolbar; backlog page offers no Ongoing', async ({ page, request }) => {
  await page.goto('/#/backlog');
  await expect(page.locator('#btn-new-ongoing')).toHaveCount(0);
  await page.locator('#btn-new-project').click();
  await expect(newRow(page).locator('select[name=status]')).toHaveValue('backlog');
  await page.locator('button[title=Cancel]').click();
  await expect(newRow(page)).toHaveCount(0);

  await page.goto('/');
  await page.locator('#btn-new-ongoing').click();
  await expect(newRow(page)).toBeVisible();
  await expect(newRow(page).locator('select[name=status]')).toHaveCount(0); // ongoing has no status
  await newRow(page).locator('input[name=title]').fill('E2E Ongoing');
  await newRow(page).locator('select[name=assignee]').selectOption('shared');
  await page.locator('button[title=Save]').click();
  const row = page.locator('.row.parent', { hasText: 'E2E Ongoing' });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip.shared')).toHaveText('Shared');
  const it = await byTitle(request, 'E2E Ongoing');
  expect(it.type).toBe('ongoing');
  expect(it.assignee_shared).toBe(true);
});

test('New row: cancel removes it; empty title shows a validation toast and stays in edit mode', async ({ page, request }) => {
  await page.goto('/');
  const before = (await items(request)).length;
  await page.locator('#btn-new-project').click();
  await newRow(page).locator('input[name=title]').fill('Never saved');
  await newRow(page).locator('input[name=title]').press('Escape');
  await expect(newRow(page)).toHaveCount(0);

  await page.locator('#btn-new-project').click();
  await page.locator('button[title=Save]').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('title is required');
  await expect(newRow(page)).toBeVisible();
  await page.locator('button[title=Cancel]').click();
  await expect(newRow(page)).toHaveCount(0);
  expect((await items(request)).length).toBe(before);
});

test('Add task puts a blank task row under the parent and saves it there', async ({ page, request }) => {
  await page.goto('/');
  const project = page.locator('.row.parent', { hasText: 'E2E Project' });
  for (const [title, urg] of [['E2E Task A', '7'], ['E2E Task B', '3'], ['E2E Task C', '5']]) {
    await project.locator('button[title="Add task"]').click();
    const row = newRow(page);
    await expect(row).toHaveClass(/task/);
    await expect(detailRow(page).locator('textarea')).toBeVisible();
    await expect(row.locator('select[name=status]')).toHaveValue('todo');
    await expect(row.locator('input[name=urgency]')).toHaveValue('5');
    // The blank row sits directly beneath the parent's existing tasks.
    const pid = await project.getAttribute('data-id');
    const prev = row.locator('xpath=preceding-sibling::*[1]');
    const prevId = await prev.getAttribute('data-id');
    const prevParent = await prev.getAttribute('data-parent');
    expect(prevId === pid || prevParent === pid).toBe(true);
    await row.locator('input[name=title]').fill(title);
    await row.locator('input[name=urgency]').fill(urg);
    await row.locator('input[name=title]').press('Enter');
    await expect(page.locator('.row.task', { hasText: title })).toBeVisible();
  }
  const p = await byTitle(request, 'E2E Project');
  const tasks = (await items(request)).filter((i) => i.parent_id === p.id).map((i) => i.title);
  expect(tasks).toEqual(['E2E Task A', 'E2E Task B', 'E2E Task C']);
  const a = await byTitle(request, 'E2E Task A');
  expect(a.urgency).toBe(7);
  expect(a.status).toBe('todo');
});

test('Edit a task: every field type, including Shared assignee and firm dates', async ({ page, request }) => {
  await page.goto('/');
  const row = page.locator('.row.task', { hasText: 'E2E Task A' });
  // Cells are not editable outside edit mode.
  await expect(row.locator('input:not([type=checkbox]), select, textarea, input[type=checkbox]:not([tabindex="-1"])')).toHaveCount(0);
  await row.locator('button[title=Edit]').click();
  const er = editRow(page);
  await expect(er).toBeVisible();
  await expect(er.locator('input[name=title]')).toHaveValue('E2E Task A');
  await expect(detailRow(page).locator('textarea')).toBeVisible();

  await er.locator('input[name=title]').fill('E2E Task A2');
  await detailRow(page).locator('textarea').fill('Edited description');
  await er.locator('select[name=status]').selectOption('in-progress');
  await er.locator('select[name=owner]').selectOption({ label: 'Sam' });
  await er.locator('select[name=assignee]').selectOption('shared');
  await er.locator('input[name=start_date]').fill(ymd(-1));
  await er.locator('input[name=start_firm]').check();
  await er.locator('input[name=end_date]').fill(ymd(2));
  await er.locator('input[name=urgency]').fill('9');
  await er.locator('input[name=importance]').fill('2');
  await er.locator('input[name=blocked]').check();
  await page.locator('button[title=Save]').click();
  await expect(editRow(page)).toHaveCount(0);

  const updated = page.locator('.row.task', { hasText: 'E2E Task A2' });
  await expect(updated).toHaveClass(/blocked/);
  await expect(updated.locator('.chip.shared')).toHaveText('Shared');
  await expect(updated.locator('.firm')).toHaveCount(1);
  await updated.locator('.toggle button').click();
  await expect(page.locator('.row.description', { hasText: 'Edited description' })).toBeVisible();

  const it = await byTitle(request, 'E2E Task A2');
  const sam = (await (await request.get('/api/users')).json()).find((u) => u.name === 'Sam');
  expect(it.status).toBe('in-progress');
  expect(it.owner_id).toBe(sam.id);
  expect(it.assignee_shared).toBe(true);
  expect(it.assignee_id).toBeNull();
  expect(it.start_date).toBe(ymd(-1));
  expect(it.start_firm).toBe(true);
  expect(it.end_date).toBe(ymd(2));
  expect(it.end_firm).toBe(false);
  expect(it.urgency).toBe(9);
  expect(it.importance).toBe(2);
  expect(it.blocked).toBe(true);
});

test('Edit a task: clear a date, clear owner, assign a user, unblock, reparent', async ({ page, request }) => {
  await page.goto('/');
  const row = page.locator('.row.task', { hasText: 'E2E Task A2' });
  await row.locator('button[title=Edit]').click();
  const er = editRow(page);
  await er.locator('input[name=start_date]').fill('');
  await er.locator('select[name=owner]').selectOption('');
  await er.locator('select[name=assignee]').selectOption({ label: 'Alex' });
  await er.locator('input[name=blocked]').uncheck();
  await expect(detailRow(page).locator('select[name=parent]')).toHaveCount(0); // no Parent field: reparent by drag
  await page.locator('button[title=Save]').click();
  await expect(editRow(page)).toHaveCount(0);

  // Reparent by dropping the task onto the E2E Ongoing parent row.
  const ongoing = await byTitle(request, 'E2E Ongoing');
  await page.locator('.row.task', { hasText: 'E2E Task A2' }).locator('.drag-handle')
    .dragTo(page.locator('.row.parent', { hasText: 'E2E Ongoing' }), { targetPosition: { x: 200, y: 10 } });
  await expect(page.locator('.row.task', { hasText: 'E2E Task A2' })).toHaveAttribute('data-parent', String(ongoing.id));

  const it = await byTitle(request, 'E2E Task A2');
  const alex = (await (await request.get('/api/users')).json()).find((u) => u.name === 'Alex');
  expect(it.start_date).toBeNull();
  expect(it.start_firm).toBe(false);
  expect(it.end_date).toBe(ymd(2)); // untouched
  expect(it.owner_id).toBeNull();
  expect(it.assignee_id).toBe(alex.id);
  expect(it.assignee_shared).toBe(false);
  expect(it.blocked).toBe(false);
  expect(it.parent_id).toBe(ongoing.id);
  // Now shown under E2E Ongoing.
  const moved = page.locator('.row.task', { hasText: 'E2E Task A2' });
  await expect(moved).toHaveAttribute('data-parent', String(ongoing.id));
  await expect(moved).not.toHaveClass(/blocked/);
});

test('Edit a project and an ongoing; cancel discards changes', async ({ page, request }) => {
  await page.goto('/');
  const row = page.locator('.row.parent', { hasText: 'E2E Project' });
  await row.locator('button[title=Edit]').click();
  const er = editRow(page);
  await expect(er.locator('input[name=urgency]')).toHaveCount(0);
  await er.locator('input[name=title]').fill('E2E Project (edited)');
  await er.locator('select[name=status]').selectOption('in-progress');
  await er.locator('input[name=end_date]').fill('');
  await er.locator('input[name=start_date]').fill(ymd(-3));
  await er.locator('input[name=start_firm]').check();
  await er.locator('input[name=title]').press('Enter');
  await expect(editRow(page)).toHaveCount(0);
  let it = await byTitle(request, 'E2E Project (edited)');
  expect(it.status).toBe('in-progress');
  expect(it.end_date).toBeNull();
  expect(it.start_date).toBe(ymd(-3));
  expect(it.start_firm).toBe(true);

  // Cancel: Escape restores the original values.
  const ong = page.locator('.row.parent', { hasText: 'E2E Ongoing' });
  await ong.locator('button[title=Edit]').click();
  await expect(editRow(page).locator('input[name=start_date]')).toHaveCount(0); // ongoing has no dates
  await editRow(page).locator('input[name=title]').fill('Should not persist');
  await editRow(page).locator('input[name=title]').press('Escape');
  await expect(editRow(page)).toHaveCount(0);
  await expect(page.locator('.row.parent', { hasText: 'E2E Ongoing' })).toBeVisible();
  expect(await byTitle(request, 'Should not persist')).toBeUndefined();

  // Cancel button also works, and the server rejects an empty title in edit mode.
  await ong.locator('button[title=Edit]').click();
  await editRow(page).locator('input[name=title]').fill('');
  await page.locator('button[title=Save]').click();
  await expect(page.locator('#toast')).toContainText('title is required');
  await expect(editRow(page)).toBeVisible();
  await page.locator('button[title=Cancel]').click();
  await expect(editRow(page)).toHaveCount(0);
  it = await byTitle(request, 'E2E Ongoing');
  expect(it).toBeDefined();
});

test('Only one row may be edited at a time', async ({ page }) => {
  await page.goto('/');
  await page.locator('.row.task', { hasText: 'E2E Task B' }).locator('button[title=Edit]').click();
  await expect(editRow(page)).toHaveCount(1);
  await page.locator('.row.task', { hasText: 'E2E Task C' }).locator('button[title=Edit]').click();
  await expect(page.locator('#toast')).toContainText('Save or cancel');
  await expect(editRow(page)).toHaveCount(1);
  await expect(editRow(page).locator('input[name=title]')).toHaveValue('E2E Task B');
  await page.locator('#btn-new-project').click();
  await expect(newRow(page)).toHaveCount(0);
  await page.locator('button[title=Cancel]').click();
  await expect(editRow(page)).toHaveCount(0);
});

test('Editing works in the title-only table beside the Plan view', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('button[data-view=plan]').click();
  await expect(page.locator('.table.title-only')).toBeVisible();
  const row = page.locator('.row.task', { hasText: 'E2E Task B' });
  await row.locator('button[title=Edit]').click();
  const er = editRow(page);
  await expect(er).toBeVisible();
  // Non-title fields are shown in the detail row in this layout.
  await expect(detailRow(page).locator('select[name=status]')).toBeVisible();
  await expect(detailRow(page).locator('input[name=importance]')).toBeVisible();
  await detailRow(page).locator('input[name=importance]').fill('8');
  await er.locator('input[name=title]').press('Enter');
  await expect(editRow(page)).toHaveCount(0);
  expect((await byTitle(request, 'E2E Task B')).importance).toBe(8);
  await page.locator('button[data-view=table]').click();
});

test('Reorder tasks within a parent and top-level rows by drag-and-drop; order persists', async ({ page, request }) => {
  await page.goto('/');
  const p = await byTitle(request, 'E2E Project (edited)');
  const taskOrder = async () => (await items(request)).filter((i) => i.parent_id === p.id).map((i) => i.title);
  expect(await taskOrder()).toEqual(['E2E Task B', 'E2E Task C']);

  // Drag C's handle onto the top half of B: C goes before B.
  const c = page.locator('.row.task', { hasText: 'E2E Task C' });
  const b = page.locator('.row.task', { hasText: 'E2E Task B' });
  await c.locator('.drag-handle').dragTo(b, { targetPosition: { x: 200, y: 4 } });
  await expect(page.locator('.row.task', { hasText: /E2E Task [BC]/ }).first()).toContainText('E2E Task C');
  expect(await taskOrder()).toEqual(['E2E Task C', 'E2E Task B']);
  await page.reload();
  await expect(page.locator('.row.task', { hasText: /E2E Task [BC]/ }).first()).toContainText('E2E Task C');

  // Dropping a task above another parent's task moves it there, in that position.
  const maint = await byTitle(request, 'Maintenance');
  await page.locator('.row.task', { hasText: 'E2E Task B' }).locator('.drag-handle')
    .dragTo(page.locator('.row.task', { hasText: 'Clean gutters' }), { targetPosition: { x: 200, y: 4 } });
  await expect(page.locator('.row.task', { hasText: 'E2E Task B' })).toHaveAttribute('data-parent', String(maint.id));
  expect((await byTitle(request, 'E2E Task B')).parent_id).toBe(maint.id);
  const maintOrder = (await items(request)).filter((i) => i.parent_id === maint.id).map((i) => i.title);
  expect(maintOrder.indexOf('E2E Task B')).toBe(maintOrder.indexOf('Clean gutters') - 1);
  expect(await taskOrder()).toEqual(['E2E Task C']);
  // Dropping onto a parent row moves the task to the start of that parent's tasks.
  await page.locator('.row.task', { hasText: 'E2E Task B' }).locator('.drag-handle')
    .dragTo(page.locator('.row.parent', { hasText: 'E2E Project (edited)' }), { targetPosition: { x: 200, y: 10 } });
  await expect(page.locator('.row.task', { hasText: 'E2E Task B' })).toHaveAttribute('data-parent', String(p.id));
  expect(await taskOrder()).toEqual(['E2E Task B', 'E2E Task C']);

  // Top-level: drag E2E Ongoing above E2E Project (edited).
  const topOrder = async () => (await items(request)).filter((i) => i.parent_id == null).map((i) => i.title);
  let order = await topOrder();
  expect(order.indexOf('E2E Project (edited)')).toBeLessThan(order.indexOf('E2E Ongoing'));
  const ongoing = page.locator('.row.parent', { hasText: 'E2E Ongoing' });
  const project = page.locator('.row.parent', { hasText: 'E2E Project (edited)' });
  await ongoing.locator('.drag-handle').dragTo(project, { targetPosition: { x: 200, y: 4 } });
  await expect(page.locator('.row.parent', { hasText: /E2E (Ongoing|Project)/ }).first()).toContainText('E2E Ongoing');
  order = await topOrder();
  expect(order.indexOf('E2E Ongoing')).toBeLessThan(order.indexOf('E2E Project (edited)'));
  // Hidden siblings (e.g. backlog project "File taxes") keep their place.
  expect(order.indexOf('File taxes')).toBeLessThan(order.indexOf('E2E Ongoing'));
  await page.reload();
  await expect(page.locator('.row.parent', { hasText: /E2E (Ongoing|Project)/ }).first()).toContainText('E2E Ongoing');
});

test('Delete a task and a parent (with its tasks)', async ({ page, request }) => {
  await page.goto('/');
  page.on('dialog', (d) => d.accept());
  await page.locator('.row.task', { hasText: 'E2E Task C' }).locator('button[title=Delete]').click();
  await expect(page.locator('.row.task', { hasText: 'E2E Task C' })).toHaveCount(0);
  expect(await byTitle(request, 'E2E Task C')).toBeUndefined();

  await page.locator('.row.parent', { hasText: 'E2E Project (edited)' }).locator('button[title=Delete]').click();
  await expect(page.locator('.row.parent', { hasText: 'E2E Project (edited)' })).toHaveCount(0);
  await expect(page.locator('.row.task', { hasText: 'E2E Task B' })).toHaveCount(0);
  expect(await byTitle(request, 'E2E Task B')).toBeUndefined();

  await page.locator('.row.parent', { hasText: 'E2E Ongoing' }).locator('button[title=Delete]').click();
  await expect(page.locator('.row.parent', { hasText: 'E2E Ongoing' })).toHaveCount(0);
  expect(await byTitle(request, 'E2E Task A2')).toBeUndefined();
});
