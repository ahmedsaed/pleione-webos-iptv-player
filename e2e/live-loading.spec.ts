import {
  test,
  expect,
  showHome,
  seedPlaylist,
  pressKeys,
  enterTab,
  routeLiveManifest,
  SAMPLE_M3U,
  type Page,
} from './helpers';

// Home loads no channels, so the first open of Live loads them. Live shows at
// once with its header and a loading state where the rows go, as a slow
// provider on a TV takes seconds.

const press = (page: Page, key: string) => page.keyboard.press(key);
const live = (page: Page) => page.locator('#view-channels');
const status = (page: Page) => live(page).locator('.live-load-status');
const rows = (page: Page) => live(page).locator('.channel-main .channel-item');

// The playlist answers only when released; `fail` answers with a 404, which
// fails at once where a 5xx would retry.
function holdPlaylist(page: Page): { release: () => void; fail: boolean; requests: number } {
  const gate = { release: () => {}, fail: false, requests: 0 };
  let held = new Promise<void>((resolve) => { gate.release = resolve; });
  void page.route('**/playlist.m3u', async (route) => {
    gate.requests++;
    await held;
    held = new Promise<void>((resolve) => { gate.release = resolve; });
    if (gate.fail) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U });
    }
  });
  return gate;
}

async function openHome(page: Page): Promise<void> {
  await seedPlaylist(page);
  await showHome(page);
  await page.goto('/');
  await expect(page.locator('#view-home .focused')).toHaveAttribute('data-section', 'live');
}

// Only the surface with the keys shows a ring: `count` rings on screen.
async function expectRings(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.locator('.focused').evaluateAll((els) => els.filter((el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }).length)).toBe(count);
}

test('Live opens at once with its header and a loading state, then the rows', async ({ page }) => {
  const gate = holdPlaylist(page);
  await openHome(page);
  await press(page, 'Enter');

  await expect(live(page)).toBeVisible();
  await expect(page.locator('#view-home')).toBeHidden();
  await expect(live(page).locator('.live-header-title')).toHaveText('Live');
  await expect(live(page).locator('.live-mode-option.active')).toHaveAttribute('data-live-mode', 'list');
  await expect(live(page).locator('.live-header-clock')).toHaveText(/^\d\d:\d\d$/);
  await expect(status(page)).toHaveText('Loading channels…');
  await expect(status(page).locator('.loading-spinner')).toBeVisible();
  // Nothing to focus yet: no count, no Edit, no rows, no ring.
  await expect(live(page).locator('.live-header-count')).toHaveCount(0);
  await expect(live(page).locator('.live-header-edit')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  await expectRings(page, 0);
  // Keys while loading do nothing, and the header stays out of reach.
  await press(page, 'ArrowUp');
  await press(page, 'ArrowDown');
  await expectRings(page, 0);
  // Centered under the header, in place of the panes.
  const header = (await live(page).locator('.live-header').boundingBox())!;
  const ring = (await status(page).locator('.loading-spinner').boundingBox())!;
  expect(ring.y).toBeGreaterThan(header.y + header.height);
  expect(ring.x + ring.width / 2).toBeCloseTo(960, -1);

  gate.release();
  await expect(rows(page)).toHaveCount(2);
  await expect(status(page)).toHaveCount(0);
  await expect(live(page).locator('.live-header-count')).toHaveText('2 channels');
  // The header stays put, and the first row has focus.
  expect(await live(page).locator('.live-header').boundingBox()).toEqual(header);
  await expect(rows(page).first()).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
  // The header count stands in for the old "channels loaded" toast.
  await expect(page.locator('.toast.visible')).toHaveCount(0);
});

test('Back while Live loads goes Home, and the load does not pull Live back', async ({ page }) => {
  const gate = holdPlaylist(page);
  await openHome(page);
  await press(page, 'Enter');
  await expect(status(page)).toBeVisible();

  await press(page, 'Escape');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(live(page)).toBeHidden();
  await expect(page.locator('#view-home .focused')).toHaveAttribute('data-section', 'live');
  await expectRings(page, 1);

  gate.release();
  await expect.poll(() => gate.requests).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(live(page)).toBeHidden();
  await expect(page.locator('#view-home .focused')).toHaveAttribute('data-section', 'live');
  await expectRings(page, 1);

  // The channels are in: Live opens straight onto its rows.
  await press(page, 'Enter');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
});

test('a failed load shows the error in Live, and Try again recovers', async ({ page }) => {
  const gate = holdPlaylist(page);
  gate.fail = true;
  await openHome(page);
  await press(page, 'Enter');
  await expect(status(page)).toHaveText('Loading channels…');
  gate.release();

  const retry = status(page).locator('[data-key="live-retry"]');
  await expect(status(page)).toContainText('Unable to load the playlist. Check the URL and try again.');
  await expect(retry).toHaveText('Try again');
  await expect(live(page)).toBeVisible();
  await expect(page.locator('#view-settings')).toBeHidden();
  await expect(retry).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
  await press(page, 'ArrowUp');
  await expect(retry).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);

  gate.fail = false;
  await press(page, 'Enter');
  await expect(status(page)).toHaveText('Loading channels…');
  await expectRings(page, 0);
  gate.release();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
});

test('Back from the error goes Home, and Live tries again on the next open', async ({ page }) => {
  const gate = holdPlaylist(page);
  gate.fail = true;
  await openHome(page);
  await press(page, 'Enter');
  gate.release();
  await expect(status(page).locator('[data-key="live-retry"]')).toBeVisible();

  await press(page, 'Escape');
  await expect(page.locator('#view-home .focused')).toHaveAttribute('data-section', 'live');
  await expectRings(page, 1);

  gate.fail = false;
  await press(page, 'Enter');
  await expect(status(page)).toHaveText('Loading channels…');
  gate.release();
  await expect(rows(page)).toHaveCount(2);
  expect(gate.requests).toBe(2);
});

test('the Guide opened from Home with Red shows the same loading state', async ({ page }) => {
  const gate = holdPlaylist(page);
  await openHome(page);
  await pressKeys(page, 403);

  await expect(live(page)).toBeVisible();
  await expect(live(page).locator('.live-mode-option.active')).toHaveAttribute('data-live-mode', 'guide');
  await expect(status(page)).toHaveText('Loading channels…');
  await expectRings(page, 0);

  gate.release();
  await expect(page.locator('#view-channels.live-guide-mode #live-guide .guide-cell').first()).toBeVisible();
  await expect(status(page)).toHaveCount(0);
  await expectRings(page, 1);
});

test('a channel number typed on Home shows Live loading, then plays the channel', async ({ page }) => {
  const gate = holdPlaylist(page);
  await routeLiveManifest(page);
  await openHome(page);
  await press(page, '2');

  await expect(status(page)).toHaveText('Loading channels…');
  gate.release();
  await expect(page.locator('#view-player')).toBeVisible();
  await expect(page.locator('#player-osd .osd-channel-name')).toContainText('Channel Two');
  // Playback typed on Home still returns there.
  await press(page, 'Escape');
  if (await page.locator('#view-player').isVisible()) await press(page, 'Escape');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(live(page)).toBeHidden();
});

test('a click on the Live card shows the loading state, and the first key shows the ring', async ({ page }) => {
  const gate = holdPlaylist(page);
  await openHome(page);
  await enterTab(page, 'live');
  await expect(status(page)).toHaveText('Loading channels…');

  gate.release();
  await expect(rows(page)).toHaveCount(2);
  await expectRings(page, 0);
  await press(page, 'ArrowDown');
  await expect(rows(page).first()).toHaveClass(/\bfocused\b/);
  await expectRings(page, 1);
});
