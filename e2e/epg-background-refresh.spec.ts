import { test, expect, enterTab } from './helpers';
import { seedXtream } from './fixtures/xtream';

test.use({ timezoneId: 'UTC' });

// Three programmes on Channel One; the third is on after the 6 h refresh.
const programme = (start: string, stop: string, title: string) =>
  `<programme channel="one" start="${start} +0000" stop="${stop} +0000"><title>${title}</title></programme>`;
const EPG = `<tv><channel id="one"><display-name>Channel One</display-name></channel>${
  programme('20260915110000', '20260915130000', 'Program 1')}${
  programme('20260915130000', '20260915180000', 'Program 2')}${
  programme('20260915180000', '20260916000000', 'Program 3')}</tv>`;

// The playlist and guide refreshes come due together while Live is hidden:
// Live must wait for its next show to render, and the guide is fetched once.
test('a background refresh renders nothing in hidden Live and fetches the guide once', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date('2026-09-15T12:00:00Z') });
  await seedXtream(page);
  let guideFetches = 0;
  await page.route('**/xmltv.php*', (route) => {
    guideFetches++;
    return route.fulfill({ status: 200, contentType: 'application/xml', body: EPG });
  });
  await page.route('http://epg.example.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: EPG }));
  await page.goto('/');
  await enterTab(page, 'live');
  const row = page.locator('#view-channels .channel-main .channel-item', { hasText: 'Channel One' });
  await expect(row.locator('.channel-now')).toHaveText('Program 1');

  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies .catalog-layer-browse')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { liveMutations: number };
    w.liveMutations = 0;
    new MutationObserver((records) => { w.liveMutations += records.length; })
      .observe(document.getElementById('view-channels')!, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
  });
  const fetchesBefore = guideFetches;
  // Past the 6 h playlist and guide intervals, an hour at a time.
  for (let hour = 0; hour < 7; hour++) {
    await page.clock.runFor(60 * 60 * 1000);
    await page.waitForTimeout(300);
  }
  await expect.poll(() => guideFetches - fetchesBefore).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const mutations = await page.evaluate(() =>
    (window as unknown as { liveMutations: number }).liveMutations);
  test.info().annotations.push({
    type: 'background refresh',
    description: `mutations ${String(mutations)}, guide fetches ${String(guideFetches - fetchesBefore)}`,
  });
  expect(mutations).toBe(0);
  expect(guideFetches - fetchesBefore).toBe(1);

  await enterTab(page, 'live');
  await expect(row.locator('.channel-now')).toHaveText('Program 3');
});
