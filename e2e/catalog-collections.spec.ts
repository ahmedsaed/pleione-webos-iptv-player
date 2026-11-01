import { test, expect, enterTab, leaveVod, readUserDataStore, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';
import type { ResumeEntry, WatchlistEntry } from '../src/types';

// Opened from Home's Live card after every load (see `startOn`).
test.use({ startOn: 'live' });

async function seedCollections(page: Page, count = 30): Promise<void> {
  await seedXtream(page);
  await page.route('http://host/poster/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="330"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#304b62"/><stop offset="1" stop-color="#10202e"/></linearGradient></defs><path fill="url(#a)" d="M0 0h220v330H0z"/><circle cx="155" cy="95" r="55" fill="#c8a267"/><path d="m0 280 100-150 120 170v30H0" fill="#122334"/></svg>',
  }));
  await page.addInitScript(n => {
    if (localStorage.getItem('collection_fixture')) return;
    localStorage.setItem('collection_fixture', '1');
    const watchlist: Record<string, WatchlistEntry> = {};
    const resume: Record<string, ResumeEntry> = {};
    for (const accountId of ['x1', 'x2']) {
      for (const kind of ['vod', 'series'] as const) {
        for (let i = 0; i < (accountId === 'x1' ? n : 1); i++) {
          const itemId = `${kind}${i}`;
          watchlist[`${accountId}|${kind}|${itemId}`] = {
            accountId, kind, itemId, name: `Title ${i}`, poster: `http://host/poster/${i}`,
            rating: '', categoryId: kind === 'vod' ? '1' : '2', containerExtension: 'mp4', addedAt: n - i,
          };
        }
      }
      for (const kind of ['vod', 'episode'] as const) {
        for (let i = 0; i < (accountId === 'x1' ? Math.min(n, 50) : 1); i++) {
          const itemId = `${kind}${i}`;
          resume[`${accountId}|${kind}|${itemId}`] = {
            accountId, kind, itemId, name: `Title ${i}`, poster: `http://host/poster/${i}`, ext: 'mp4',
            categoryId: kind === 'vod' ? '1' : '2', position: 100, duration: 600, updatedAt: n - i,
            ...(kind === 'episode' ? { watchlistOwner: { kind: 'series' as const, itemId: '20' } } : {}),
          };
        }
      }
    }
    localStorage.setItem('iptv_watchlist', JSON.stringify(watchlist));
    localStorage.setItem('iptv_resume', JSON.stringify(resume));
  }, count);
}

const layer = (page: Page, section = 'movies') =>
  page.locator(`#view-${section} .catalog-layer-grid`);

for (const section of ['movies', 'series'] as const) {
  for (const collection of ['continue', 'watchlist'] as const) {
    test(`${section} ${collection}: counted preview, a See all grid without editing, and remote navigation`, async ({ page }) => {
      await seedCollections(page);
      await page.goto('/');
      await enterTab(page, section);
      const rail = page.locator(`#view-${section} [data-rail-key="${collection}"]`);
      await expect(rail.locator('.catalog-tile:not(.catalog-see-all)')).toHaveCount(10);
      await expect(rail.locator('.catalog-see-all-count')).toContainText('30');
      await expect(rail.locator('button')).toHaveCount(0);
      const seeAll = rail.locator('[data-collection-see-all]');
      await seeAll.click();
      const grid = layer(page, section);
      await expect(grid.locator('.catalog-grid-title')).toContainText('30');
      if (section === 'series' && collection === 'continue') {
        await expect(grid.locator('.catalog-grid-count')).toHaveText('30 episodes');
      }
      await expect(grid.locator('.catalog-sort')).toHaveCount(0);
      await expect(grid.locator('button')).toHaveCount(0);
      await expect(page.locator(`#view-${section} .edit-hints`)).toHaveCount(0);
      const tiles = grid.locator('.catalog-tile[data-focusable]');
      await tiles.first().hover();
      await expect(tiles.first()).toHaveClass(/focused/);
      await page.keyboard.press('ArrowRight');
      await expect(tiles.nth(1)).toHaveClass(/focused/);
      await page.keyboard.press('Escape');
      await expect(page.locator(`#view-${section} .catalog-layer-browse`)).not.toHaveClass(/catalog-layer-hidden/);
      await expect(seeAll).toHaveClass(/focused/);
    });
  }
}

for (const section of ['movies', 'series'] as const) {
  test(`${section}: returns to the same collection title after playback changes its order`, async ({ page }) => {
    await seedCollections(page);
    await page.goto('/');
    await enterTab(page, section);
    await page.locator(`#view-${section} [data-rail-key="continue"] [data-collection-see-all]`).click();
    const grid = layer(page, section);
    const tile = grid.locator('.catalog-tile').nth(1);
    const key = await tile.getAttribute('data-key');
    await tile.click();
    await page.locator(`#view-${section} [data-action="resume"]`).click();
    await expect(page.locator('#view-player')).toBeVisible();
    await page.locator('#video-player').evaluate(video => {
      Object.defineProperty(video, 'duration', { configurable: true, get: () => 600 });
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 200 });
    });
    await leaveVod(page);
    await page.keyboard.press('Escape');
    await expect(grid.locator('.catalog-tile').first()).toHaveAttribute('data-key', key!);
    await expect(grid.locator('.catalog-tile.focused')).toHaveAttribute('data-key', key!);
  });
}

test('opens the series page from a Continue Watching episode, and Back returns to the episode', async ({ page }) => {
  await seedCollections(page, 4);
  await page.goto('/');
  await enterTab(page, 'series');
  const rail = page.locator('#view-series [data-rail-key="continue"]');
  const episode = rail.locator('[data-resume-episode="episode2"]');
  await episode.hover();
  await page.keyboard.press('Enter');
  const detail = page.locator('#view-series .catalog-layer-detail');
  await expect(detail).not.toHaveClass(/catalog-layer-hidden/);
  await expect(detail.locator('.detail-title')).toHaveText('Series One');
  await expect(detail.locator('[data-action="resume"]')).toBeVisible();
  await expect(page.locator('#view-player')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-series .catalog-layer-browse')).not.toHaveClass(/catalog-layer-hidden/);
  await expect(episode).toHaveClass(/focused/);
  await expect(page.locator('.focused:visible')).toHaveCount(1);
});

test('leaves the Watchlist rail after removing its final movie from detail', async ({ page }) => {
  await seedCollections(page, 1);
  await page.goto('/');
  await enterTab(page, 'movies');
  await page.locator('#view-movies [data-rail-key="watchlist"] .catalog-tile').click();
  const action = page.locator('#view-movies [data-action="watchlist"]');
  await action.click();
  await expect(action).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-movies [data-rail-key="watchlist"]')).toHaveCount(0);
  await expect(page.locator('#view-movies .catalog-layer-browse .focused')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#view-movies .catalog-layer-browse .focused')).toHaveCount(1);
});

test('leaves the Continue rail after completing its final episode from the series page', async ({ page }) => {
  await seedCollections(page, 1);
  await page.goto('/');
  await enterTab(page, 'series');
  await page.locator('#view-series [data-rail-key="continue"] .catalog-tile').click();
  await page.locator('#view-series [data-action="resume"]').click();
  await expect(page.locator('#view-player')).toBeVisible();
  await page.locator('#video-player').evaluate(video => {
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 600 });
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 599 });
  });
  await leaveVod(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-series [data-rail-key="continue"]')).toHaveCount(0);
  await expect(page.locator('#view-series .catalog-layer-browse .focused')).toHaveCount(1);
});

test('refreshes concealed collection counts when the unlock session expires without moving Settings focus', async ({ page }) => {
  await seedCollections(page, 1);
  await page.goto('/');
  await enterTab(page, 'settings');
  await page.locator('#manage-parental-controls').click();
  const prompt = page.locator('.parental-pin-prompt');
  await prompt.locator('.parental-pin-input').fill('1234');
  await expect(prompt.locator('h2')).toContainText('Confirm');
  await prompt.locator('.parental-pin-input').fill('1234');
  const manager = page.locator('#view-parental-controls');
  await expect(manager).toBeVisible();
  await manager.locator('#parental-kind [data-value="vod"]').click();
  const category = manager.locator('[data-parental-group]').filter({ hasText: 'Cat A' });
  await category.click();
  await expect(category).toContainText('Locked');
  await manager.locator('[data-parental-tab="options"]').click();
  await manager.locator('#parental-conceal [data-value="hide-locked"]').click();
  await expect(manager.locator('#parental-duration .active')).toHaveAttribute('data-value', '5-minutes');
  await page.clock.install();
  await manager.locator('[data-parental-back]').click();
  await expect(page.locator('#view-settings')).toBeVisible();
  await page.locator('[data-settings-target="data"]').click();
  const resumeHint = page.locator('#continue-watching-count-hint');
  const watchlistHint = page.locator('#watchlist-count-hint');
  await expect(resumeHint).toContainText('(2)');
  await expect(watchlistHint).toContainText('(2)');
  const clear = page.locator('#clear-continue-watching');
  await clear.hover();
  await expect(clear).toHaveClass(/focused/);
  const button = await clear.elementHandle();

  await page.clock.fastForward(5 * 60 * 1000 + 1);
  await expect(page.locator('[data-lock-now]')).toHaveCount(0);
  await expect(resumeHint).not.toContainText(/\(\d+\)/);
  await expect(watchlistHint).not.toContainText(/\(\d+\)/);
  await expect(clear).toHaveClass(/focused/);
  expect(await button!.evaluate(element => element === document.querySelector('#clear-continue-watching'))).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#view-settings .focused')).toHaveCount(1);
});

test('keeps one ring through a virtualized collection grid and back to its rail', async ({ page }) => {
  await seedCollections(page, 200);
  await page.goto('/');
  await enterTab(page, 'movies');
  const seeAll = page.locator('#view-movies [data-rail-key="watchlist"] [data-collection-see-all]');
  await seeAll.click();
  const grid = layer(page);
  await grid.locator('.catalog-tile[data-focusable]').first().hover();
  for (let i = 0; i < 32; i++) await page.keyboard.press('ArrowDown');
  await expect(grid.locator('.catalog-tile.focused')).toHaveAttribute('data-key', 'w:vod196');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(grid.locator('.catalog-tile.focused')).toHaveAttribute('data-key', 'w:vod199');
  expect(await grid.locator('.catalog-tile').count()).toBeLessThan(50);
  await expect(page.locator('.focused:visible')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(seeAll).toHaveClass(/focused/);
  await expect(page.locator('.focused:visible')).toHaveCount(1);
});

test('leaves a collection grid where each spaced wheel step stops it', async ({ page }) => {
  await seedCollections(page, 35);
  await page.goto('/');
  await enterTab(page, 'series');
  await page.locator('#view-series [data-rail-key="continue"] [data-collection-see-all]').click();
  const grid = layer(page, 'series');
  const view = grid.locator('.catalog-grid');
  await expect(view).toBeVisible();
  await page.mouse.move(700, 600);
  // Only the wheel may move the grid while the pointer rests.
  await view.evaluate(el => {
    const writes: string[] = [];
    (window as unknown as { gridWrites: string[] }).gridWrites = writes;
    const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get() { return top.get!.call(el) as number; },
      set(value: number) { writes.push(`scrollTop=${String(value)}`); top.set!.call(el, value); },
    });
    const reveal = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, ...args: unknown[]) {
      writes.push('scrollIntoView');
      return reveal.apply(this, args as []);
    };
  });
  const scrollTop = () => view.evaluate(el => el.scrollTop);
  const max = await view.evaluate(el => el.scrollHeight - el.clientHeight);
  let expected = 0;
  for (const step of [80, 80, 80, 80, -80, 80, -80, -80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80]) {
    expected = Math.max(0, Math.min(max, expected + step));
    await page.mouse.wheel(0, step);
    await expect.poll(scrollTop).toBe(expected);
    // Longer than any settle delay, so a late correction would show.
    await page.waitForTimeout(250);
    expect(await scrollTop()).toBe(expected);
  }
  expect(expected).toBe(max);
  expect(await page.evaluate(() => (window as unknown as { gridWrites: string[] }).gridWrites)).toEqual([]);
  expect(await grid.locator('.focused').count()).toBeLessThanOrEqual(1);
});

test('rejects a full Watchlist without replacing saved titles and shows an actionable message', async ({ page }) => {
  await seedCollections(page, 200);
  await page.goto('/');
  await enterTab(page, 'movies');
  await page.locator('#view-movies [data-rail-key="cat:1"] .catalog-tile').first().click();
  await page.locator('#view-movies [data-action="watchlist"]').click();
  await expect(page.locator('.toast').filter({ hasText: 'Watchlist is full' })).toBeVisible();
  await expect(page.locator('#view-movies [data-action="watchlist"]')).toHaveAttribute('aria-pressed', 'false');
  const rows = await readUserDataStore<WatchlistEntry>(page, 'watchlist');
  expect(rows.filter(row => row.value.accountId === 'x1' && row.value.kind === 'vod')).toHaveLength(200);
  expect(rows.some(row => row.value.itemId === 'vod199')).toBe(true);
  expect(rows.some(row => row.value.itemId === '10')).toBe(false);
});

