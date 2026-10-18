import { test, expect } from '@playwright/test';

// Attachments: files on any item, listed in the expanded row; renderable
// types open in a new tab, others download; removal is undoable.

const byTitle = async (request, title) => (await (await request.get('/api/items')).json()).find((i) => i.title === title);

test('attach, open/download links, badge, remove and undo', async ({ page, request }) => {
  const gutters = await byTitle(request, 'Clean gutters');
  const maint = await byTitle(request, 'Maintenance');
  try {
    await page.goto('/#/all');
    const row = page.locator('.row.task', { hasText: 'Clean gutters' });
    await expect(row.locator('.attach-badge')).toHaveCount(0);
    await row.locator('.toggle button').click();
    const panel = page.locator(`.attachments[data-attachments="${gutters.id}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.locator('.attach-add')).toHaveText('+');
    await expect(panel.locator('.attach-add')).toHaveAttribute('title', /Attach/);
    await panel.locator('input.attach-input').setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('gutters: north side first') },
      { name: 'survey.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) },
    ]);
    await expect(panel.locator('.attach-chip')).toHaveCount(2);
    const txt = panel.locator('.attach-chip', { hasText: 'notes.txt' });
    const bin = panel.locator('.attach-chip', { hasText: 'survey.bin' });
    await expect(txt).toHaveAttribute('target', '_blank');         // renderable: new tab
    expect(await txt.getAttribute('download')).toBeNull();
    expect(await bin.getAttribute('target')).toBeNull();            // not renderable: download
    await expect(bin).toHaveAttribute('download', 'survey.bin');
    await expect(txt.locator('.attach-size')).toHaveText('25 B');
    // The row shows a paperclip with the count; it opens the row too.
    await expect(row.locator('.attach-badge')).toHaveAttribute('data-attach-count', '2');
    await row.locator('.toggle button').click();
    await expect(panel).toHaveCount(0);
    await row.locator('.attach-badge').click();
    await expect(page.locator(`.attachments[data-attachments="${gutters.id}"]`)).toBeVisible();

    // The server serves renderable types inline and the rest as downloads.
    const it = await byTitle(request, 'Clean gutters');
    expect(it.attachments.map((a) => a.name)).toEqual(['notes.txt', 'survey.bin']);
    const [a, b] = it.attachments;
    const ra = await request.get(`/api/attachments/${a.id}`);
    expect(ra.headers()['content-type']).toBe('text/plain');
    expect(ra.headers()['content-disposition']).toMatch(/^inline/);
    expect(ra.headers()['x-content-type-options']).toBe('nosniff');
    expect(await ra.text()).toBe('gutters: north side first');
    const rb = await request.get(`/api/attachments/${b.id}`);
    expect(rb.headers()['content-disposition']).toMatch(/^attachment/);
    expect((await request.get(`/api/attachments/${a.id}?download=1`)).headers()['content-disposition']).toMatch(/^attachment/);

    // Remove one; Ctrl+Z brings it back.
    const p2 = page.locator(`.attachments[data-attachments="${gutters.id}"]`);
    await p2.locator('.attach-item', { hasText: 'survey.bin' }).locator('.attach-remove').click();
    await expect(p2.locator('.attach-chip')).toHaveCount(1);
    expect((await request.get(`/api/attachments/${b.id}`)).status()).toBe(404);
    await page.waitForTimeout(350);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#toast')).toContainText('Undid removing survey.bin');
    await expect(page.locator(`.attachments[data-attachments="${gutters.id}"] .attach-chip`)).toHaveCount(2);
    expect((await request.get(`/api/attachments/${b.id}`)).status()).toBe(200);

    // Ongoing rows take attachments too.
    await page.locator('.row.parent', { hasText: 'Maintenance' }).locator('.toggle button').click();
    const mp = page.locator(`.attachments[data-attachments="${maint.id}"]`);
    await mp.locator('input.attach-input').setInputFiles([{ name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') }]);
    await expect(mp.locator('.attach-chip', { hasText: 'plan.pdf' })).toHaveAttribute('target', '_blank');
  } finally {
    for (const t of ['Clean gutters', 'Maintenance']) {
      const it = await byTitle(request, t);
      for (const a of it.attachments) await request.delete(`/api/attachments/${a.id}`);
    }
  }
});
