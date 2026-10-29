import { test, expect, enterTab, routePlaylist, seedPlaylist, type Page } from './helpers';
import { seedXtream } from './fixtures/xtream';

const SIZES = ['90', '110', '120', '130'] as const;

async function seedInterfaceSize(page: Page, size: string): Promise<void> {
  await page.addInitScript((s) => {
    localStorage.setItem('iptv_interface_size', JSON.stringify(s));
  }, size);
}

// Focus targets the screen edge cuts off, rather than a scroll container: the
// part of each target its clipping ancestors leave visible must fit 1920x1080.
async function offscreenTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = 1920;
    const H = 1080;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-focusable]'))) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || !el.offsetParent) continue;
      let left = rect.left;
      let top = rect.top;
      let right = rect.right;
      let bottom = rect.bottom;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const box = a.getBoundingClientRect();
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        right = Math.min(right, box.right);
        bottom = Math.min(bottom, box.bottom);
      }
      if (right <= left || bottom <= top) continue;
      if (left < -1 || top < -1 || right > W + 1 || bottom > H + 1) {
        const label = el.id || el.dataset.key || el.className.toString().split(' ')[0];
        out.push(`${label} [${Math.round(left)},${Math.round(top)} → ${Math.round(right)},${Math.round(bottom)}]`);
      }
    }
    return out;
  });
}

for (const size of SIZES) {
  test(`at ${size}% every view scales and keeps its targets on screen`, async ({ page }) => {
    const scale = Number(size) / 100;
    await seedXtream(page, { catalog: 'large' });
    await seedInterfaceSize(page, size);
    await page.goto('/');
    await expect(page.locator('#view-channels')).toBeVisible();

    const barHeight = await page.locator('.tab-bar').evaluate((el) => el.getBoundingClientRect().height);
    expect(barHeight).toBeCloseTo(96 * scale, 0);
    expect(await offscreenTargets(page), 'Live').toEqual([]);

    for (const [section, view] of [
      ['epg', '#view-epg'],
      ['movies', '#view-movies'],
      ['series', '#view-series'],
    ] as const) {
      await enterTab(page, section);
      await expect(page.locator(view)).toBeVisible();
      await page.waitForTimeout(300);
      expect(await offscreenTargets(page), section).toEqual([]);
    }

    await enterTab(page, 'search');
    await expect(page.locator('.tab-bar-search.expanded')).toBeVisible();
    await page.locator('.tab-bar-search-input').fill('movie');
    await expect(page.locator('#view-search')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await offscreenTargets(page), 'search').toEqual([]);

    await enterTab(page, 'settings');
    await expect(page.locator('#view-settings')).toBeVisible();
    for (const category of ['general', 'sources', 'guide', 'appearance', 'playback', 'subtitles', 'advanced', 'data']) {
      await page.locator(`[data-settings-target="${category}"]`).click();
      await page.waitForTimeout(150);
      // Settings scrolls its categories; only its frame and actions must fit.
      const actions = await page.locator('#save-settings').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { right: r.right, bottom: r.bottom };
      });
      expect(actions.bottom, `${category}: Save sits on screen`).toBeLessThanOrEqual(1081);
      expect(actions.right, `${category}: Save sits on screen`).toBeLessThanOrEqual(1921);
    }
  });
}

test('at 130% the virtualized channel list keeps rows, D-pad, and pointer aligned', async ({ page }) => {
  const m3u = ['#EXTM3U', ...Array.from({ length: 80 }, (_, i) => (
    `#EXTINF:-1 group-title="Group 1",Channel ${String(i + 1)}\nhttp://host/${String(i + 1)}.m3u8`))].join('\n');
  await routePlaylist(page, m3u);
  await seedPlaylist(page);
  await seedInterfaceSize(page, '130');
  await page.goto('/');
  await expect(page.locator('#view-channels')).toBeVisible();

  // The virtualizer's stride matches the CSS row height at this scale.
  const tops = await page.locator('#view-channels .channel-item').evaluateAll((rows) =>
    rows.slice(0, 3).map((row) => row.getBoundingClientRect().top));
  expect(tops[1] - tops[0]).toBeCloseTo(88 * 1.3, 0);
  expect(tops[2] - tops[1]).toBeCloseTo(88 * 1.3, 0);

  // Scroll far down the list with the D-pad; the focused row stays inside it.
  const focusedName = () => page.locator('#view-channels .channel-item.focused .channel-name').innerText();
  const start = Number((await focusedName()).replace(/\D+/g, ''));
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  expect(await focusedName()).toBe(`Channel ${String(start + 30)}`);
  const fit = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('#view-channels .channel-item.focused');
    const list = row?.closest<HTMLElement>('.channel-list-scroll, [data-nav-container]');
    if (!row || !list) return null;
    const r = row.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return { inside: r.top >= l.top - 1 && r.bottom <= l.bottom + 1 };
  });
  expect(fit?.inside).toBe(true);

  // A pointer over a visible row's center targets that row, not a neighbor.
  const key = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('#view-channels .channel-item'));
    const list = rows[0]?.closest<HTMLElement>('[data-nav-container]');
    const l = list?.getBoundingClientRect();
    const visible = rows.filter((row) => {
      const r = row.getBoundingClientRect();
      return l && !row.classList.contains('focused') && r.top >= l.top && r.bottom <= l.bottom;
    });
    return visible[Math.floor(visible.length / 2)]?.dataset.key ?? null;
  });
  if (!key) throw new Error('no fully visible row');
  const target = page.locator(`#view-channels .channel-item[data-key="${key}"]`);
  const box = await target.boundingBox();
  if (!box) throw new Error('row has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(target).toHaveClass(/focused/);
});

test('the interface size previews live, reverts on Cancel, and persists on Save', async ({ page }) => {
  await routePlaylist(page);
  await seedPlaylist(page);
  await page.goto('/');
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings')).toBeVisible();
  const root = page.locator('html');

  await page.locator('[data-settings-target="appearance"]').click();
  await page.locator('#interface-size .dropdown-trigger').click();
  await page.locator('#interface-size .dropdown-option[data-dropdown-value="120"]').click();
  await expect(root).toHaveAttribute('data-interface-size', '120');
  const radius = await page.locator('#save-settings').evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(radius).toBeCloseTo(8 * 1.2, 1);

  await page.locator('#cancel-settings').click();
  await expect(root).toHaveAttribute('data-interface-size', '100');

  await enterTab(page, 'settings');
  await page.locator('[data-settings-target="appearance"]').click();
  await page.locator('#interface-size .dropdown-trigger').click();
  await page.locator('#interface-size .dropdown-option[data-dropdown-value="120"]').click();
  await page.locator('#save-settings').click();
  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(root).toHaveAttribute('data-interface-size', '120');

  await page.reload();
  await expect(page.locator('#view-channels')).toBeVisible();
  await expect(root).toHaveAttribute('data-interface-size', '120');
});
