import { seedXtream } from './fixtures/xtream';
import { test, expect, enterTab, routePlaylist, seedPlaylist, type Page } from './helpers';

// The mirrored layout of a right-to-left locale (docs/rtl-layout.md).

// A string: before app.js the simulation lacks the polyfills Playwright
// needs to return an array.
async function appSheets(page: Page): Promise<string[]> {
  return JSON.parse(await page.evaluate(() => JSON.stringify(
    Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.indexOf('css/') === 0)))) as string[];
}

async function chooseLanguage(page: Page, locale: string): Promise<void> {
  await enterTab(page, 'settings');
  await page.locator('#app-language .dropdown-trigger').click();
  await page.locator(`#app-language [data-dropdown-value="${locale}"]`).click();
  await page.locator('#save-settings').click();
  await expect(page.locator('#view-home')).toBeVisible();
}

test.describe('direction switch', () => {
  test.use({ startOn: 'home' });

  test('a right-to-left language mirrors the stylesheets, and a left-to-right one restores them',
    async ({ page }) => {
      await routePlaylist(page);
      await seedPlaylist(page);
      await page.goto('/');
      await expect(page.locator('#view-home')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');

      await chooseLanguage(page, 'ar');
      expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
      await expect.poll(async () => (await appSheets(page))
        .every((href) => href.startsWith('css/rtl/'))).toBe(true);
      expect(await appSheets(page)).toEqual(
        expect.arrayContaining(['css/rtl/main.css', 'css/rtl/legacy-webos-overrides.css']));
      expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('rtl');

      await chooseLanguage(page, 'en');
      expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
      await expect.poll(async () => (await appSheets(page))
        .every((href) => /^css\/[\w.-]+\.css$/.test(href))).toBe(true);
    });

  test('a right-to-left launch mirrors the first paint, at its interface size', async ({ page }) => {
    // No app.js: what index.html applies before the app runs.
    await page.route('**/js/app.js', (route) => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('iptv_direction', JSON.stringify('rtl'));
      localStorage.setItem('iptv_interface_size', JSON.stringify('120'));
    });
    await page.goto('/');
    // A string: without app.js the simulation lacks the polyfills Playwright
    // needs to return an object.
    expect(JSON.parse(await page.evaluate(() => JSON.stringify({
      dir: document.documentElement.dir,
      direction: getComputedStyle(document.body).direction,
    })))).toEqual({ dir: 'rtl', direction: 'rtl' });
    const sheets = await appSheets(page);
    expect(sheets.length).toBeGreaterThan(10);
    expect(sheets.filter((href) => !href.startsWith('css/rtl/ui-120/'))).toEqual([]);
  });

  test('a launch whose language turned right to left since the last run catches up',
    async ({ page }) => {
      await routePlaylist(page);
      await seedPlaylist(page);
      await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
      await page.goto('/');
      await expect(page.locator('#view-home')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
      await expect.poll(async () => (await appSheets(page))
        .every((href) => href.startsWith('css/rtl/'))).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('iptv_direction'))).toBe('"rtl"');
    });
});

// The focused tile of a rail, its index, and whether it sits whole inside
// the track's box, in screen coordinates.
async function railFocus(page: Page, track: string): Promise<{ index: number; inside: boolean }> {
  return JSON.parse(await page.locator(track).evaluate((el) => {
    const tiles = Array.from(el.children).filter((child) => child.hasAttribute('data-focusable'));
    const focused = el.querySelector('.focused');
    const box = el.getBoundingClientRect();
    const tile = focused?.getBoundingClientRect();
    return JSON.stringify({
      index: focused ? tiles.indexOf(focused) : -1,
      inside: !!tile && tile.left >= box.left - 1 && tile.right <= box.right + 1,
    });
  })) as { index: number; inside: boolean };
}

test.describe('catalog rails', () => {
  test.use({ startOn: 'home' });

  test('a rail starts at the right, and Left walks it toward the left with the tile in view',
    async ({ page }) => {
      await seedXtream(page, { catalog: 'large' });
      await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
      await page.goto('/');
      await enterTab(page, 'movies');
      const track = '#view-movies .catalog-layer-browse [data-rail-key="cat:1"] .catalog-rail-track';
      const tiles = page.locator(`${track} > .catalog-tile`);
      await expect(tiles.first()).toBeVisible();
      const first = (await tiles.nth(0).boundingBox())!;
      const second = (await tiles.nth(1).boundingBox())!;
      expect(second.x + second.width).toBeLessThan(first.x);
      expect(first.x + first.width).toBeGreaterThan(1920 - 80 - 40);
      expect(first.x + first.width).toBeLessThanOrEqual(1920 - 80 + 1);

      // The first key after a pointer tab click only shows the ring.
      await page.keyboard.press('ArrowDown');
      expect((await railFocus(page, track)).index).toBe(0);
      for (let i = 1; i <= 9; i++) {
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => railFocus(page, track)).toEqual({ index: i, inside: true });
      }
      // The rail scrolled toward its end, on the left.
      expect((await tiles.nth(0).boundingBox())!.x).toBeGreaterThan(1920);
      for (let i = 8; i >= 0; i--) {
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => railFocus(page, track)).toEqual({ index: i, inside: true });
      }
      await expect.poll(async () => (await tiles.nth(0).boundingBox())!.x).toBeCloseTo(first.x, 0);
    });

  test('the virtual All Categories rail starts at the right and scrolls left under the pointer',
    async ({ page }) => {
      await seedXtream(page, { catalog: 'large' });
      await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
      await page.goto('/');
      await enterTab(page, 'movies');
      const track = page.locator('#view-movies .catalog-category-rail');
      const cells = track.locator('[data-category-virtual-index]');
      await expect(cells.first()).toBeAttached();
      await track.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const box = (await track.boundingBox())!;
      const cell = async (index: number) =>
        (await track.locator(`[data-category-virtual-index="${index}"]`).boundingBox())!;
      // Cell 0 hugs the track's right edge (its padding aside), cell 1 sits left of it.
      expect(box.x + box.width - ((await cell(0)).x + (await cell(0)).width)).toBeLessThan(90);
      expect((await cell(1)).x + (await cell(1)).width).toBeLessThan((await cell(0)).x);

      // Pointer dwell at the left edge: the rail runs toward its end.
      const start = (await cell(0)).x;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width / 2, y);
      await page.mouse.move(box.x + box.width / 2 + 10, y);
      await page.mouse.move(Math.max(1, box.x) + 20, y, { steps: 4 });
      await expect.poll(async () => (await cell(0)).x, { timeout: 5000 }).toBeGreaterThan(start + 100);
      // And at the right edge back to its start, where it stops.
      await page.mouse.move(Math.min(1919, box.x + box.width) - 20, y, { steps: 4 });
      await expect.poll(async () => Math.abs((await cell(0)).x - start), { timeout: 10_000 })
        .toBeLessThan(2);
    });
});
