// Captures the LG Content Store screenshots and the website's screenshots.
//
//   npm run xtream:demo                 # terminal 1: the synthetic catalog
//   npm run screenshots:store           # terminal 2
//
// It drives the *real* app (built into dist/) in headless Chromium at
// 1920x1080 against the demo Xtream server (scripts/xtream-demo-server.mjs),
// so every channel, program, movie, and poster on screen is synthetic and the
// video is the server's own ffmpeg test pattern. The captures land in
// store/screenshots/, where the website (site/) picks them up.
//
//   XTREAM_DEMO_URL   the demo server (default http://127.0.0.1:8090)
//   XTREAM_DEMO_USERNAME / XTREAM_DEMO_PASSWORD   (default demo / demo)
//
// Nothing here ships in the app or the .ipk; it is a dev-only tool.

import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'store/screenshots');
const XTREAM = (process.env.XTREAM_DEMO_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const USERNAME = process.env.XTREAM_DEMO_USERNAME || 'demo';
const PASSWORD = process.env.XTREAM_DEMO_PASSWORD || 'demo';

const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml',
};

function startServer() {
  const dist = join(ROOT, 'dist');
  const server = createServer(async (req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const data = await readFile(join(dist, url));
      res.writeHead(200, { 'Content-Type': MIME[extname(url)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function checkDemoServer() {
  const url = `${XTREAM}/player_api.php?username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    if (body?.user_info?.auth === 1) return;
  } catch {
    // Reported below.
  }
  console.error(`No demo Xtream server answered at ${XTREAM}. Start one with \`npm run xtream:demo\`.`);
  process.exit(1);
}

async function remote(page, keyCode, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.evaluate((kc) => document.dispatchEvent(
      new KeyboardEvent('keydown', { keyCode: kc, bubbles: true })), keyCode);
    await page.waitForTimeout(120);
  }
}

// Enter a section the Magic Remote way: the Home button, then its card.
async function enterSection(page, section) {
  // The first move only seeds the pointer; the second hands over to it.
  await page.mouse.move(900, 2);
  await page.mouse.move(960, 2);
  const home = page.locator('#view-home');
  if (!(await home.isVisible())) {
    await page.locator('.home-button').click();
    await home.waitFor({ state: 'visible' });
  }
  if (section !== 'home') await home.locator(`[data-key="section:${section}"]`).first().click();
  // Park the pointer, then go back to keys so the focus ring shows.
  await page.mouse.move(1919, 1079);
  await remote(page, 1537);
}

async function shoot(page, name) {
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path: join(OUT, name), animations: 'disabled', caret: 'hide' });
      console.log(`  ${name}`);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(300);
    }
  }
}

// Home opens on the Live tile; OK enters Live with the first channel focused.
async function openLive(page) {
  await remote(page, KEY.ENTER);
  await page.locator('.channel-main .channel-now').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);
}

await checkDemoServer();
console.log('Building app (esbuild)...');
execSync('node esbuild.config.mjs --preview', { cwd: ROOT, stdio: 'inherit' });
await mkdir(OUT, { recursive: true });

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

// The LAN setup service is a webOS JS service the browser cannot run; fake its
// Luna start call and its loopback /info so Settings shows the phone-setup QR.
const LAN_PORT = 8899;
const LAN_INFO = {
  ip: '192.168.1.42',
  port: LAN_PORT,
  setupUrl: `http://192.168.1.42:${LAN_PORT}/setup?token=0123456789ab`,
  manualUrl: `http://192.168.1.42:${LAN_PORT}`,
  pairingCode: '6993',
};

async function fakeLanService(page) {
  await page.addInitScript((port) => {
    window.PalmServiceBridge = class {
      onservicecallback = null;
      call(uri) {
        const method = uri.slice(uri.lastIndexOf('/') + 1);
        const response = method === 'start' ? { running: true, port }
          : method === 'serviceEvents' ? { subscribed: true }
            : method === 'stop' ? { stopped: true }
              : { returnValue: false, errorText: 'unmocked: ' + method };
        setTimeout(() => this.onservicecallback?.(JSON.stringify(response)), 0);
      }
      cancel() { this.onservicecallback = null; }
    };
  }, LAN_PORT);
  const json = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await page.route(`http://127.0.0.1:${LAN_PORT}/info`, json(LAN_INFO));
  await page.route(`http://127.0.0.1:${LAN_PORT}/setup-state`, json({ updated: true }));
  await page.route(`http://127.0.0.1:${LAN_PORT}/uploads`, json([]));
}

async function newPage(extra = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await fakeLanService(page);
  await page.addInitScript(({ account, extra }) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([account]));
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, JSON.stringify(value));
  }, {
    account: { id: 'demo', name: 'Demo', url: XTREAM, source: 'xtream', xtream: { username: USERNAME, password: PASSWORD } },
    extra,
  });
  await page.goto(base + '/');
  await page.locator('#view-home').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

try {
  // Home: the five section tiles.
  {
    const { context, page } = await newPage();
    await shoot(page, 'home.png');
    await context.close();
  }

  // Live: a group of channels, the first one playing in the live preview.
  {
    const { context, page } = await newPage();
    await openLive(page);
    await remote(page, KEY.LEFT);
    await remote(page, KEY.DOWN, 4); // All, Favorites, Recently Watched, Group 1 -> Group 2
    await remote(page, KEY.ENTER);
    await page.waitForTimeout(1500);
    await shoot(page, 'live.png');
    await context.close();
  }

  // Guide: Red from Live.
  {
    const { context, page } = await newPage();
    await openLive(page);
    await remote(page, KEY.RED);
    await page.locator('#live-guide .guide-cell.live').first().waitFor({ state: 'visible', timeout: 20_000 });
    await shoot(page, 'guide.png');
    await context.close();
  }

  // Player: a live channel with the controls up.
  {
    const { context, page } = await newPage();
    await openLive(page);
    await remote(page, KEY.ENTER);
    await page.locator('#player-osd .osd-programme-title').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(4000);
    await remote(page, KEY.ENTER);
    await shoot(page, 'player.png');
    await context.close();
  }

  // Movies: the catalog.
  {
    const { context, page } = await newPage();
    await enterSection(page, 'movies');
    await page.locator('#view-movies [data-focusable]').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shoot(page, 'movies.png');
    // Movie detail.
    await remote(page, KEY.RIGHT, 2);
    await remote(page, KEY.ENTER);
    await page.waitForTimeout(2000);
    await shoot(page, 'movie-detail.png');
    await context.close();
  }

  // Series detail: seasons and episodes.
  {
    const { context, page } = await newPage();
    await enterSection(page, 'series');
    await page.locator('#view-series [data-focusable]').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shoot(page, 'series.png');
    await remote(page, KEY.RIGHT);
    await remote(page, KEY.ENTER);
    await page.waitForTimeout(2500);
    await shoot(page, 'series-detail.png');
    await context.close();
  }

  // Search: one query across channels, programs, movies, and series.
  {
    const { context, page } = await newPage();
    await enterSection(page, 'search');
    await page.waitForTimeout(1500);
    await page.keyboard.type('Bravo', { delay: 60 });
    await page.waitForTimeout(2500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await shoot(page, 'search.png');
    await context.close();
  }

  // Settings.
  {
    const { context, page } = await newPage();
    await enterSection(page, 'settings');
    await page.waitForTimeout(2500);
    await shoot(page, 'settings.png');
    await remote(page, KEY.DOWN, 4); // Home button, General, Sources, Program Guide -> Appearance
    await page.waitForTimeout(1500);
    await shoot(page, 'appearance.png');
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`Screenshots written to ${OUT}`);
