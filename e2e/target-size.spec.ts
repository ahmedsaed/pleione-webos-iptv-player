import {
  test, expect, enterTab, openGuide, pressKeys, type Page,
} from './helpers';
import { seedXtream } from './fixtures/xtream';

// LG's Content Store recommendations at 1920x1080: readable text of at least
// 20px and remote or pointer targets of at least 75px. A wide target (a
// button, a row) needs only the height.
test.use({ startOn: 'live' });

const MIN_TEXT = 20;
const MIN_TARGET = 75;

interface Undersized { text: string[]; targets: string[] }

async function undersized(page: Page): Promise<Undersized> {
  return page.evaluate(({ minText, minTarget }) => {
    const shown = (el: Element): DOMRect | null => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.right < 0 || rect.bottom < 0
        || rect.left > 1920 || rect.top > 1080) return null;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
      }
      return rect;
    };
    const label = (el: Element): string => `${el.tagName.toLowerCase()}.${
      (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.')}`;
    const text = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      // The theme swatches draw a miniature of the app, not text to read.
      if (!el || !node.textContent?.trim() || el.closest('svg, .theme-swatch-preview')) continue;
      if (!shown(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < minText - 0.01) text.add(`${label(el)} ${String(size)}px`);
    }
    const targets = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('[data-focusable], button'))) {
      const rect = shown(el);
      if (!rect) continue;
      // A Guide cell's width is its program's length; only its height is a target size.
      const wide = el.matches('[data-guide-cell]');
      if (rect.height < minTarget - 0.5 || (!wide && rect.width < minTarget - 0.5)) {
        targets.add(`${label(el)} ${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`);
      }
    }
    return { text: [...text], targets: [...targets] };
  }, { minText: MIN_TEXT, minTarget: MIN_TARGET });
}

const none: Undersized = { text: [], targets: [] };

test('text and focus targets meet the TV minimums on every main screen', async ({ page }) => {
  test.slow();
  await seedXtream(page, { catalog: 'large' });
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  expect(await undersized(page), 'Live').toEqual(none);
  await pressKeys(page, 37);
  expect(await undersized(page), 'Live groups').toEqual(none);
  await openGuide(page);
  expect(await undersized(page), 'Guide').toEqual(none);
  await pressKeys(page, 403);
  await expect(page.locator('#view-channels:not(.live-guide-mode)')).toBeVisible();

  for (const [section, view] of [
    ['home', '#view-home'],
    ['movies', '#view-movies'],
    ['series', '#view-series'],
  ] as const) {
    await enterTab(page, section);
    await expect(page.locator(view)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await undersized(page), section).toEqual(none);
  }

  await page.locator('#view-series .catalog-layer-browse .catalog-tile').first()
    .evaluate(el => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-series .catalog-layer-detail .detail-title')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await undersized(page), 'series detail').toEqual(none);

  await enterTab(page, 'search');
  await page.locator('.search-box-input').fill('movie');
  await page.waitForTimeout(300);
  expect(await undersized(page), 'search').toEqual(none);

  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings')).toBeVisible();
  for (const category of ['general', 'sources', 'guide', 'appearance', 'playback', 'subtitles', 'advanced', 'data']) {
    await page.locator(`[data-settings-target="${category}"]`).click();
    await page.waitForTimeout(150);
    expect(await undersized(page), `Settings ${category}`).toEqual(none);
  }
});
