import { test, expect, enterTab, pressKeys, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';

// A section the viewer left keeps no pages: entry rebuilds them anyway.
const viewCounts = (page: Page, id: string) => page.locator(`#${id}`).evaluate(view => ({
  nodes: view.querySelectorAll('*').length,
  images: view.querySelectorAll('img').length,
}));

// A 1x1 PNG, so the rails decode real posters.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');

test('Movies releases its pages on leave and restores the remembered tile on return', async ({ page }) => {
  await seedXtream(page, { catalog: 'large' });
  // Registered last, so it answers first: the same titles, with posters.
  await page.route('**/player_api.php*action=get_vod_streams*', (route) => {
    const category = new URL(route.request().url()).searchParams.get('category_id') ?? '1';
    return route.fulfill({ json: Array.from({ length: 50 }, (_, i) => {
      const id = category === '1' && i === 0 ? 10 : Number(category) * 1000 + i;
      return {
        stream_id: id, name: `Movie ${String(id)}`, stream_icon: `http://host/p/${String(id)}.png`,
        container_extension: 'mp4', category_id: category,
      };
    }) });
  });
  await page.route('http://host/p/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.goto('/');
  await enterTab(page, 'movies');
  const tiles = page.locator('#view-movies .catalog-layer-browse .catalog-tile');
  await expect(tiles.first()).toBeVisible();
  // The first key only shows the ring, on the tile entry starts at.
  await pressKeys(page, 38);
  const focused = page.locator('#view-movies .catalog-tile.focused');
  await expect(focused).toHaveCount(1);
  const entry = await focused.getAttribute('data-item-id');
  await pressKeys(page, 39, 39);
  await expect(focused).not.toHaveAttribute('data-item-id', entry!);
  const remembered = await focused.getAttribute('data-item-id');
  expect((await viewCounts(page, 'view-movies')).images).toBeGreaterThan(0);

  // Within the section, browse stays under a detail: Back lands on the tile.
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .catalog-layer-detail .detail-title')).toBeVisible();
  await pressKeys(page, 461);
  await expect(focused).toHaveAttribute('data-item-id', remembered!);

  await enterTab(page, 'home');
  const left = await viewCounts(page, 'view-movies');
  test.info().annotations.push({ type: 'left Movies', description: JSON.stringify(left) });
  expect(left.images).toBe(0);
  expect(left.nodes).toBeLessThan(10);

  // Entry rebuilds the rails and starts where entry always does, one ring.
  await enterTab(page, 'movies');
  await expect(tiles.first()).toBeVisible();
  expect((await viewCounts(page, 'view-movies')).images).toBeGreaterThan(0);
  await pressKeys(page, 38);
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute('data-item-id', entry!);
  await expect(page.locator('.focused:visible')).toHaveCount(1);
});

test('Settings releases its pages on leave and renders them again on return', async ({ page }) => {
  await seedXtream(page);
  await page.goto('/');
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings .settings-view')).toBeVisible();
  await enterTab(page, 'home');
  const left = await viewCounts(page, 'view-settings');
  test.info().annotations.push({ type: 'left Settings', description: JSON.stringify(left) });
  expect(left.nodes).toBeLessThan(10);
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings .settings-view')).toBeVisible();
});
