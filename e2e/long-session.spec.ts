import {
  test, expect, enterTab, isChromium53, pressKeys, routeLiveManifest, type Page,
} from './helpers';
import { seedXtream } from './fixtures/xtream';

// A TV session tours every section many times. Each tour must hand back what
// it took: the nodes and listeners return to the first tour's level, Home
// runs no more than its own timers and no worker, and no hidden view holds
// a decoded poster.
const CYCLES = 5;
const KEY = { UP: 38, DOWN: 40, RIGHT: 39, ENTER: 13, BACK: 461, RED: 403 };

interface Budget {
  timers: Map<string, string>;
  workers: number;
}

// Counts pending timers and frames, and workers not yet terminated.
function instrument(): void {
  const w = window as unknown as Window & { __budget: Budget };
  const budget: Budget = { timers: new Map(), workers: 0 };
  w.__budget = budget;
  const { setTimeout: st, clearTimeout: ct, setInterval: si, clearInterval: ci } = window;
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const site = () => (new Error().stack ?? '').split('\n')[3]?.trim() ?? '';
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = st(() => {
      budget.timers.delete(`t${String(id)}`);
      if (typeof fn === 'function') (fn as (...a: unknown[]) => void)(...args);
    }, ms);
    budget.timers.set(`t${String(id)}`, `timeout(${String(ms ?? 0)}) ${site()}`);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    budget.timers.delete(`t${String(id)}`);
    ct(id);
  }) as typeof window.clearTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = si(fn, ms, ...args);
    budget.timers.set(`i${String(id)}`, `interval(${String(ms ?? 0)}) ${site()}`);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    budget.timers.delete(`i${String(id)}`);
    ci(id);
  }) as typeof window.clearInterval;
  window.requestAnimationFrame = (fn: FrameRequestCallback) => {
    const id = raf((time) => {
      budget.timers.delete(`r${String(id)}`);
      fn(time);
    });
    budget.timers.set(`r${String(id)}`, `frame ${site()}`);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    budget.timers.delete(`r${String(id)}`);
    caf(id);
  };
  const NativeWorker = window.Worker;
  window.Worker = function (url: string | URL, options?: WorkerOptions) {
    const worker = new NativeWorker(url, options);
    budget.workers++;
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      budget.workers--;
      terminate();
    };
    return worker;
  } as unknown as typeof Worker;
  window.Worker.prototype = NativeWorker.prototype;
}

// A guide around now, so the Guide has programmes to scroll through.
function guideXml(): string {
  const hour = 3600_000;
  const start = Math.floor(Date.now() / hour) * hour - 2 * hour;
  const stamp = (ms: number) => `${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
  const programmes = ['one', 'two'].flatMap(channel => Array.from({ length: 12 }, (_, i) =>
    `<programme channel="${channel}" start="${stamp(start + i * hour)}" stop="${stamp(start + (i + 1) * hour)}">`
    + `<title>Program ${String(i + 1)}</title></programme>`));
  return `<tv><channel id="one"><display-name>Channel One</display-name></channel>`
    + `<channel id="two"><display-name>Channel Two</display-name></channel>${programmes.join('')}</tv>`;
}

const hover = (page: Page, selector: string) => page.locator(selector).first()
  .evaluate(el => el.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true })));

async function live(page: Page): Promise<void> {
  await enterTab(page, 'live');
  await expect(page.locator('#view-channels .channel-main .channel-item')).toHaveCount(2);
  await pressKeys(page, KEY.DOWN, KEY.DOWN, KEY.UP);
  await expect(page.locator('#live-preview .live-preview-channel')).toBeVisible();
  await pressKeys(page, KEY.RED);
  await expect(page.locator('#view-channels.live-guide-mode #live-guide .guide-cell').first()).toBeVisible();
  await pressKeys(page, KEY.DOWN, ...Array<number>(6).fill(KEY.RIGHT));
  await pressKeys(page, KEY.RED);
  await expect(page.locator('#view-channels.live-guide-mode')).toHaveCount(0);
}

async function movies(page: Page): Promise<void> {
  await enterTab(page, 'movies');
  const browse = '#view-movies .catalog-layer-browse';
  await expect(page.locator(`${browse} .catalog-tile`).first()).toBeVisible();
  for (const id of ['10', '1002']) {
    await hover(page, `${browse} .catalog-tile[data-item-id="${id}"]`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-movies .catalog-layer-detail .detail-title')).toBeVisible();
    await pressKeys(page, KEY.BACK);
    await expect(page.locator(browse)).toBeVisible();
  }
  await hover(page, `${browse} .catalog-see-all[data-category-id="1"]`);
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies .catalog-layer-grid .catalog-grid-track .catalog-tile').first())
    .toBeVisible();
  await pressKeys(page, KEY.DOWN, KEY.DOWN, KEY.BACK);
  await expect(page.locator(browse)).toBeVisible();
}

async function series(page: Page): Promise<void> {
  await enterTab(page, 'series');
  const browse = '#view-series .catalog-layer-browse';
  await expect(page.locator(`${browse} .catalog-tile`).first()).toBeVisible();
  await hover(page, `${browse} .catalog-tile[data-item-id="20"]`);
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-series .catalog-layer-detail .detail-title')).toBeVisible();
  await pressKeys(page, KEY.BACK);
  await expect(page.locator(browse)).toBeVisible();
}

async function search(page: Page): Promise<void> {
  await enterTab(page, 'search');
  const box = page.locator('.search-box-input');
  for (const query of ['movie', 'channel']) {
    await box.fill(query);
    await expect(page.locator('#view-search [data-focusable]').first()).toBeVisible();
  }
}

async function settings(page: Page): Promise<void> {
  await enterTab(page, 'settings');
  await expect(page.locator('#view-settings .settings-view')).toBeVisible();
  await pressKeys(page, KEY.DOWN, KEY.DOWN);
}

test('a long session returns its nodes, listeners, timers and workers', async ({ page }) => {
  test.skip(isChromium53(), 'reads Blink counters through CDP, which the simulation adds nothing to');
  test.setTimeout(120_000);
  await page.addInitScript(instrument);
  await seedXtream(page, { catalog: 'large', posters: true });
  await page.route('**/xmltv.php*', route =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: guideXml() }));
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const settle = async () => {
    await page.waitForFunction(() => !(window as { __ringPending?: number }).__ringPending);
    // The app worker ends a second after its last task; a prewarm may follow.
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __budget: Budget }).__budget.workers), { timeout: 15_000 }).toBe(0);
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const value = (name: string) => metrics.find(m => m.name === name)?.value ?? 0;
    const page_ = await page.evaluate(() => ({
      timers: Array.from((window as unknown as { __budget: Budget }).__budget.timers.values()),
      // The loading view's logo is static markup, not a page that was left.
      hiddenImages: Array.from(document.querySelectorAll('.view.hidden:not(#view-loading) img'), img =>
        `${img.closest('.view')!.id} ${img.className}`),
    }));
    return { nodes: value('Nodes'), listeners: value('JSEventListeners'), ...page_ };
  };

  const tour = async () => {
    await live(page);
    await movies(page);
    await series(page);
    await search(page);
    await settings(page);
    await enterTab(page, 'home');
  };

  await tour();
  const baseline = await settle();
  const report = [`cycle 1: nodes ${String(baseline.nodes)}, listeners ${String(baseline.listeners)}, `
    + `timers ${String(baseline.timers.length)}`];
  let last = baseline;
  for (let cycle = 2; cycle <= CYCLES; cycle++) {
    await tour();
    last = await settle();
    report.push(`cycle ${String(cycle)}: nodes ${String(last.nodes)}, listeners ${String(last.listeners)}, `
      + `timers ${String(last.timers.length)}`);
    expect(last.timers.length, last.timers.join('\n')).toBeLessThanOrEqual(4);
    expect(last.hiddenImages).toEqual([]);
  }
  test.info().annotations.push({ type: 'budget', description: report.join('; ') });
  expect(baseline.hiddenImages).toEqual([]);
  expect(last.nodes).toBeLessThanOrEqual(baseline.nodes * 1.05);
  expect(last.listeners).toBeLessThanOrEqual(baseline.listeners * 1.05);
});
