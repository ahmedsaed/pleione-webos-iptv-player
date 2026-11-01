import { test, expect, enterTab, type Page } from './helpers';
import { SAMPLE_LIVE_CATEGORIES, SAMPLE_LIVE_STREAMS } from './fixtures/xtream';

// Search opened from Home before the channels load works at once: the
// catalog answers the query while the channel and program results wait in
// place, as a TV that can't cache the playlist may take minutes.

function xmltvDate(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
}

// The account's Live catalog answers only when released; `fail` answers
// 404, which fails at once where a 5xx would retry, and so does get.php.
function holdPlaylist(page: Page): { release: () => void; fail: boolean; requests: number } {
  const gate = { release: () => {}, fail: false, requests: 0 };
  let held = new Promise<void>((resolve) => { gate.release = resolve; });
  void page.route('**/get.php*', route =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
  void page.route('**/player_api.php*', async (route) => {
    if (!route.request().url().includes('get_live_streams')) return route.fallback();
    gate.requests++;
    await held;
    held = new Promise<void>((resolve) => { gate.release = resolve; });
    if (gate.fail) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    } else {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_LIVE_STREAMS),
      });
    }
  });
  return gate;
}

// One Xtream account whose catalog has a movie and a series matching "one",
// and a guide with a matching program.
async function seedAccount(page: Page): Promise<void> {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const stop = new Date(start.getTime() + 60 * 60 * 1000);
  const epg = `<tv>
    <channel id="one"><display-name>Channel One</display-name></channel>
    <programme channel="one" start="${xmltvDate(start)}" stop="${xmltvDate(stop)}">
      <title>Report One</title>
    </programme>
  </tv>`;
  await page.route('**/xmltv.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: epg }));
  await page.route('**/player_api.php*', (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    // holdPlaylist answers the Live catalog.
    if (url.includes('get_live_streams')) return route.fallback();
    if (url.includes('get_live_categories')) return json(SAMPLE_LIVE_CATEGORIES);
    if (url.includes('get_vod_streams')) {
      return json([{ stream_id: 10, name: 'Movie One', stream_icon: '', container_extension: 'mp4', category_id: '1' }]);
    }
    if (url.includes('get_series_categories') || url.includes('get_vod_categories')) {
      return json([{ category_id: '1', category_name: 'Cat A' }]);
    }
    if (url.includes('get_series')) {
      return json([{ series_id: 1, name: 'Series One', cover: '', category_id: '1' }]);
    }
    return json({});
  });
  await page.addInitScript(() => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'x1', name: 'X Account', url: 'http://host.example.com:8080',
        source: 'xtream', xtream: { username: 'u', password: 'p' } },
    ]));
    localStorage.setItem('iptv_search_history', JSON.stringify(['alpha']));
  });
}

const search = (page: Page) => page.locator('#view-search');
const input = (page: Page) => page.locator('.search-box-input');
const channelStatus = (page: Page) => search(page).locator('[data-search-channels]');
const movie = (page: Page) => search(page).locator('.catalog-tile[data-stream-id="10"]');
const seriesTile = (page: Page) => search(page).locator('.catalog-tile[data-series-id="1"]');
const channelCard = (page: Page) => search(page).locator('.search-channel-card');

async function openSearchEarly(page: Page): Promise<{ release: () => void; fail: boolean; requests: number }> {
  const gate = holdPlaylist(page);
  await seedAccount(page);
  await page.goto('/');
  await enterTab(page, 'search');
  await expect(input(page)).toBeFocused();
  return gate;
}

// Only the surface with the keys shows a ring: `count` rings on screen.
async function expectRings(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.locator('.focused').evaluateAll((els) => els.filter((el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }).length)).toBe(count);
}

test('movie and series results show while the channels still load', async ({ page }) => {
  const gate = await openSearchEarly(page);
  await expect(page.locator('#view-loading')).toBeHidden();
  // The recent searches, with no channel status in their place.
  await expect(search(page).locator('.search-recent-chip')).toHaveText(['alpha']);
  await expect(channelStatus(page)).toHaveCount(0);

  await input(page).fill('one');
  await expect(movie(page)).toContainText('Movie One');
  await expect(seriesTile(page)).toContainText('Series One');
  await expect(channelStatus(page)).toHaveAttribute('data-search-channels', 'loading');
  await expect(channelStatus(page)).toHaveText('Loading channels…');
  await expect(channelStatus(page).locator('.search-busy-spinner')).toBeVisible();
  await expect(channelCard(page)).toHaveCount(0);
  // Inline, above the catalog rails, where the channels go.
  const status = (await channelStatus(page).boundingBox())!;
  const rail = (await search(page).locator('.search-section-movies').boundingBox())!;
  expect(status.y + status.height).toBeLessThanOrEqual(rail.y);
  expect(status.height).toBeLessThan(80);
  expect(gate.requests).toBe(1);
});

test('channel results fill in once the channels load, keeping the query and focus', async ({ page }) => {
  const gate = await openSearchEarly(page);
  await input(page).fill('one');
  await expect(movie(page)).toBeVisible();
  // Down hands the keys to the first result: the movie, for now.
  await input(page).press('ArrowDown');
  await expect(movie(page)).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
  // The tile's cell, which the focus scale leaves alone.
  const cell = search(page).locator('[data-search-section="movies"][data-search-index="0"]');
  const before = (await cell.boundingBox())!;

  gate.release();
  await expect(channelCard(page).first()).toContainText('Channel One');
  await expect(search(page).locator('.search-program-card').first()).toContainText('Report One');
  await expect(channelStatus(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue('one');
  await expect(movie(page)).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
  // The rows filled in above it, hundreds of pixels; the focused movie
  // stays put on screen, give or take the few the scroll can't pass its end.
  const channels = (await search(page).locator('.search-section-channels').boundingBox())!;
  expect(channels.height).toBeGreaterThan(100);
  const after = (await cell.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(8);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);

  // The keys go on from where they were.
  await page.keyboard.press('ArrowUp');
  await expect(search(page).locator('.search-program-card').first()).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
});

test('typing goes on while the channels load and arrive', async ({ page }) => {
  const gate = await openSearchEarly(page);
  await input(page).fill('on');
  await expect(movie(page)).toBeVisible();
  gate.release();
  await input(page).pressSequentially('e');
  await expect(channelCard(page).first()).toContainText('Channel One');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('one');
  await expect(search(page).locator('.focused')).toHaveCount(0);
});

test('leaving Search before the channels load does not bring it back', async ({ page }) => {
  const indexed: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('event=search.index.ready')) indexed.push(msg.text());
  });
  const gate = await openSearchEarly(page);
  await input(page).fill('one');
  await expect(movie(page)).toBeVisible();

  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies')).toBeVisible();
  await expect(search(page)).toBeHidden();
  const opened = indexed.length;

  gate.release();
  await expect.poll(() => gate.requests).toBe(1);
  await page.waitForTimeout(800);
  await expect(page.locator('#view-movies')).toBeVisible();
  await expect(search(page)).toBeHidden();
  // Search, released on leave, indexed nothing for the channels.
  expect(indexed.length).toBe(opened);
  await page.keyboard.press('ArrowDown');
  await expectRings(page, 1);
  await expect(search(page).locator('.focused')).toHaveCount(0);

  // Opened again, it searches the loaded channels.
  await enterTab(page, 'search');
  await input(page).fill('one');
  await expect(channelCard(page).first()).toContainText('Channel One');
  await expect(channelStatus(page)).toHaveCount(0);
});

test('a failed channel load says so and keeps the movie and series results', async ({ page }) => {
  const gate = await openSearchEarly(page);
  gate.fail = true;
  await input(page).fill('one');
  await expect(movie(page)).toBeVisible();
  await input(page).press('ArrowDown');
  await expect(movie(page)).toHaveClass(/\bfocused\b/);

  gate.release();
  await expect(channelStatus(page)).toHaveAttribute('data-search-channels', 'failed');
  await expect(channelStatus(page)).toHaveText('Unable to load the playlist. Check the URL and try again.');
  await expect(channelStatus(page).locator('.search-busy-spinner')).toHaveCount(0);
  await expect(movie(page)).toContainText('Movie One');
  await expect(seriesTile(page)).toContainText('Series One');
  await expect(movie(page)).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
  await expect(channelCard(page)).toHaveCount(0);
});
