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
