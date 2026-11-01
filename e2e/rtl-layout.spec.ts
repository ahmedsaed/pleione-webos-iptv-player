import { seedXtream } from './fixtures/xtream';
import {
  test, expect, enterTab, openGuide, pressKeys, routeLiveManifest, routePlaylist, seedPlaylist,
  type Page,
} from './helpers';

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
      // Back at the start: the unfocused second tile where it began.
      await expect.poll(async () => Math.abs((await tiles.nth(1).boundingBox())!.x - second.x))
        .toBeLessThan(1);
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

test.describe('catalog detail', () => {
  test.use({ startOn: 'home' });

  test('a series page mirrors, and its virtual episode rail walks left', async ({ page }) => {
    await seedXtream(page, { posters: true });
    // Three seasons of twelve episodes.
    await page.route('**/player_api.php*', (route) => {
      if (!route.request().url().includes('get_series_info')) return route.fallback();
      const episodes: Record<string, unknown[]> = {};
      for (let s = 1; s <= 3; s++) {
        episodes[String(s)] = Array.from({ length: 12 }, (_, e) => ({
          id: String(s * 100 + e), title: `Episode ${String(e + 1)}`, season: s, episode_num: e + 1,
          container_extension: 'mp4', info: { duration_secs: 600 },
        }));
      }
      return route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({ info: { name: 'Series One', plot: 'A plot.' }, episodes }) });
    });
    await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
    await page.goto('/');
    await enterTab(page, 'series');
    const detail = page.locator('#view-series .catalog-layer-detail');
    await page.locator('#view-series .catalog-tile[data-item-id="20"]')
      .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
    await page.keyboard.press('Enter');
    const cells = detail.locator('.episode-cell');
    await expect(cells.first()).toBeVisible();

    // The poster on the left, the text column and its actions on the right.
    const poster = (await detail.locator('.detail-poster-wrap').boundingBox())!;
    const body = (await detail.locator('.detail-body').boundingBox())!;
    expect(rightOf(body, poster)).toBe(true);
    expect(body.x + body.width).toBeCloseTo(1920 - 80, -1);
    const actions = detail.locator('.detail-actions > *');
    expect(rightOf((await actions.nth(0).boundingBox())!, (await actions.nth(1).boundingBox())!)).toBe(true);
    // Seasons and episodes start at the right.
    const season = (n: number) => detail.locator(`.series-season-btn[data-season="${String(n)}"]`);
    expect(rightOf((await season(1).boundingBox())!, (await season(2).boundingBox())!)).toBe(true);
    const episode = async (index: number) =>
      (await detail.locator(`.episode-cell[data-episode-index="${String(index)}"]`).boundingBox())!;
    expect(rightOf(await episode(0), await episode(1))).toBe(true);

    // Down to the episodes, then Left along them; the focused one stays in view.
    const track = '#view-series .catalog-layer-detail .episode-track';
    const focusedEpisode = async () => JSON.parse(await page.locator(track).evaluate((el) => {
      const card = el.querySelector('.episode-card.focused');
      const cell = card?.closest('[data-episode-index]');
      const box = el.getBoundingClientRect();
      const r = card?.getBoundingClientRect();
      return JSON.stringify({
        index: cell ? Number(cell.getAttribute('data-episode-index')) : -1,
        inside: !!r && r.left >= box.left - 1 && r.right <= box.right + 1,
      });
    })) as { index: number; inside: boolean };
    for (let i = 0; i < 4 && (await focusedEpisode()).index < 0; i++) await page.keyboard.press('ArrowDown');
    expect(await focusedEpisode()).toEqual({ index: 0, inside: true });
    for (let i = 1; i <= 8; i++) {
      await page.keyboard.press('ArrowLeft');
      await expect.poll(focusedEpisode).toEqual({ index: i, inside: true });
    }
    for (let i = 7; i >= 0; i--) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(focusedEpisode).toEqual({ index: i, inside: true });
    }
  });
});

test.describe('Search', () => {
  test.use({ startOn: 'home' });

  test('results and recent searches start at the right, and Left walks a virtual rail',
    async ({ page }) => {
      await seedXtream(page, { catalog: 'large' });
      await page.addInitScript(() => {
        localStorage.setItem('iptv_locale', JSON.stringify('ar'));
        localStorage.setItem('iptv_search_history', JSON.stringify(['one', 'two']));
      });
      await page.goto('/');
      await enterTab(page, 'search');
      const view = page.locator('#view-search');
      const chips = view.locator('.search-recent-chip');
      await expect(chips).toHaveCount(2);
      expect(rightOf((await chips.nth(0).boundingBox())!, (await chips.nth(1).boundingBox())!)).toBe(true);
      // The clear button ends the row, on the left.
      expect(rightOf((await chips.nth(1).boundingBox())!,
        (await view.locator('[data-history-clear]').boundingBox())!)).toBe(true);

      await view.locator('.search-box-input').fill('Movie 1');
      const cell = (index: number) =>
        view.locator(`.search-rail-cell[data-search-section="movies"][data-search-index="${String(index)}"]`);
      await expect(cell(1)).toBeVisible();
      const first = (await cell(0).boundingBox())!;
      expect(rightOf(first, (await cell(1).boundingBox())!)).toBe(true);
      expect(Math.round(first.x + first.width)).toBe(1920 - 80);

      const focused = async () => JSON.parse(await view.evaluate((el) => {
        const tile = el.querySelector('.search-rail-cell .focused');
        const cellEl = tile?.closest('[data-search-index]');
        const rail = tile?.closest('[data-search-virtual]')?.getBoundingClientRect();
        const r = tile?.getBoundingClientRect();
        return JSON.stringify({
          index: cellEl ? Number(cellEl.getAttribute('data-search-index')) : -1,
          inside: !!r && !!rail && r.left >= rail.left - 1 && r.right <= rail.right + 1,
        });
      })) as { index: number; inside: boolean };
      await view.locator('.search-box-input').press('ArrowDown');
      await expect.poll(focused).toEqual({ index: 0, inside: true });
      for (let i = 1; i <= 12; i++) {
        await page.keyboard.press('ArrowLeft');
        await expect.poll(focused).toEqual({ index: i, inside: true });
      }
      for (let i = 11; i >= 0; i--) {
        await page.keyboard.press('ArrowRight');
        await expect.poll(focused).toEqual({ index: i, inside: true });
      }
      expect(Math.round((await cell(0).boundingBox())!.x)).toBe(Math.round(first.x));
    });
});

test.describe('Settings', () => {
  test.use({ startOn: 'home' });

  test('the page list sits at the right, Left enters a page, and the swatches walk left',
    async ({ page }) => {
      await routePlaylist(page);
      await seedPlaylist(page);
      await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
      await page.goto('/');
      await enterTab(page, 'settings');
      const view = page.locator('#view-settings');
      const sidebar = (await view.locator('.settings-sidebar').boundingBox())!;
      const pageBox = (await view.locator('.settings-scroll').boundingBox())!;
      expect(rightOf(sidebar, pageBox)).toBe(true);
      // Save sits at the left end of the action row, Cancel to its right.
      expect(rightOf((await view.locator('#cancel-settings').boundingBox())!,
        (await view.locator('#save-settings').boundingBox())!)).toBe(true);

      const appearance = view.locator('[data-settings-target="appearance"]');
      await appearance.click();
      await page.keyboard.press('ArrowLeft');
      const swatches = view.locator('.theme-swatch');
      const focusedSwatch = async () => JSON.parse(await view.locator('.theme-swatch-rail').evaluate((rail) => {
        const all = Array.from(rail.querySelectorAll('.theme-swatch'));
        const focused = rail.querySelector('.theme-swatch.focused');
        const box = rail.getBoundingClientRect();
        const r = focused?.getBoundingClientRect();
        return JSON.stringify({
          index: focused ? all.indexOf(focused) : -1,
          inside: !!r && r.left >= box.left - 1 && r.right <= box.right + 1,
        });
      })) as { index: number; inside: boolean };
      await expect.poll(focusedSwatch).toEqual({ index: 0, inside: true });
      expect(rightOf((await swatches.nth(0).boundingBox())!, (await swatches.nth(1).boundingBox())!)).toBe(true);
      const count = await swatches.count();
      for (let i = 1; i < count; i++) {
        await page.keyboard.press('ArrowLeft');
        await expect.poll(focusedSwatch).toEqual({ index: i, inside: true });
      }
      for (let i = count - 2; i >= 0; i--) {
        await page.keyboard.press('ArrowRight');
        await expect.poll(focusedSwatch).toEqual({ index: i, inside: true });
      }
      // Right past the page's start edge returns to the page list.
      await page.keyboard.press('ArrowRight');
      await expect(appearance).toHaveClass(/\bfocused\b/);
    });

  test('a password reads from the left, and its reveal overlay stays on the typed text',
    async ({ page }) => {
      await routePlaylist(page);
      await seedPlaylist(page);
      await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
      await page.goto('/');
      await enterTab(page, 'settings');
      await page.locator('[data-settings-target="subtitles"]').click();
      const field = page.locator('#os-pass');
      const wrap = page.locator('.password-field').filter({ has: field });
      await field.click();
      await page.keyboard.type('ab');
      await expect(wrap).toHaveClass(/revealing/);
      const geometry = async () => JSON.parse(await wrap.evaluate((el) => {
        const input = el.querySelector('input')!;
        const style = getComputedStyle(input);
        const box = input.getBoundingClientRect();
        const masked = el.querySelector('.password-reveal-masked')!.getBoundingClientRect();
        const caret = el.querySelector('.password-reveal-caret')!.getBoundingClientRect();
        return JSON.stringify({
          textLeft: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          textRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
          masked: masked.left,
          caret: caret.right,
        });
      })) as { textLeft: number; textRight: number; masked: number; caret: number };
      const short = await geometry();
      expect(Math.abs(short.masked - short.textLeft)).toBeLessThanOrEqual(1);
      // A password longer than the field scrolls; the overlay's caret follows it.
      await page.keyboard.type('abcdefghijklmnopqrstuvwxyz0123456789abcdefghij');
      const long = await geometry();
      expect(long.caret).toBeGreaterThan(long.textLeft);
      expect(long.caret).toBeLessThanOrEqual(long.textRight + 3);
    });
});

test.describe('overlays', () => {
  test.use({ startOn: 'home' });

  test('a prompt puts its confirm button at the right, and Left and Right move on screen',
    async ({ page }) => {
      await routePlaylist(page);
      await seedPlaylist(page);
      await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
      await page.goto('/');
      await enterTab(page, 'settings');
      await page.locator('[data-settings-target="data"]').click();
      await page.locator('#clear-cache').click();
      const prompt = page.locator('.confirmation-prompt:not(.hidden)');
      await expect(prompt).toBeVisible();
      const buttons = prompt.locator('.confirmation-btn');
      await expect(buttons).toHaveCount(2);
      const [first, second] = [(await buttons.nth(0).boundingBox())!, (await buttons.nth(1).boundingBox())!];
      expect(rightOf(first, second)).toBe(true);
      await page.keyboard.press('ArrowLeft');
      await expect(buttons.nth(1)).toHaveClass(/\bfocused\b/);
      await page.keyboard.press('ArrowRight');
      await expect(buttons.nth(0)).toHaveClass(/\bfocused\b/);
      await page.keyboard.press('Escape');
      await expect(prompt).toHaveCount(0);
    });

  test('a typed channel number reads left to right', async ({ page }) => {
    // Twelve channels, so a number takes two digits.
    await seedArabicLive(page, 8);
    await page.goto('/');
    await enterTab(page, 'live');
    await expect(page.locator('#view-channels .channel-main .channel-item').first()).toBeVisible();
    await pressKeys(page, 49, 50);
    const digits = page.locator('.number-entry.visible .number-entry-digit');
    await expect(digits).toHaveCount(2);
    expect(rightOf((await digits.nth(1).boundingBox())!, (await digits.nth(0).boundingBox())!)).toBe(true);
  });
});

test.describe('player', () => {
  test.use({ startOn: 'home' });

  // An Arabic series episode playing in a 1500-second stand-in stream.
  async function playEpisode(page: Page): Promise<void> {
    await seedXtream(page);
    await page.route('**/player_api.php*', (route) => {
      if (!route.request().url().includes('get_series_info')) return route.fallback();
      const episode = (id: string, n: number) => ({ id, title: `Episode ${String(n)}`, season: 1,
        episode_num: n, container_extension: 'mp4', info: { duration_secs: 1500 } });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        info: { name: 'Series One' }, episodes: { 1: [episode('11', 1), episode('12', 2), episode('13', 3)] },
      }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem('iptv_locale', JSON.stringify('ar'));
      localStorage.setItem('iptv_player_osd_timeout_ms', '12000');
      const P = HTMLMediaElement.prototype;
      const times = new WeakMap<HTMLMediaElement, number>();
      Object.defineProperty(P, 'duration', { configurable: true, get: () => 1500 });
      Object.defineProperty(P, 'paused', { configurable: true, get: () => false });
      Object.defineProperty(P, 'currentTime', {
        configurable: true,
        get(this: HTMLMediaElement) { return times.get(this) ?? 0; },
        set(this: HTMLMediaElement, t: number) { times.set(this, t); },
      });
    });
    await page.goto('/');
    await enterTab(page, 'series');
    await page.locator('#view-series .catalog-tile[data-item-id="20"]')
      .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
    await page.keyboard.press('Enter');
    await page.locator('.episode-card[data-episode-id="12"]')
      .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
    await page.keyboard.press('Enter');
    await expect(page.locator('#player-osd [data-seekbar]')).toBeVisible();
  }

  const position = (page: Page) =>
    page.locator('#video-player').evaluate((v: HTMLVideoElement) => v.currentTime);

  test('the seek bar fills from the right, Left seeks forward, and the controls mirror',
    async ({ page }) => {
      await playEpisode(page);
      const osd = page.locator('#player-osd');
      await page.locator('#video-player').evaluate((v: HTMLVideoElement) => {
        v.currentTime = 300;
        v.dispatchEvent(new Event('timeupdate'));
      });
      const bar = (await osd.locator('[data-seekbar]').boundingBox())!;
      const track = (await osd.locator('.osd-progress-bar').locator('..').boundingBox())!;
      await expect.poll(async () => {
        const fill = (await osd.locator('.osd-progress-bar').boundingBox())!;
        return [Math.abs(fill.x + fill.width - (track.x + track.width)) <= 1,
          Math.abs(fill.width / track.width - 0.2) < 0.02];
      }).toEqual([true, true]);
      // The elapsed time on the right, the duration on the left.
      expect(rightOf((await osd.locator('.osd-time-current').boundingBox())!, bar)).toBe(true);
      expect(rightOf(bar, (await osd.locator('.osd-time-end').boundingBox())!)).toBe(true);

      // Left is forward along the mirrored bar, Right back.
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => position(page), { timeout: 5000 }).toBeGreaterThan(300);
      const forward = await position(page);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => position(page), { timeout: 5000 }).toBeLessThan(forward);

      // A click near the bar's right end seeks near the start.
      await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await page.mouse.click(bar.x + bar.width * 0.9, bar.y + bar.height / 2);
      await expect.poll(() => position(page), { timeout: 5000 }).toBeLessThan(1500 * 0.2);

      // Previous on the right, Next on the left, Play/Pause centered between.
      const box = async (action: string) => (await osd.locator(`[data-dock-action="${action}"]`).boundingBox())!;
      expect(rightOf(await box('previous'), await box('playpause'))).toBe(true);
      expect(rightOf(await box('playpause'), await box('next'))).toBe(true);
      // Previous and Next point along the mirrored row; Play does not turn.
      const flipped = (action: string) => osd.locator(`[data-dock-action="${action}"] svg`).first()
        .evaluate((svg) => getComputedStyle(svg).transform);
      expect(await flipped('previous')).toBe('matrix(-1, 0, 0, 1, 0, 0)');
      expect(await flipped('next')).toBe('matrix(-1, 0, 0, 1, 0, 0)');
      expect(await flipped('playpause')).toBe('none');
    });

  test('the track menu opens with Left and sits over the left end of the controls', async ({ page }) => {
    await playEpisode(page);
    const osd = page.locator('#player-osd');
    await page.keyboard.press('ArrowDown');
    await expect(osd.locator('[data-dock-action="playpause"]')).toHaveClass(/\bfocused\b/);
    // Left walks the row to its end, the subtitles control on the left.
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    const focused = osd.locator('.focused');
    await expect(focused).toHaveCount(1);
    const control = (await focused.boundingBox())!;
    expect(control.x).toBeLessThan(400);
    await page.keyboard.press('Enter');
    const menu = page.locator('#player-menu');
    await expect(menu).toHaveClass(/visible/);
    const menuBox = (await menu.boundingBox())!;
    const dock = (await osd.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(dock.x - 1);
    expect(menuBox.x).toBeLessThanOrEqual(control.x + 1);
    expect(menuBox.x + menuBox.width).toBeLessThan(960);
  });
});

// Four channels (plus `extra`) in two groups with a guide around 12:00 UTC,
// in Arabic.
const LIVE_PLAYLIST = 'http://host/rtl.m3u';
const LIVE_GUIDE = 'http://host/rtl.xml';
async function seedArabicLive(page: Page, extra = 0): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-09-15T12:00:00Z'));
  const numbers = Array.from({ length: 4 + extra }, (_, i) => i + 1);
  const m3u = ['#EXTM3U', ...numbers.flatMap((n) => [
    `#EXTINF:-1 tvg-id="ch${n}" group-title="Group ${n < 3 ? 1 : 2}",ch${n}`, `http://host/ch${n}.m3u8`])];
  const program = (n: number, start: string, stop: string, title: string): string =>
    `<programme channel="ch${n}" start="20260915${start}00 +0000" stop="20260915${stop}00 +0000">`
    + `<title>${title}</title></programme>`;
  const epg = `<tv>${[1, 2, 3, 4].map((n) => program(n, '1100', '1230', `Program ${n}A`)
    + program(n, '1230', '1400', `Program ${n}B`)).join('')}</tv>`;
  await routeLiveManifest(page);
  await page.route(LIVE_PLAYLIST, (route) => route.fulfill({ body: m3u.join('\n') }));
  await page.route(LIVE_GUIDE, (route) => route.fulfill({ contentType: 'application/xml', body: epg }));
  await page.addInitScript(({ playlist, guide }) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ id: 'p1', name: 'P1', url: playlist }]));
    localStorage.setItem('iptv_manual_epg_sources', JSON.stringify([{ url: guide, playlistIds: [] }]));
    localStorage.setItem('iptv_tz_mode', JSON.stringify('device'));
    localStorage.setItem('iptv_locale', JSON.stringify('ar'));
  }, { playlist: LIVE_PLAYLIST, guide: LIVE_GUIDE });
}

const rightOf = (a: { x: number }, b: { x: number; width: number }): boolean => a.x >= b.x + b.width - 1;

test.describe('Home', () => {
  test.use({ startOn: 'home', timezoneId: 'UTC' });

  test('the cards and header mirror, and Left and Right move on screen', async ({ page }) => {
    await seedXtream(page);
    await page.addInitScript(() => localStorage.setItem('iptv_locale', JSON.stringify('ar')));
    await page.goto('/');
    const home = page.locator('#view-home');
    const card = (section: string) => home.locator(`[data-key="section:${section}"]`);
    await expect(card('live')).toHaveClass(/\bfocused\b/);
    const live = (await card('live').boundingBox())!;
    const movies = (await card('movies').boundingBox())!;
    const series = (await card('series').boundingBox())!;
    // Live, the lead card, sits at the right; the rest run leftward.
    expect(rightOf(live, movies)).toBe(true);
    expect(rightOf(movies, series)).toBe(true);
    expect(live.x + live.width).toBeGreaterThan(1600);
    const brand = (await home.locator('.home-brand').boundingBox())!;
    const clock = (await home.locator('.home-clock').boundingBox())!;
    expect(rightOf(brand, clock)).toBe(true);

    await page.keyboard.press('ArrowLeft');
    await expect(card('movies')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('ArrowLeft');
    await expect(card('series')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(card('live')).toHaveClass(/\bfocused\b/);
  });
});

test.describe('Live and Guide', () => {
  test.use({ startOn: 'live', timezoneId: 'UTC' });

  test('Live puts the groups at the right and the preview at the left', async ({ page }) => {
    await seedArabicLive(page);
    await page.goto('/');
    const view = page.locator('#view-channels');
    const row = view.locator('.channel-main .channel-item').first();
    await expect(row).toContainText('Program 1A');
    const groups = (await view.locator('.group-item').first().boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    expect(rightOf(groups, rowBox)).toBe(true);
    // Within a row the number comes first, from the right.
    const number = (await row.locator('.channel-number').boundingBox())!;
    const info = (await row.locator('.channel-info').boundingBox())!;
    expect(rightOf(number, info)).toBe(true);
    await expect(view.locator('#live-preview')).toBeVisible();
    const preview = (await view.locator('#live-preview').boundingBox())!;
    expect(rightOf(rowBox, preview)).toBe(true);
    // The video, placed by its left edge, still lands in the preview's slot.
    const slot = (await view.locator('.live-preview-slot').boundingBox())!;
    await expect.poll(async () => Math.round((await page.locator('#video-player').boundingBox())?.x ?? -1))
      .toBe(Math.round(slot.x));

    // Right reaches the groups, Left comes back to the list.
    await expect(row).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('ArrowRight');
    await expect(view.locator('.group-item.focused')).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(view.locator('.channel-main .channel-item.focused')).toHaveCount(1);
  });

  test('in full-screen Live, Right opens the channel list from the right edge', async ({ page }) => {
    await seedArabicLive(page);
    await page.goto('/');
    await expect(page.locator('#view-channels .channel-main .channel-item').first())
      .toContainText('Program 1A');
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-player')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    const sidebar = page.locator('#player-sidebar');
    await expect(sidebar).toHaveClass(/\bvisible\b/);
    // The channel panel shows at the right edge; the groups wait off screen.
    await expect.poll(async () => {
      const box = (await sidebar.locator('.sidebar-channel-panel').boundingBox())!;
      return Math.abs(box.x + box.width - 1920) <= 1;
    }).toBe(true);
    await expect(sidebar.locator('.focused')).toHaveCount(1);
    // Left closes it again: back toward the video.
    await page.keyboard.press('ArrowLeft');
    await expect(sidebar).not.toHaveClass(/\bvisible\b/);
  });

  test('the Guide runs time from right to left, and Left moves later', async ({ page }) => {
    await seedArabicLive(page);
    await page.goto('/');
    await expect(page.locator('#view-channels .channel-main .channel-item').first())
      .toContainText('Program 1A');
    await openGuide(page);
    const guide = page.locator('#live-guide');
    const cell = (title: string) => guide.locator('.guide-cell', { hasText: title }).first();
    const earlier = (await cell('Program 1A').boundingBox())!;
    const later = (await cell('Program 1B').boundingBox())!;
    expect(rightOf(earlier, later)).toBe(true);
    // The ruler runs the same way, and the now line sits inside the live cell.
    const time = (text: string) => guide.locator('.guide-time', { hasText: text }).first();
    expect(rightOf((await time('12:00').boundingBox())!, (await time('13:00').boundingBox())!)).toBe(true);
    const now = (await guide.locator('.guide-now-line i').boundingBox())!;
    expect(now.x).toBeGreaterThan(earlier.x);
    expect(now.x).toBeLessThan(earlier.x + earlier.width);
    // The live cell's progress fills from its right edge.
    const progress = (await cell('Program 1A').locator('.guide-cell-progress').boundingBox())!;
    expect(Math.abs(progress.x + progress.width - (earlier.x + earlier.width))).toBeLessThanOrEqual(3);
    // The channel column sits right of the grid.
    const channel = (await guide.locator('.guide-channel').first().boundingBox())!;
    expect(rightOf(channel, earlier)).toBe(true);

    await expect(cell('Program 1A')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('ArrowLeft');
    await expect(cell('Program 1B')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('ArrowRight');
    await expect(cell('Program 1A')).toHaveClass(/\bfocused\b/);
  });
});
