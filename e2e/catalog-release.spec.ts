import { test, expect, enterTab, pressKeys, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';

// A section the viewer left keeps no pages: entry rebuilds them anyway.
const viewCounts = (page: Page, id: string) => page.locator(`#${id}`).evaluate(view => ({
  nodes: view.querySelectorAll('*').length,
  images: view.querySelectorAll('img').length,
}));

test('Movies releases its pages on leave and restores the remembered tile on return', async ({ page }) => {
  await seedXtream(page, { catalog: 'large', posters: true });
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

test('Red and Blue from Movies and Series release the page they leave', async ({ page }) => {
  await seedXtream(page, { catalog: 'large', posters: true });
  await page.goto('/');
  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies .catalog-layer-browse .catalog-tile').first()).toBeVisible();
  // Red opens the Guide.
  await pressKeys(page, 403);
  await expect(page.locator('#view-channels')).toBeVisible();
  const movies = await viewCounts(page, 'view-movies');
  expect(movies.images).toBe(0);
  expect(movies.nodes).toBeLessThan(10);

  await enterTab(page, 'series');
  await expect(page.locator('#view-series .catalog-layer-browse .catalog-tile').first()).toBeVisible();
  // Blue opens Settings.
  await pressKeys(page, 406);
  await expect(page.locator('#view-settings .settings-view')).toBeVisible();
  const series = await viewCounts(page, 'view-series');
  expect(series.images).toBe(0);
  expect(series.nodes).toBeLessThan(10);

  // Red from Settings releases it too.
  await pressKeys(page, 403);
  await expect(page.locator('#view-channels')).toBeVisible();
  expect((await viewCounts(page, 'view-settings')).nodes).toBeLessThan(10);
});
