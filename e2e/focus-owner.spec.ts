import {
  test,
  expect,
  enterTab,
  neuterVideo,
  routeLiveManifest,
  routePlaylist,
  seedPlaylist,
  PLAYLIST_URL,
  type Page,
} from './helpers';

// channelKey mirrors src/utils/channel.ts (fnv1a of the URL sans query/fragment).
function channelKey(url: string): string {
  const stable = url.split('#')[0].split('?')[0];
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) { h ^= stable.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const CHAN_ONE = 'http://streams.example.com/one.m3u8';

// A reminder that comes due on the first scan after the clock runs past it,
// so it pops up over whatever owns the keys by then.
async function seedLaterReminder(page: Page): Promise<void> {
  await page.addInitScript((k) => {
    const now = Date.now();
    localStorage.setItem('iptv_reminders', JSON.stringify([
      { channelKey: k, channelName: 'Channel One', title: 'Alpha', startMs: now + 10000, stopMs: now + 3600000 },
    ]));
  }, channelKey(CHAN_ONE));
}

async function setup(page: Page): Promise<void> {
  await page.clock.install();
  await neuterVideo(page);
  await routePlaylist(page);
  await routeLiveManifest(page);
  await seedPlaylist(page, PLAYLIST_URL);
  await seedLaterReminder(page);
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();
}

const owner = (page: Page) => page.locator('[data-ring-owner]');

async function reminderComesDue(page: Page): Promise<void> {
  await page.clock.runFor(35000);
  await expect(page.locator('.reminder-prompt:not(.hidden)')).toBeVisible();
}

test('the parental PIN keeps the keys over a reminder that comes due under it', async ({ page }) => {
  await setup(page);
  await enterTab(page, 'settings');
  await page.locator('#manage-parental-controls').click();
  await expect(page.locator('.parental-pin-prompt')).toBeVisible();
  await expect(owner(page)).toHaveAttribute('data-focus-scope', 'prompt.parental_pin');

  await reminderComesDue(page);
  await expect(owner(page)).toHaveAttribute('data-focus-scope', 'prompt.parental_pin');

  await page.keyboard.press('Escape');
  await expect(page.locator('.parental-pin-prompt')).toBeHidden();
  await expect(owner(page)).toHaveAttribute('data-focus-scope', 'prompt.reminder');
});

test('a reminder takes the keys from the tab bar and gives them back', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('ArrowUp');
  await expect(owner(page)).toHaveAttribute('data-focus-scope', 'tabbar');

  await reminderComesDue(page);
  await expect(owner(page)).toHaveAttribute('data-focus-scope', 'prompt.reminder');

  await page.keyboard.press('Escape');
  await expect(page.locator('.reminder-prompt:not(.hidden)')).toHaveCount(0);
  await expect(owner(page)).toHaveAttribute('data-focus-scope', 'tabbar');
});
