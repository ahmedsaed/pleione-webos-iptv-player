import { appendFileSync } from 'node:fs';
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { postTargetApis, removeApis } from '../scripts/chromium-53-simulation.mjs';

export { expect, type Page };

export const PLAYLIST_URL = 'http://host.example.com/playlist.m3u';

export const SAMPLE_M3U = [
  '#EXTM3U url-tvg="http://epg.example.com/guide.xml"',
  '#EXTINF:-1 tvg-id="one" group-title="News",Channel One',
  'http://streams.example.com/one.m3u8',
  '#EXTINF:-1 tvg-id="two" group-title="Movies",Channel Two',
  'http://streams.example.com/two.m3u8',
].join('\n');

export const SEARCH_M3U = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="News",Alpha News',
  'http://streams.example.com/1.m3u8',
  '#EXTINF:-1 group-title="News",Beta News',
  'http://streams.example.com/2.m3u8',
  '#EXTINF:-1 group-title="Entertainment",Alpha Movies',
  'http://streams.example.com/3.m3u8',
  '#EXTINF:-1 group-title="Sports",Delta Sports',
  'http://streams.example.com/4.m3u8',
].join('\n');

// A minimal segment-less *live* HLS manifest: hls.js reaches MANIFEST_PARSED and
// just polls for live segments — no fatal error, so no auto-zap to the next
// channel and the OSD keeps showing channel info.
export const LIVE_MANIFEST =
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n';

/**
 * The app connects to the bundled webOS LAN service at 127.0.0.1:8890 (see
 * UploadClient.reconcile). It is not running in the preview/e2e environment, so
 * chromium would spend hundreds of ms per probe waiting for the connection to be
 * refused — enough to push toast/view assertions past their 5s timeout on slower
 * runs. Aborting these requests immediately keeps every test snappy; it runs
 * automatically via the extended `test` below.
 */
export async function stubUploadService(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:8890/**', (route) => route.abort());
}

/**
 * A spec that seeds a synthetic Xtream account without routing its Player
 * API, or loads SAMPLE_M3U without routing its guide, would reach the
 * network, and the app retries a network error for seconds. Answer either
 * with a 404 instead: it fails at once, as an unreachable provider did
 * before retries. A spec's own route, or a real local server, still answers.
 */
export async function stubProviderApi(page: Page): Promise<void> {
  const notFound = (route: Route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  await page.route(
    (url) => url.hostname.endsWith('example.com') && url.pathname.endsWith('/player_api.php'),
    notFound,
  );
  await page.route('http://epg.example.com/**', notFound);
}

/** Serve an M3U body for the configured playlist URL (glob-matched by filename). */
export async function routePlaylist(page: Page, body = SAMPLE_M3U): Promise<void> {
  await page.route('**/playlist.m3u', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body }));
}

/** Serve the minimal live manifest for any *.m3u8 stream. */
export async function routeLiveManifest(page: Page): Promise<void> {
  await page.route('**/*.m3u8', (route) =>
    route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: LIVE_MANIFEST }));
}

export async function readUserDataStore<T>(
  page: Page,
  storeName: string,
): Promise<{ key: string; value: T }[]> {
  return page.evaluate((store) => new Promise((resolve, reject) => {
    const open = indexedDB.open('iptv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      tx.oncomplete = () => db.close();
    };
  }), storeName) as Promise<{ key: string; value: T }[]>;
}

/**
 * Keep VOD alive in the player by neutering the <video> element so an empty mock
 * movie/episode body can't fire `error` and auto-eject back to the catalog. The
 * player's VOD error handler (player.ts `onError`) calls the very `onBack()` the
 * Back key uses, so without this the eject races the test's own scripted
 * navigation and drops the detail screen. Must run before the page loads.
 */
export async function neuterVideo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const P = HTMLMediaElement.prototype;
    P.load = function () { /* no-op */ };
    P.play = function () { return Promise.resolve(); };
    Object.defineProperty(P, 'src', { configurable: true, set() { /* no-op */ }, get() { return ''; } });
  });
}

export interface PlayerKeyState {
  osdBefore: boolean;
  osd: boolean;
  message: boolean;
  player: boolean;
  menu: boolean;
  paused: boolean;
  currentTime: number;
}

// Press remote keys and read the player back in the same page task, so the OSD's
// auto-hide or a stream retry can't land in between.
export async function pressAndReadPlayer(page: Page, keyCodes: number[]): Promise<PlayerKeyState> {
  return (await pressStepsAndReadPlayer(page, [keyCodes]))[0];
}

// Each step's keys and the read after them, all in one page task: a fake
// stream's retry would otherwise resume a paused element between steps.
export async function pressStepsAndReadPlayer(page: Page, steps: number[][]): Promise<PlayerKeyState[]> {
  return page.evaluate((keySteps) => {
    const shown = (id: string) => document.getElementById(id)!.getClientRects().length > 0;
    const video = document.getElementById('video-player') as HTMLVideoElement;
    return keySteps.map((codes) => {
      const osdBefore = shown('player-osd');
      for (const keyCode of codes) {
        document.dispatchEvent(new KeyboardEvent('keydown', { keyCode, bubbles: true }));
      }
      return {
        osdBefore,
        osd: shown('player-osd'),
        message: document.querySelector('#player-osd .osd-message') !== null,
        player: shown('view-player'),
        menu: document.getElementById('player-menu')!.classList.contains('visible'),
        paused: video.paused,
        currentTime: video.currentTime,
      };
    });
  }, steps);
}

/** Leave VOD playback with Back: the first Back hides the controls if they show. */
export async function leaveVod(page: Page): Promise<void> {
  const back = () => page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
  await back();
  if (await page.locator('#view-player').isVisible()) await back();
  await expect(page.locator('#view-player')).toBeHidden();
}

/** Pre-seed one configured URL playlist so the app boots into the channel list. */
export async function seedPlaylist(page: Page, url = PLAYLIST_URL): Promise<void> {
  await page.addInitScript((u) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([{ name: 'Test', url: u }]));
  }, url);
}

/** Enter a section the Magic Remote way: the pointer at the screen's left
 *  edge reveals the side menu, and a click on the section opens it. */
export async function enterTab(
  page: Page,
  section: 'home' | 'live' | 'epg' | 'movies' | 'series' | 'settings' | 'search',
): Promise<void> {
  await openSideMenu(page);
  const item = page.locator(`.nav-menu.open .nav-menu-item[data-section="${section}"]`);
  await expect(item).toBeVisible();
  // The panel slides in; click where it settles.
  await expect.poll(() => item.evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
  const box = await item.boundingBox();
  if (!box) throw new Error(`menu item ${section} has no bounding box`);
  // The pointer rests on the panel's empty top edge, as it rested on the old
  // tab bar, so it lights nothing in the section the menu closes over; the
  // click carries the item's coordinates for the menu's hit-test.
  await page.mouse.move(box.x + box.width / 2, 2);
  await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
  });
  // The panel slides back out before the section is looked at.
  await expect(page.locator('.nav-menu')).not.toHaveClass(/\bopen\b/);
  await expect.poll(async () => {
    const panel = await page.locator('.nav-menu-panel').boundingBox();
    return !panel || panel.x + panel.width <= 0;
  }).toBe(true);
}

/** End a PIN session from the side menu's Lock now, then close it with a scrim click. */
export async function lockNow(page: Page): Promise<void> {
  await openSideMenu(page);
  const lock = page.locator('.nav-menu.open [data-lock-now]');
  await expect(lock).toHaveText('Lock now');
  await lock.click();
  await expect(page.locator('[data-lock-now]')).toHaveCount(0);
  // A click on the scrim closes it; the pointer moving away does not.
  await page.mouse.click(1200, 540);
  await expect(page.locator('.nav-menu')).not.toHaveClass(/\bopen\b/);
}

/** Reveal the side menu with the pointer at the screen's left edge. */
export async function openSideMenu(page: Page): Promise<void> {
  const menu = page.locator('.nav-menu');
  if (await menu.evaluate((el) => el.classList.contains('open'))) return;
  // Along the top edge, so the pointer hovers no content on its way.
  await page.mouse.move(40, 2);
  await page.mouse.move(0, 2);
  await expect(menu).toHaveClass(/\bopen\b/);
}

// Both channel rows have a fixed height because their lists are virtualized, so
// their two text lines overflow into the neighbouring row instead of growing it.
// Returns the row's inner height and the height its text actually needs, adding
// the secondary line first when the fixture has no EPG data for it.
export async function measureRowTextFit(
  page: Page,
  rowSelector: string,
  infoClass: string,
  secondLineClass: string,
): Promise<{ available: number; needed: number }> {
  const row = page.locator(rowSelector).first();
  await expect(row).toBeVisible();
  return row.evaluate(
    (el: HTMLElement, [info, second]) => {
      const box = el.querySelector<HTMLElement>(`.${info}`);
      if (!box) throw new Error(`row has no .${info}`);
      if (!box.querySelector(`.${second}`)) {
        const line = document.createElement('div');
        line.className = second;
        line.textContent = 'Programme';
        box.appendChild(line);
      }
      const style = getComputedStyle(el);
      const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      return {
        available: el.getBoundingClientRect().height - chrome,
        needed: box.scrollHeight,
      };
    },
    [infoClass, secondLineClass],
  );
}

// Computed once per worker: walking the compat data per test is wasteful.
const POST_TARGET_APIS = postTargetApis();

// Every spec imports `test` from here; it auto-stubs the service probe
// before each test so no file has to repeat it.
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    // The simulation project strips every API Chromium 53 lacks before the app
    // loads, so unguarded use fails here instead of on a TV.
    if (testInfo.project.name === 'chromium-53-simulation') {
      await page.addInitScript(removeApis, POST_TARGET_APIS);
    }
    await stubUploadService(page);
    // Pleione hides the Guide tab; the suite keeps the upstream Guide flows by
    // showing it. hideGuideTab() opts a test back into Pleione's default.
    await page.addInitScript(() => localStorage.setItem('iptv_show_guide_tab', 'true'));
    // Upstream flows start on Live; showHome() opts a test into Pleione's Home.
    await page.addInitScript(() => localStorage.setItem('iptv_start_on_live', 'true'));
    await stubProviderApi(page);
    const ringFailures = await auditRings(page, process.env.RING_AUDIT,
      `${testInfo.project.name} › ${testInfo.titlePath.slice(1).join(' › ')}`);
    await use(page);
    if (!page.isClosed()) {
      await page.waitForFunction(() => !(window as { __ringPending?: number }).__ringPending,
        null, { timeout: 3000 }).catch(() => undefined);
    }
    // FocusRing lets only the surface that owns the keys show a ring.
    expect(ringFailures, 'a key left the focus ring on the wrong surface').toEqual([]);
  },
});

// Every key the page sees (pressed, typed, or dispatched) and every wheel
// step is checked once it has rendered: more than one visible focus ring, or
// an open prompt without the ring, fails the test. RING_AUDIT=<file> also
// records screens with no ring while the remote drives focus (some are by
// design, so those only report).
async function auditRings(page: Page, file: string | undefined, title: string): Promise<string[]> {
  const failures: string[] = [];
  await page.exposeFunction('__ringAudit', (entry: string) => {
    const report = JSON.parse(entry) as { kind: string; input: string; rings: string[] };
    if (report.kind !== 'none') failures.push(`${report.kind} after ${report.input}: ${report.rings.join(' + ')}`);
    if (file) appendFileSync(file, `${JSON.stringify({ title, ...report })}\n`);
  });
  await page.addInitScript(installRingAudit, !!file);
  return failures;
}

function installRingAudit(recordNone: boolean): void {
  const w = window as unknown as { __ringAudit?: (entry: string) => void; __ringPending?: number };
  w.__ringPending = 0;
  const PROMPTS = '.confirmation-prompt, .catchup-resume-prompt, .reminder-prompt, '
    + '.parental-pin-prompt, .live-category-picker';
  const visible = (el: Element): boolean => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    if (box.bottom < 0 || box.right < 0 || box.top > innerHeight || box.left > innerWidth) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  };
  const describe = (el: Element): string => {
    const view = el.closest('[id^="view-"], #tab-bar, .tab-bar, [id]');
    const key = el.getAttribute('data-key') ?? el.getAttribute('data-action') ?? '';
    return `${view ? `#${view.id || view.className}` : '?'} ${el.tagName.toLowerCase()}.${
      Array.from(el.classList).join('.')}${key ? `[${key}]` : ''}`;
  };
  const inspect = (input: string) => {
    // A focus target that hands its ring to a child (the account slot and
    // its avatar) shows one ring.
    const keyboard = document.documentElement.classList.contains('keyboard-nav');
    const owner = document.querySelector('[data-ring-owner]');
    // FocusRing's own exception: with the pointer in charge, what it hovers
    // stays lit beside the owner's ring unless the owner is modal.
    const hoverLit = (el: Element) => !keyboard && !!owner && !owner.contains(el)
      && owner.getAttribute('data-ring-owner') !== 'modal' && !!el.closest('[data-ring-hover]');
    const lit = Array.from(document.querySelectorAll('.focused')).filter(visible)
      .filter((el) => !hoverLit(el));
    const rings = lit.filter((el) => !lit.some((other) => other !== el && el.contains(other)));
    const active = document.activeElement;
    // A text box with the caret is its own ring.
    if (active instanceof HTMLInputElement && visible(active)
        && !rings.some((el) => el.contains(active))) rings.push(active);
    const prompts = Array.from(document.querySelectorAll(PROMPTS))
      .filter((el) => !el.classList.contains('hidden') && visible(el));
    const shown = ['view-channels', 'view-player', 'player-sidebar', 'player-menu', 'subtitle-search',
      'subtitle-offset', 'view-epg', 'view-settings', 'view-parental-controls', 'view-reminders',
      'view-movies', 'view-series', 'view-search'].filter((id) => {
      const el = document.getElementById(id);
      return !!el && visible(el);
    });
    // The bare full-screen player has nothing to focus.
    const barePlayer = shown.length === 1 && shown[0] === 'view-player';
    // A parked ring on screen with none lit means the owner never took it back,
    // unless the owner was entered by the pointer and waits for a key.
    const parked = rings.length === 0
      && Array.from(document.querySelectorAll('.focused-parked'))
        .some((el) => visible(el) && !el.closest('[data-ring-owner="deferred"]'));
    const kind = rings.length > 1 ? 'multiple'
      // Stacked prompts: the ring belongs in whichever one is on top.
      : prompts.length && !rings.some((el) => prompts.some((p) => p.contains(el))) ? 'prompt'
        : parked ? 'parked'
          : rings.length === 0 && keyboard && !barePlayer ? 'none' : null;
    return {
      kind, input, shown,
      rings: rings.map(describe),
      active: active && active !== document.body ? describe(active) : '',
    };
  };
  const check = (input: string) => {
    w.__ringPending! += 1;
    const done = () => { w.__ringPending! -= 1; };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const first = inspect(input).kind;
      if (!first || (first === 'none' && !recordNone)) { done(); return; }
      // Panels slide in and out; only a screen that stays wrong counts.
      setTimeout(() => {
        const report = inspect(input);
        if (report.kind && (report.kind !== 'none' || recordNone)) w.__ringAudit?.(JSON.stringify(report));
        done();
      }, 500);
    }));
  };
  window.addEventListener('keydown', (e) => check(`key ${e.key || String(e.keyCode)}`), true);
  window.addEventListener('wheel', (e) => check(`wheel ${String(e.deltaY)}`), true);
  window.addEventListener('click', () => check('click'), true);
  // Prompts a timer or launch opens get checked without waiting for a key.
  let promptSet = '';
  new MutationObserver(() => {
    const set = Array.from(document.querySelectorAll(PROMPTS))
      .map((el, i) => (el.classList.contains('hidden') ? '' : `${i}:${el.className}`))
      .filter(Boolean).join('|');
    if (set !== promptSet) {
      promptSet = set;
      check(set ? 'prompt shown' : 'prompt hidden');
    }
  }).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
  });
}

// The simulation project runs with Chromium 53's API surface. Assertions that
// merely *introspect* through a newer API (rather than exercise app behavior)
// cannot run there; the behavior they observe is covered by the `chromium`
// project.
/** Pleione's default: launch on Home. Call before `page.goto`. */
export async function showHome(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.removeItem('iptv_start_on_live'));
}

/** Pleione's default: no Guide tab. Call before `page.goto`. */
export async function hideGuideTab(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.removeItem('iptv_show_guide_tab'));
}

export const isChromium53 = (): boolean => test.info().project.name === 'chromium-53-simulation';
