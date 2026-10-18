import { test, expect } from '@playwright/test';

// Icon groups for Nested/Flat and Wide/Narrow, the Columns popover under its
// button, the "+" buttons and layout of the dependencies and attachments
// sections, the longer cycle snack, and the Ongoing/Project colours with the
// per-user colour-coding options.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const rowVar = (loc) => loc.evaluate((e) => e.style.getPropertyValue('--row-color'));
const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);

test('Nested/Flat and Wide/Narrow are icon groups like the view switch', async ({ page }) => {
  await page.goto('/#/all');
  for (const [id, hint] of [['btn-nested', /Nested/], ['btn-flat', /Flat/], ['btn-wide', /Wide/], ['btn-narrow', /Narrow/]]) {
    const b = page.locator(`#${id}`);
    await expect(b.locator('svg')).toHaveCount(1);
    await expect(b).toHaveAttribute('title', hint);
    expect((await b.textContent()).trim()).toBe('');
  }
  await expect(page.locator('.group[aria-label=Layout] button')).toHaveCount(2);
  // Each pair's two icons are different drawings.
  const svg = (id) => page.locator(`#${id} svg`).evaluate((e) => e.innerHTML);
  expect(await svg('btn-wide')).not.toBe(await svg('btn-narrow'));
  expect(await svg('btn-nested')).not.toBe(await svg('btn-flat'));
  await expect(page.locator('.group[aria-label=Width] button')).toHaveCount(2);
  await expect(page.locator('#btn-nested')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-flat')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#btn-flat').click();
  await expect(page.locator('.table')).toHaveClass(/flat/);
  await expect(page.locator('#btn-flat')).toHaveClass(/active/);
  await page.locator('#btn-flat').click(); // already on: stays on
  await expect(page.locator('.table')).toHaveClass(/flat/);
  await page.locator('#btn-nested').click();
  await expect(page.locator('.table')).not.toHaveClass(/flat/);
  await expect(page.locator('#btn-wide')).toHaveClass(/active/);
  await page.locator('#btn-narrow').click();
  await expect(page.locator('.table-wrap')).toHaveClass(/constrained/);
  await page.locator('button[data-view=matrix]').click();
  await expect(page.locator('#btn-wide')).toBeDisabled();
  await expect(page.locator('#btn-narrow')).toBeDisabled();
  await expect(page.locator('#btn-narrow')).toHaveAttribute('title', /applies to the Table view/);
  await page.locator('button[data-view=table]').click();
  await page.locator('#btn-wide').click();
  await expect(page.locator('.table-wrap')).not.toHaveClass(/constrained/);
});

test('the Columns panel opens right under its button', async ({ page }) => {
  await page.goto('/#/all');
  await page.locator('#btn-columns').click();
  const btn = await page.locator('#btn-columns').boundingBox();
  const panel = await page.locator('#columns-panel').boundingBox();
  expect(panel.y).toBeGreaterThanOrEqual(btn.y + btn.height);
  expect(panel.y).toBeLessThan(btn.y + btn.height + 10);
  expect(Math.abs(panel.x + panel.width - (btn.x + btn.width))).toBeLessThan(2); // right edges aligned
  expect(panel.x + panel.width).toBeLessThan(1500 - 100); // not pinned to the window's right edge
  await page.keyboard.press('Escape');
  await expect(page.locator('#columns-panel')).toBeHidden();
});

test('dependencies and attachments use small + buttons; attachment chips sit below their header, left-aligned', async ({ page, request }) => {
  const insurance = await byTitle(request, 'Pay insurance'); // blocked by Review budget
  const uploaded = await (await request.post(`/api/items/${insurance.id}/attachments`, { multipart: {
    file: { name: 'quote.txt', mimeType: 'text/plain', buffer: Buffer.from('renewal quote') },
  } })).json();
  try {
    await page.goto('/#/all');
    await page.locator('.row.task', { hasText: 'Pay insurance' }).locator('.toggle button').click();
    const detail = page.locator(`.row.description[data-desc-for="${insurance.id}"]`);
    // Dependencies: a "+" per list, no dropdown until it is clicked.
    const addBtn = detail.locator('[data-deps=blocks] .dep-add-btn');
    await expect(addBtn).toHaveText('+');
    expect((await addBtn.boundingBox()).width).toBeLessThan(24);
    await expect(detail.locator('select.dep-add')).toHaveCount(0);
    await addBtn.click();
    await expect(detail.locator('[data-deps=blocks] select.dep-add')).toBeVisible();
    await expect(detail.locator('[data-deps=blocks] select.dep-add option').first()).toHaveText('Choose an item…');
    await page.mouse.click(5, 700); // elsewhere: back to the "+"
    await expect(detail.locator('[data-deps=blocks] select.dep-add')).toHaveCount(0);
    await expect(detail.locator('[data-deps=blocks] .dep-add-btn')).toBeVisible();
    // Attachments: header + "+" on one line, the chips below, flush left.
    const files = page.locator(`.attachments[data-attachments="${insurance.id}"]`);
    await expect(files.locator('.attach-add')).toHaveText('+');
    expect((await files.locator('.attach-add').boundingBox()).width).toBeLessThan(24);
    const head = await files.locator('.attach-head').boundingBox();
    const label = await files.locator('.attach-label').boundingBox();
    const plus = await files.locator('.attach-add').boundingBox();
    const chip = await files.locator('.attach-item').first().boundingBox();
    const box = await files.boundingBox();
    expect(Math.abs(plus.y + plus.height / 2 - (label.y + label.height / 2))).toBeLessThan(4); // same line
    expect(chip.y).toBeGreaterThanOrEqual(head.y + head.height - 1);                          // below the header
    expect(Math.abs(chip.x - label.x)).toBeLessThan(2);                                        // left-aligned under the header
    expect(chip.x - box.x).toBeLessThan(14);                                                   // just the frame's padding
    // Both sections sit in a subtle frame.
    for (const sec of [files, detail.locator('.deps')]) {
      expect(await sec.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('1px');
      expect(await sec.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('solid');
      expect(parseFloat(await sec.evaluate((e) => getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThan(2);
    }
    // Still to the right of the dependencies, on the same line as them.
    const deps = await detail.locator('.deps').boundingBox();
    expect(box.x).toBeGreaterThan(deps.x + deps.width - 1);
    expect(Math.abs(box.y - deps.y)).toBeLessThan(8);
  } finally {
    for (const a of uploaded) await request.delete(`/api/attachments/${a.id}`);
  }
});

test('the cycle message is capitalised and stays up longer', async ({ page, request }) => {
  const insurance = await byTitle(request, 'Pay insurance'); // Review budget blocks it
  const budget = await byTitle(request, 'Review budget');
  await page.goto('/#/all');
  await page.locator('.row.task', { hasText: 'Review budget' }).locator('.toggle button').click();
  const detail = page.locator(`.row.description[data-desc-for="${budget.id}"]`);
  await detail.locator('[data-deps=blocked_by] .dep-add-btn').click();
  const t0 = Date.now();
  await detail.locator('[data-deps=blocked_by] select.dep-add').selectOption(String(insurance.id));
  const toast = page.locator('#toast');
  await expect(toast).toContainText(/^That would create a cycle/);
  await page.waitForTimeout(5000 - (Date.now() - t0)); // a normal snack is gone after 4 s
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 6000 });
  await expect(detail.locator('[data-deps=blocked_by] .dep-add-btn')).toBeVisible(); // the dropdown went away
  expect((await byTitle(request, 'Review budget')).blocked_by).toEqual([]);
});

test('an Ongoing or Project gets a colour of its own from the swatch; rows, bars and points can follow it', async ({ page, request }) => {
  const kitchen = await byTitle(request, 'Kitchen remodel');
  const settings = await (await request.get('/api/settings')).json();
  try {
    await page.goto('/#/all');
    const kRow = () => page.locator('.row.parent', { hasText: 'Kitchen remodel' });
    const gRow = () => page.locator('.row.parent', { hasText: 'Spring garden' });
    const tRow = () => page.locator('.row.task', { hasText: 'Order countertops' });
    await expect(page.locator('.row.parent .color-swatch')).toHaveCount(await page.locator('.row.parent').count());
    await expect(page.locator('.row.task .color-swatch')).toHaveCount(0);
    const swatch = kRow().locator('.color-swatch');
    await expect(swatch).toHaveClass(/type/);
    await expect(swatch).toHaveCSS('background-color', rgb(settings.color_project));
    await expect(swatch).toHaveAttribute('title', /Project colour from Settings/);
    const before = await bg(kRow());
    expect(before).toBe(await bg(gRow()));

    // Pick from the palette: saved on the item, everyone's row shows it.
    await swatch.click();
    const pop = page.locator('.color-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.color-opt')).toHaveCount(12);
    await expect(pop.locator('.color-none')).toBeDisabled();
    const popBox = await pop.boundingBox(), swBox = await swatch.boundingBox();
    expect(popBox.y).toBeGreaterThan(swBox.y + swBox.height);
    await pop.locator('.color-opt[data-color="#e15759"]').click();
    await expect(pop).toBeHidden();
    await expect.poll(async () => (await byTitle(request, 'Kitchen remodel')).color).toBe('#e15759');
    await expect(kRow().locator('.color-swatch')).toHaveClass(/own/);
    await expect(kRow().locator('.color-swatch')).toHaveCSS('background-color', rgb('#e15759'));
    expect(await rowVar(kRow())).toBe('#e15759');
    expect(await bg(kRow())).not.toBe(before);
    expect(await bg(gRow())).toBe(before);              // other projects keep the type colour
    expect(await rowVar(tRow())).toBe('');              // tasks: the Task tint, by default
    // A click on the swatch of another row moves the popover; Escape closes it.
    await gRow().locator('.color-swatch').click();
    await expect(page.locator('.color-pop')).toHaveAttribute('data-color-for', String((await byTitle(request, 'Spring garden')).id));
    await page.keyboard.press('Escape');
    await expect(page.locator('.color-pop')).toHaveCount(0);

    // Colours menu (per user): tasks in their parent's colour.
    await page.locator('#btn-colors').click();
    await expect(page.locator('#colors-panel')).toBeVisible();
    await page.locator('#colors-panel input[name=task-colors][value=parent]').check();
    expect(await rowVar(tRow())).toBe('#e15759');
    expect(await rowVar(page.locator('.row.task', { hasText: 'Buy seeds' }))).toBe(settings.color_project); // its project has no own colour
    await expect(page.locator('#btn-colors')).toHaveClass(/active/);
    // ...and the type colours instead of the items' own (the menu stays open, like Sort and Columns).
    await expect(page.locator('#colors-panel')).toBeVisible();
    await page.locator('#colors-panel input[name=parent-colors][value=type]').check();
    expect(await rowVar(kRow())).toBe(settings.color_project);
    expect(await rowVar(tRow())).toBe(settings.color_project);
    await expect(kRow().locator('.color-swatch')).toHaveCSS('background-color', rgb(settings.color_project));
    await expect(kRow().locator('.color-swatch')).toHaveAttribute('title', /shows the type colour instead/);
    await page.reload(); // preferences
    await expect(page.locator('.row.parent', { hasText: 'Kitchen remodel' })).toBeVisible();
    expect(await rowVar(kRow())).toBe(settings.color_project);
    await page.locator('#btn-colors').click();
    await page.locator('#colors-panel input[name=parent-colors][value=custom]').check();
    expect(await rowVar(kRow())).toBe('#e15759');
    await page.keyboard.press('Escape');

    // Timeline: bars and bands by Ongoing / Project.
    await page.locator('button[data-view=timeline]').click();
    await expect(page.locator('#panel .timeline-canvas')).toBeVisible();
    expect(await page.locator('#timeline-color option').allTextContents()).toContain('Ongoing / Project');
    await page.locator('#timeline-color').selectOption('parent');
    await expect(page.locator('#timeline-color')).toHaveValue('parent');
    const bar = page.locator(`.timeline-bar[data-id="${(await byTitle(request, 'Order countertops')).id}"]`);
    await expect(bar).toHaveCSS('background-color', rgb('#e15759'));
    await expect(page.locator(`.timeline-bar[data-id="${kitchen.id}"]`)).toHaveCSS('background-color', rgb('#e15759'));
    expect(await rowVar(page.locator(`.timeline-row[data-id="${kitchen.id}"]`))).toBe('#e15759');
    expect(await rowVar(page.locator(`.timeline-row[data-id="${(await byTitle(request, 'Order countertops')).id}"]`))).toBe('#e15759'); // task_colors = parent
    await bar.hover();
    await expect(page.locator('.timeline-tooltip')).toContainText('Project: P-1 Kitchen remodel');
    await page.mouse.move(5, 5);
    // The swatch is on the title-only table too.
    await expect(page.locator('.table.title-only .row.parent', { hasText: 'Kitchen remodel' }).locator('.color-swatch')).toBeVisible();

    // Matrix: points by Ongoing / Project.
    await page.locator('button[data-view=matrix]').click();
    await expect(page.locator('.matrix-plot')).toBeVisible();
    const sel = page.locator('#matrix-color');
    await expect(sel).toHaveValue('assignee');
    expect(await sel.locator('option').allTextContents()).toEqual(['Assignee', 'Owner', 'Ongoing / Project']);
    await sel.selectOption('parent');
    await expect(page.locator('#matrix-color')).toHaveValue('parent');
    await expect(page.locator('.matrix-plot .pt[data-key="T-9"]')).toHaveAttribute('style', /--pt: #e15759/);
    await expect(page.locator('.matrix-plot .pt[data-key="T-14"]')).toHaveAttribute('style', new RegExp(`--pt: ${settings.color_project}`)); // Buy seeds
    await page.locator('#matrix-color').selectOption('owner');
    await expect(page.locator('#matrix-color')).toHaveValue('owner');
    const sam = (await (await request.get('/api/users')).json()).find((u) => u.name === 'Sam');
    await expect(page.locator('.matrix-plot .pt[data-key="T-6"]')).toHaveAttribute('style', new RegExp(`--pt: ${sam.color}`)); // Pay insurance, owned by Sam
    await expect(page.locator('.matrix-plot').locator('g.pt').first()).toBeVisible();
    const plot = await page.locator('.matrix-plot').boundingBox();
    expect(plot.y + plot.height).toBeLessThanOrEqual(900); // the picker above the plot does not push it off screen

    // Back to the type colour from the popover.
    await page.locator('button[data-view=table]').click();
    await kRow().locator('.color-swatch').click();
    await page.locator('.color-pop .color-none').click();
    await expect.poll(async () => (await byTitle(request, 'Kitchen remodel')).color).toBe('');
    await expect(kRow().locator('.color-swatch')).toHaveClass(/type/);
    expect(await bg(kRow())).toBe(before);
  } finally {
    await request.patch(`/api/items/${kitchen.id}`, { data: { color: kitchen.color || '' } });
  }
});

test('the item colour is validated by the API and tasks cannot have one', async ({ request }) => {
  const garden = await byTitle(request, 'Spring garden');
  const seeds = await byTitle(request, 'Buy seeds');
  expect((await request.patch(`/api/items/${garden.id}`, { data: { color: 'red' } })).status()).toBe(400);
  expect((await request.patch(`/api/items/${seeds.id}`, { data: { color: '#112233' } })).status()).toBe(400);
  const ok = await request.patch(`/api/items/${garden.id}`, { data: { color: '#112233' } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).color).toBe('#112233');
  expect((await (await request.patch(`/api/items/${garden.id}`, { data: { color: '' } })).json()).color).toBe('');
  const alex = (await (await request.get('/api/users')).json()).find((u) => u.name === 'Alex');
  const prefs = `/api/users/${alex.id}/prefs`;
  expect((await request.patch(prefs, { data: { parent_colors: 'own' } })).status()).toBe(400);
  expect((await request.patch(prefs, { data: { task_colors: 'parent', point_color: 'parent', bar_color: 'parent', parent_colors: 'type' } })).status()).toBe(200);
  const got = await (await request.get(prefs)).json();
  expect(got).toMatchObject({ task_colors: 'parent', point_color: 'parent', bar_color: 'parent', parent_colors: 'type' });
  await request.patch(prefs, { data: { task_colors: 'type', point_color: 'assignee', bar_color: 'assignee', parent_colors: 'custom' } });
});

test('markdown descriptions render densely: no gaps inside lists, hairline between blocks, newlines as line breaks', async ({ page, request }) => {
  const seeds = await byTitle(request, 'Buy seeds');
  const md = '# Plan\nFirst line\nsecond line\n\n- one\n- two\n  - nested\n- [x] done\n\n1. a\n2. b\n\n> quoted\n\n`code` and more\n\n```\nblock\n```\n\n| h |\n|---|\n| c |';
  try {
    await request.patch(`/api/items/${seeds.id}`, { data: { description: md } });
    await page.goto('/#/all');
    await page.locator('.row.task', { hasText: 'Buy seeds' }).locator('.toggle button').click();
    const box = page.locator(`.row.description[data-desc-for="${seeds.id}"] .md`);
    await expect(box.locator('h1')).toHaveText('Plan');
    const px = (loc, prop) => loc.evaluate((e, p) => parseFloat(getComputedStyle(e)[p]), prop);
    expect(await px(box.locator('h1'), 'fontSize')).toBeLessThan(18);        // a modest heading
    expect(await px(box.locator('h1'), 'marginTop')).toBe(0);                // first block flush
    await expect(box.locator('p').first()).toContainText('First line');
    await expect(box.locator('p').first().locator('br')).toHaveCount(1);     // single newline = line break
    expect(await px(box.locator('p').first(), 'marginBottom')).toBeLessThan(4);
    for (const li of await box.locator('li').all()) {
      expect(await px(li, 'marginTop')).toBe(0);
      expect(await px(li, 'marginBottom')).toBe(0);
    }
    expect(await px(box.locator('ul').first(), 'paddingLeft')).toBeLessThan(22);
    expect(await px(box.locator('ul ul'), 'marginTop')).toBe(0);
    await expect(box.locator('input[type=checkbox]')).toBeChecked();
    expect(await px(box.locator('pre'), 'paddingTop')).toBeLessThan(8);
    expect(await px(box.locator('td'), 'paddingTop')).toBeLessThan(3);
    // Consecutive lines sit one line-height apart: the whole thing is short.
    const lines = md.split('\n').filter((l) => l && !l.startsWith('|---') && l !== '```').length;
    const h = (await box.boundingBox()).height;
    expect(h).toBeLessThan(lines * 23); // ~19px per line at 14px/1.35 plus hairlines, code padding and table borders
  } finally {
    await request.patch(`/api/items/${seeds.id}`, { data: { description: seeds.description || '' } });
  }
});

test('user chips carry a short label edited in Settings; the picker shows chips when they fit and a dropdown otherwise', async ({ page, request }) => {
  const users = await (await request.get('/api/users')).json();
  const evan = users.find((u) => u.name === 'Evan');
  let fourth = null;
  try {
    await page.goto('/#/all');
    const row = page.locator('.row.task', { hasText: 'Clean gutters' });
    await expect(row.locator('.chip-pick[data-name=owner]')).toHaveText('Eva');
    await expect(row.locator('.chip-pick[data-name=owner]')).toHaveAttribute('title', /^Evan/);
    // Three short chips fit in the cell: the picker is the chips, on one line, inside the cell.
    await row.locator('.chip-pick[data-name=assignee]').click();
    const pick = row.locator('.user-pick[data-name=assignee]');
    await expect(pick).toBeVisible();
    await expect(pick.locator('.chip')).toHaveText(['Ale', 'Eva', 'Sam']);
    const cell = await pick.evaluate((e) => e.parentElement.getBoundingClientRect().right);
    const last = await pick.locator('.chip').last().boundingBox();
    expect(last.x + last.width).toBeLessThanOrEqual(cell + 0.5);
    const first = await pick.locator('.chip').first().boundingBox();
    expect(Math.abs(first.y - last.y)).toBeLessThan(1);
    await page.keyboard.press('Escape');
    await expect(row.locator('.chip-pick[data-name=assignee]')).toBeVisible();

    // Edit the label in Settings (max 3 characters), it shows on every chip.
    await page.goto('/#/settings');
    const evanRow = page.locator('.user-row:not(.header)', { has: page.locator('.user-name[value="Evan"]') });
    await expect(evanRow.locator('.user-short')).toHaveAttribute('maxlength', '3');
    await evanRow.locator('.user-short').fill('EL');
    await evanRow.locator('.user-short').press('Enter');
    await expect(evanRow.locator('.chip')).toHaveText('EL');
    await expect.poll(async () => (await (await request.get('/api/users')).json()).find((u) => u.name === 'Evan').short).toBe('EL');
    await evanRow.locator('.user-short').fill('   ');
    await evanRow.locator('.user-short').press('Enter');
    await expect(page.locator('#toast')).toContainText('1 to 3 characters');
    await expect(evanRow.locator('.user-short')).toHaveValue('EL');
    expect((await request.patch(`/api/users/${evan.id}`, { data: { short: 'FOUR' } })).status()).toBe(400);
    await page.goto('/#/all');
    await expect(page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.chip-pick[data-name=owner]')).toHaveText('EL');

    // A fourth user no longer fits: the picker becomes the dropdown.
    fourth = await (await request.post('/api/users', { data: { name: 'Quentin' } })).json();
    expect(fourth.short).toBe('Que');
    await page.reload();
    await page.locator('.row.task', { hasText: 'Clean gutters' }).locator('.chip-pick[data-name=assignee]').click();
    const r2 = page.locator('.row.task', { hasText: 'Clean gutters' });
    await expect(r2.locator('select[name=assignee]')).toBeVisible();
    await expect(r2.locator('.user-pick')).toHaveCount(0);
    await expect(r2.locator('select[name=assignee] option')).toHaveText(['—', 'Alex', 'Evan', 'Quentin', 'Sam']); // full names in the dropdown
  } finally {
    await request.patch(`/api/users/${evan.id}`, { data: { short: evan.short } });
    if (fourth) await request.delete(`/api/users/${fourth.id}`);
  }
});

test('filter settings persist across reloads and follow the account', async ({ page, request, browser }) => {
  const sam = (await (await request.get('/api/users')).json()).find((u) => u.name === 'Sam');
  try {
    await page.goto('/#/');
    await expect(page.locator('.search-preset[data-preset=active]')).toHaveAttribute('aria-pressed', 'true');
    // Browser (no account): pick Backlog and an owner filter, reload.
    await page.locator('.search-preset[data-preset=backlog]').click();
    await page.locator('#btn-filters').click();
    await page.locator('#search-panel select[aria-label=Owner]').selectOption(String(sam.id));
    await expect(page.locator('#btn-filters .search-badge')).toHaveText('2');
    await page.reload();
    await expect(page.locator('.search-preset[data-preset=backlog]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-filters .search-badge')).toHaveText('2');
    await page.locator('#btn-filters').click();
    await expect(page.locator('#search-panel select[aria-label=Owner]')).toHaveValue(String(sam.id));
    await page.keyboard.press('Escape');
    // An explicit filter route still applies (and is remembered).
    await page.goto('/#/ideas');
    await expect(page.locator('.search-preset[data-preset=ideas]')).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/#/');
    await page.reload();
    await expect(page.locator('.search-preset[data-preset=ideas]')).toHaveAttribute('aria-pressed', 'true');
    // Sam's account starts from its own (default) filters; a change is saved to the server.
    await page.locator('#account-select').selectOption(String(sam.id));
    await expect(page.locator('.search-preset[data-preset=active]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.search-preset[data-preset=backlog]').click();
    await expect.poll(async () => JSON.parse((await (await request.get(`/api/users/${sam.id}/prefs`)).json()).filters).statuses).toEqual(['backlog']);
    const other = await browser.newContext({ baseURL: process.env.PLANNER_E2E_BASE });
    const p2 = await other.newPage();
    await p2.goto('/#/');
    await p2.locator('#account-select').selectOption(String(sam.id));
    await expect(p2.locator('.search-preset[data-preset=backlog]')).toHaveAttribute('aria-pressed', 'true');
    await other.close();
    // Back to no account: the browser's own filters return.
    await page.locator('#account-select').selectOption('');
    await expect(page.locator('.search-preset[data-preset=ideas]')).toHaveAttribute('aria-pressed', 'true');
    // Clear is remembered too.
    await page.locator('#btn-search-clear').click();
    await page.reload();
    await expect(page.locator('#btn-search-clear')).toBeDisabled();
    await expect(page.locator('.search-preset[aria-pressed=true]')).toHaveCount(0);
  } finally {
    await request.patch(`/api/users/${sam.id}/prefs`, { data: { filters: '' } });
  }
});

test('an expanded row and its detail row highlight together on hover', async ({ page, request }) => {
  const seeds = await byTitle(request, 'Buy seeds');
  await page.goto('/#/all');
  const row = page.locator('.row.task', { hasText: 'Buy seeds' });
  await row.locator('.toggle button').click();
  const detail = page.locator(`.row.description[data-desc-for="${seeds.id}"]`);
  const hoverBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-hover').trim());
  const toRgb = (v) => { const n = parseInt(v.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  await page.mouse.move(5, 5);
  const restRow = await bg(row), restDetail = await bg(detail);
  expect(restRow).not.toBe(toRgb(hoverBg));
  await row.locator('.key-text').hover();                       // the item row...
  await expect(row).toHaveCSS('background-color', toRgb(hoverBg));
  await expect(detail).toHaveCSS('background-color', toRgb(hoverBg)); // ...lights the detail row too
  await detail.locator('.md').hover();                           // and the other way round
  await expect(detail).toHaveCSS('background-color', toRgb(hoverBg));
  await expect(row).toHaveCSS('background-color', toRgb(hoverBg));
  await page.mouse.move(5, 5);
  await expect(row).toHaveCSS('background-color', restRow);
  await expect(detail).toHaveCSS('background-color', restDetail);
});
