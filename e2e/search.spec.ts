import {
  test,
  expect,
  routeLiveManifest,
  SAMPLE_M3U,
  enterTab,
  readUserDataStore,
} from './helpers';

function xmltvDate(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
}

// Seed one Xtream account (enables the tab bar) and stub the player_api.php
// catalog calls + the get.php/xmltv.php the live path uses. get_vod_streams /
// get_series with no category return the whole catalog Search matches against;
// get_vod_info backs the movie deep-link into the Movies detail. Action names
// that are substrings of others are routed most-specific-first (get_series_*
// before get_series, get_vod_info/get_vod_categories before get_vod_streams).
async function seedSearch(page: import('@playwright/test').Page): Promise<void> {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const stop = new Date(start.getTime() + 60 * 60 * 1000);
  const epg = `<tv>
    <channel id="one"><display-name>Channel One</display-name></channel>
    <programme channel="one" start="${xmltvDate(start)}" stop="${xmltvDate(stop)}">
      <title>Future Report</title><category>News</category>
    </programme>
  </tv>`;
  await page.route('**/get.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }));
  await page.route('**/xmltv.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: epg }));
  await page.route('**/player_api.php*', (route) => {
    const url = route.request().url();
    if (url.includes('get_vod_categories')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ category_id: '1', category_name: 'Cat A' }]) });
    }
    if (url.includes('get_vod_info')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ info: { plot: 'Movie plot.', duration_secs: 3600, movie_image: '' } }) });
    }
    if (url.includes('get_vod_streams')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { stream_id: 10, name: 'Movie One', stream_icon: '', container_extension: 'mp4', category_id: '1' },
      ]) });
    }
    if (url.includes('get_series_categories')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ category_id: '1', category_name: 'Cat A' }]) });
    }
    if (url.includes('get_series_info')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ episodes: {} }) });
    }
    if (url.includes('get_series')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { series_id: 1, name: 'Series One', cover: '', category_id: '1' },
      ]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // The movie file itself: a small response so play() doesn't hang the test.
  await page.route('**/movie/**', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'x1', name: 'X Account', url: 'http://host.example.com:8080',
        source: 'xtream', xtream: { username: 'u', password: 'p' } },
    ]));
  });
}

// Open Search with the caret in its box (results appear once a query is typed).
async function enterSearch(page: import('@playwright/test').Page): Promise<void> {
  await enterTab(page, 'search');
  await expect(page.locator('.search-box-input')).toBeFocused();
}

test('M3U channel results retain visible space above matching programmes', async ({ page }) => {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const stop = new Date(start.getTime() + 60 * 60 * 1000);
  const epg = `<tv>
    <channel id="one"><display-name>Channel One</display-name></channel>
    <programme channel="one" start="${xmltvDate(start)}" stop="${xmltvDate(stop)}">
      <title>Programme One</title>
    </programme>
  </tv>`;
  await page.route('**/playlist.m3u', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }));
  await page.route('**/guide.xml', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: epg }));
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { name: 'P', url: 'http://host/playlist.m3u' },
    ]));
    localStorage.setItem('iptv_epg_url', JSON.stringify('http://host/guide.xml'));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  await page.locator('.search-box-input').fill('one');

  const channel = page.locator('#view-search .search-channel-row').first();
  const programme = page.locator('#view-search .search-program-row').first();
  await expect(channel).toContainText('Channel One');
  await expect(programme).toContainText('Programme One');
  await expect.poll(async () => {
    const channelBox = await channel.boundingBox();
    const programmeBox = await programme.boundingBox();
    if (!channelBox || !programmeBox) return false;
    return channelBox.height >= 80
      && channelBox.y + channelBox.height <= programmeBox.y;
  }).toBe(true);
});

test('unified search matches channels, movies, and series; a channel result plays', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  // One query matches "Channel One" (live, from SAMPLE_M3U), "Movie One", and
  // "Series One". The catalogs load asynchronously on open, so the movie/series
  // groups appear once loaded; the assertions retry until then.
  await page.locator('.search-box-input').fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-channel-index="0"]')).toContainText('Channel One');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');
  await expect(page.locator('#view-search .catalog-tile[data-series-id="1"]')).toContainText('Series One');

  // Hand off from the box to the results (Down), then focus the channel
  // tile via a bubbling nav:hover before OK.
  await page.locator('.search-box-input').press('ArrowDown');
  await page.locator('#view-search .catalog-tile[data-channel-index="0"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-player')).toBeVisible();
});

test('a query typed while the index prepares shows a hint, then its results', async ({ page }) => {
  await seedSearch(page);
  let releaseCatalog!: () => void;
  const catalogHeld = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  await page.route(/get_vod_streams/, async (route) => {
    await catalogHeld;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  await page.locator('.search-box-input').fill('one');
  const hint = page.locator('#view-search .search-results .search-empty');
  await expect(hint).toHaveText('Preparing search…');
  await expect(page.locator('#view-search .catalog-tile')).toHaveCount(0);
  await page.locator('.search-box-input').fill('zzz');
  await expect(hint).toHaveText('Preparing search…');
  await page.locator('.search-box-input').fill('one');

  releaseCatalog();
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');
  await expect(page.locator('#view-search .catalog-tile[data-channel-index="0"]')).toContainText('Channel One');
  await expect(page.locator('#view-search .search-empty')).toHaveCount(0);
});

test('a wide virtual search rail keeps its full scrollable width', async ({ page }) => {
  await seedSearch(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  await page.locator('.search-box-input').fill('one');

  const rail = page.locator('[data-search-virtual="movies"]');
  await expect(rail.locator('.search-virtual-rail-spacer')).toBeVisible();
  const metrics = await rail.evaluate((element) => {
    const spacer = element.querySelector<HTMLElement>('.search-virtual-rail-spacer');
    if (!spacer) throw new Error('virtual rail spacer not found');
    spacer.style.width = '12000000px';
    element.scrollLeft = element.scrollWidth;
    return {
      flexShrink: getComputedStyle(spacer).flexShrink,
      spacerWidth: spacer.getBoundingClientRect().width,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
    };
  });

  expect(metrics.flexShrink).toBe('0');
  expect(metrics.spacerWidth).toBe(12_000_000);
  expect(metrics.scrollWidth).toBeGreaterThanOrEqual(12_000_000);
  // Past 2^23px a scroll offset is float-rounded, so allow 1px either way.
  expect(Math.abs(metrics.scrollLeft - (metrics.scrollWidth - metrics.clientWidth)))
    .toBeLessThanOrEqual(1);
});

test('program search shows XMLTV metadata and toggles a future reminder', async ({ page }) => {
  await seedSearch(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  await page.locator('.search-box-input').fill('report');
  const result = page.locator('#view-search .search-program-row');
  await expect(result).toContainText('Future Report');
  await expect(result).toContainText('Channel One');
  await expect(result).toContainText('Set reminder');
  // Only the poster rails bleed; a list keeps both screen margins.
  const box = await result.boundingBox();
  expect(Math.round(box!.x)).toBe(80);
  expect(Math.round(1920 - box!.x - box!.width)).toBe(80);

  await result.click();
  await expect(result).toContainText('Reminder set');
  await expect.poll(async () =>
    (await readUserDataStore(page, 'reminders')).length).toBe(1);
});

test('a movie search result deep-links into its Movies detail and Back returns to Search', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  await page.locator('.search-box-input').fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');

  // Hand off to the results (Down), then open the movie result (deep-links into
  // the Movies detail).
  await page.locator('.search-box-input').press('ArrowDown');
  await page.locator('#view-search .catalog-tile[data-stream-id="10"]')
    .evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies')).toBeVisible();
  await expect(page.locator('#view-movies .detail-plot')).toContainText('Movie plot.');

  // Back from the deep-linked detail returns to Search (CONFIG.KEYS.BACK = 461;
  // dispatch a raw keydown like the other section specs do).
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-search')).toBeVisible();
});

// Open the movie result for the query, deep-linking into the Movies detail.
async function openMovieResult(page: import('@playwright/test').Page, query: string): Promise<void> {
  const input = page.locator('.search-box-input');
  await input.fill(query);
  const tile = page.locator('#view-search .catalog-tile[data-stream-id="10"]');
  await expect(tile).toContainText('Movie One');
  await input.press('ArrowDown');
  await tile.evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .detail-plot')).toContainText('Movie plot.');
}

test('opening Movies reloads a browse a Search deep link interrupted', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  // Hold the first Movies category load so the deep link interrupts it.
  let held = false;
  await page.route('**/player_api.php*', (route) => {
    if (!held && route.request().url().includes('get_vod_categories')) {
      held = true;
      return;
    }
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies .catalog-loading')).toBeVisible();
  await enterSearch(page);

  await openMovieResult(page, 'one');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await expect(page.locator('#view-search')).toBeVisible();

  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies')).toBeVisible();
  await expect(page.locator('#view-movies .catalog-browse .catalog-tile[data-item-id="10"]'))
    .toContainText('Movie One');
});

test('a movie result opened by POINTER can then be played by pointer (the box lets the keys go)', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  await page.locator('.search-box-input').fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');

  // Open the movie by a POINTER click on the result — no ArrowDown hand-off, so
  // the search box keeps its scope (the pointer path) until the result opens.
  await page.locator('#view-search .catalog-tile[data-stream-id="10"]').click();
  await expect(page.locator('#view-movies .detail-btn-primary')).toBeVisible();

  // Play by a POINTER click on the detail button. Regression guard: a stale
  // search focus once swallowed this select. We assert the movie
  // stream is actually requested — proof the select reached play() — rather than
  // the player view staying up (the stubbed empty video errors back to Movies).
  const streamRequested = page.waitForRequest('**/movie/**', { timeout: 5000 });
  await page.locator('#view-movies .detail-btn-primary').click();
  await streamRequested;
});

const BACK = 461;
async function pressBack(page: import('@playwright/test').Page): Promise<void> {
  // Back reaches the app even from the search box (an input passthrough key).
  await page.evaluate((code) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true }));
  }, BACK);
}

test('recent searches drop down under the box, refill the query, and clear without confirming', async ({ page }) => {
  await seedSearch(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_search_history', JSON.stringify(['one', 'Movie']));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);

  const dropdown = page.locator('.search-history-dropdown');
  const tiles = dropdown.locator('.search-history-tile');
  const input = page.locator('.search-box-input');
  await expect(tiles).toHaveText(['one', 'Movie']);
  await expect(page.locator('#view-search')).toBeVisible();

  // Down from the box focuses the first recent search; Up from the top row
  // goes straight back to the box, past the clear button, which Right reaches.
  await input.press('ArrowDown');
  await expect(tiles.first()).toHaveClass(/focused/);
  await page.keyboard.press('ArrowUp');
  await expect(input).toBeFocused();
  await expect(dropdown.locator('[data-history-clear]')).not.toHaveClass(/focused/);
  await input.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(tiles.nth(1)).toHaveClass(/focused/);
  await page.keyboard.press('ArrowRight');
  await expect(dropdown.locator('[data-history-clear]')).toHaveClass(/focused/);
  await page.keyboard.press('ArrowUp');
  await expect(input).toBeFocused();
  await expect(dropdown.locator('.search-history-panel')).toBeVisible();

  // OK on a recent search refills the query and shows its results.
  await input.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('one');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');
  await expect(dropdown.locator('.search-history-panel')).toBeHidden();

  // Emptying the box drops the recent searches back down; clearing them
  // puts focus back in the box.
  await input.fill('');
  await expect(tiles).toHaveCount(2);
  await dropdown.locator('[data-history-clear]').click();
  await expect(page.locator('.confirmation-overlay')).toHaveCount(0);
  await expect(dropdown.locator('.search-history-panel')).toBeHidden();
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('iptv_search_history'))).toBeNull();

  // With nothing left below, Down and OK keep the remote in the box.
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.type('one');
  await expect(input).toHaveValue('one');
});

test('picking a recent search that matches nothing keeps the remote in the box', async ({ page }) => {
  await seedSearch(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_search_history', JSON.stringify(['zzz']));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  const input = page.locator('.search-box-input');
  await expect(page.locator('.search-history-tile')).toHaveText(['zzz']);
  await input.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('zzz');
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(input).toBeFocused();
});

test('a click on the dimmed view closes recent searches and keeps the caret in the box', async ({ page }) => {
  await seedSearch(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_search_history', JSON.stringify(['one']));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  const dropdown = page.locator('.search-history-dropdown');
  await expect(dropdown.locator('.search-history-tile')).toHaveCount(1);

  await page.mouse.click(1200, 800);
  await expect(dropdown.locator('.search-history-panel')).toBeHidden();
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(page.locator('.search-box-input')).toBeFocused();
});

test('recent searches line up under the search box', async ({ page }) => {
  await seedSearch(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_search_history', JSON.stringify(['one']));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  const panel = page.locator('.search-history-panel');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  const [panelBox, inputBox] = await Promise.all([
    panel.boundingBox(), page.locator('.search-box').boundingBox(),
  ]);
  expect(Math.abs(panelBox!.x - inputBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((panelBox!.x + panelBox!.width) - (inputBox!.x + inputBox!.width))).toBeLessThanOrEqual(1);
  expect(panelBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
});

// Regression: at 150% text the French "clear" label spilled past the panel.
test('a long clear label at the largest text size widens recent searches to fit', async ({ page }) => {
  await seedSearch(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_search_history', JSON.stringify(['one']));
    localStorage.setItem('iptv_locale', JSON.stringify('fr'));
    localStorage.setItem('iptv_text_size', JSON.stringify('150'));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  const panel = page.locator('.search-history-panel');
  await expect(panel).toBeVisible();
  const [panelBox, clearBox] = await Promise.all([
    panel.boundingBox(), page.locator('.search-history-clear').boundingBox(),
  ]);
  expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
});

// Regression: Back from a recent search or a result used to jump to Live.
test('Back steps from recent searches and results to the box, then to the side menu', async ({ page }) => {
  await seedSearch(page);
  await page.addInitScript(() => {
    localStorage.setItem('iptv_search_history', JSON.stringify(['one']));
  });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterTab(page, 'epg');
  await expect(page.locator('#view-epg')).toBeVisible();
  await enterSearch(page);

  const dropdown = page.locator('.search-history-dropdown');
  const input = page.locator('.search-box-input');
  await input.press('ArrowDown');
  await expect(dropdown.locator('.search-history-tile').first()).toHaveClass(/focused/);
  await pressBack(page);
  await expect(dropdown.locator('.search-history-panel')).toBeHidden();
  await expect(input).toBeFocused();
  await expect(page.locator('#view-search')).toBeVisible();

  await input.fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');
  await input.press('ArrowDown');
  await expect(page.locator('#view-search .focused')).toHaveCount(1);
  await pressBack(page);
  await expect(input).toBeFocused();
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(page.locator('#view-search .focused')).toHaveCount(0);

  await pressBack(page);
  await expect(page.locator('.nav-menu')).toHaveClass(/\bopen\b/);
  await expect(page.locator('.nav-menu .focused')).toHaveAttribute('data-section', 'search');
  await expect(input).not.toBeFocused();
  await expect(page.locator('.focused:visible')).toHaveCount(1);
  // Right closes it and gives the caret back.
  await page.keyboard.press('ArrowRight');
  await expect(input).toBeFocused();
});

test('opening a search result records the query as a recent search', async ({ page }) => {
  await seedSearch(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  await page.locator('.search-box-input').fill('one');
  const channel = page.locator('#view-search .catalog-tile[data-channel-index="0"]');
  await expect(channel).toContainText('Channel One');
  await page.locator('.search-box-input').press('ArrowDown');
  await channel.evaluate((el) => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-player')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('iptv_search_history'))).toBe('["one"]');
});

// Hover a row, then let the pointer leave it: the highlight hides but focus stays.
async function hoverThenLeave(el: import('@playwright/test').Locator): Promise<void> {
  await el.evaluate((node) => {
    node.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    node.dispatchEvent(new CustomEvent('nav:unhover', { bubbles: true }));
  });
}

test('after the pointer leaves a result, the first key shows it and the next one moves', async ({ page }) => {
  await seedSearch(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  await page.locator('.search-box-input').fill('channel');
  const tile = (index: number) => page.locator(`#view-search .catalog-tile[data-channel-index="${String(index)}"]`);
  await expect(tile(1)).toBeVisible();
  await page.locator('.search-box-input').press('ArrowDown');
  // Step along the channel results, which search moves through by itself.
  const section = await tile(0).evaluate((el) =>
    el.closest<HTMLElement>('[data-search-section]')?.dataset.searchSection ?? '');
  const along = section === 'channels-rail' ? 'ArrowRight' : 'ArrowDown';
  await hoverThenLeave(tile(0));
  await expect(page.locator('#view-search .focused')).toHaveCount(0);

  await page.keyboard.press(along);
  await expect(tile(0)).toHaveClass(/\bfocused\b/);
  await page.keyboard.press(along);
  await expect(tile(1)).toHaveClass(/\bfocused\b/);
});

test('Up back to the box leaves no ring on a result, while typing too', async ({ page }) => {
  await seedSearch(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  const input = page.locator('.search-box-input');
  await input.fill('on');
  const tile = page.locator('#view-search .catalog-tile[data-channel-index="0"]');
  await expect(tile).toContainText('Channel One');
  await input.press('ArrowDown');
  await expect(page.locator('#view-search .focused')).toHaveCount(1);

  for (let i = 0; i < 4; i++) {
    if (await input.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('ArrowUp');
  }
  await expect(input).toBeFocused();
  await expect(page.locator('#view-search .focused')).toHaveCount(0);
  await page.keyboard.type('e');
  await expect(page.locator('#view-search [data-search-query]')).toHaveAttribute('data-search-query', 'one');
  await expect(tile).toBeVisible();
  await expect(page.locator('#view-search .focused')).toHaveCount(0);
});

test('Down from the box after Up rings a result at once, and one Right moves', async ({ page }) => {
  await seedSearch(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
  await enterSearch(page);
  const input = page.locator('.search-box-input');
  await input.fill('one');
  await expect(page.locator('#view-search .catalog-tile[data-stream-id="10"]')).toContainText('Movie One');
  await input.press('ArrowDown');
  const focused = page.locator('#view-search .focused');
  await expect(focused).toHaveCount(1);
  const first = await focused.getAttribute('data-key');

  for (let i = 0; i < 4; i++) {
    if (await input.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('ArrowUp');
  }
  await expect(input).toBeFocused();
  await expect(focused).toHaveCount(0);

  await input.press('ArrowDown');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute('data-key', first ?? '');
  await page.keyboard.press('ArrowRight');
  await expect(focused).toHaveCount(1);
  await expect(focused).not.toHaveAttribute('data-key', first ?? '');
});
