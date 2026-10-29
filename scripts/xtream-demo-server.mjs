#!/usr/bin/env node
// Local demo Xtream Codes server for manual testing in the desktop preview or
// on a TV on the LAN: a synthetic catalog with real, locally generated media.
// Dev-only; nothing here ships in the app. See docs/xtream-demo-server.md.

import { cpus, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatOptions, parseArgs } from './cli-args.mjs';
import { createCatalog } from './xtream-demo/catalog.mjs';
import { createMediaStore, ffmpegAvailable } from './xtream-demo/media.mjs';
import { createDemoServer } from './xtream-demo/server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

export const DEMO_SPEC = {
  options: {
    help: { type: 'boolean', short: 'h', description: 'Show this help' },
    port: {
      type: 'integer', min: 0, max: 65535, default: Number(env.XTREAM_DEMO_PORT) || 8090,
      description: 'Port to listen on; 0 picks a free one (env XTREAM_DEMO_PORT)',
    },
    host: {
      type: 'string', default: env.XTREAM_DEMO_HOST || '0.0.0.0', valueName: '<address>',
      description: 'Address to bind; the default is reachable from the LAN (env XTREAM_DEMO_HOST)',
    },
    size: {
      type: 'string', choices: ['small', 'large'], default: env.XTREAM_DEMO_SIZE || 'small',
      description: 'Catalog size; large is for performance testing (env XTREAM_DEMO_SIZE)',
    },
    username: {
      type: 'string', default: env.XTREAM_DEMO_USERNAME || 'demo', valueName: '<name>',
      description: 'Account username (env XTREAM_DEMO_USERNAME)',
    },
    password: {
      type: 'string', default: env.XTREAM_DEMO_PASSWORD || 'demo', valueName: '<secret>',
      description: 'Account password (env XTREAM_DEMO_PASSWORD)',
    },
    prepare: {
      type: 'boolean',
      description: 'Generate all media, including every live channel loop, then exit',
    },
    jobs: {
      type: 'integer', positive: true, max: 64, default: Math.max(1, Math.floor(cpus().length / 2)),
      description: 'Parallel ffmpeg encodes for --prepare',
    },
    'cache-dir': {
      type: 'string', default: env.XTREAM_DEMO_CACHE || join(ROOT, '.cache', 'xtream-demo'),
      valueName: '<path>', description: 'Where generated media is cached (env XTREAM_DEMO_CACHE)',
    },
    verbose: { type: 'boolean', short: 'v', description: 'Log every request' },
  },
};

const HELP = `Usage: npm run xtream:demo -- [options]

Starts a demo Xtream Codes server with a synthetic catalog and real media
generated locally by ffmpeg (cached after the first run).

${formatOptions(DEMO_SPEC)}
`;

/** Start a demo server; resolves once media is ready and the port is bound. */
export async function startDemoServer({
  port = 0, host = '127.0.0.1', size = 'small', username = 'demo', password = 'demo',
  cacheDir = join(ROOT, '.cache', 'xtream-demo'), log = () => {}, now,
} = {}) {
  const catalog = createCatalog(size);
  const media = createMediaStore({ cacheDir, log: message => log('info', message) });
  await media.ensureShared();
  const demo = createDemoServer({ catalog, media, username, password, log, ...(now ? { now } : {}) });
  const boundPort = await demo.listen(port, host);
  return { catalog, media, port: boundPort, close: () => demo.close() };
}

function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

async function main(argv) {
  const { values } = parseArgs(argv, DEMO_SPEC);
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!(await ffmpegAvailable())) {
    throw new Error('ffmpeg was not found on PATH. Install ffmpeg (with libx264 and aac) and retry.');
  }
  const print = (...parts) => console.log('[xtream-demo]', ...parts);
  const log = (level, message) => {
    if (level === 'error') console.error('[xtream-demo]', message);
    else if (level === 'info' || values.verbose) print(message);
  };

  if (values.prepare) {
    const catalog = createCatalog(values.size);
    const media = createMediaStore({ cacheDir: values['cache-dir'], log: message => print(message) });
    print(`Preparing media in ${media.root}`);
    await media.ensureShared();
    print(`Encoding ${catalog.channels.length} live channel loops with ${values.jobs} job(s)...`);
    let lastShown = 0;
    await media.prepareChannels(catalog.channels, {
      jobs: values.jobs,
      onProgress(done, total) {
        if (done === total || Date.now() - lastShown > 2000) {
          lastShown = Date.now();
          print(`  ${done}/${total} channels`);
        }
      },
    });
    print('Media ready.');
    return;
  }

  print('Preparing media (the first start encodes clips with ffmpeg; about a minute)...');
  const demo = await startDemoServer({
    port: values.port, host: values.host, size: values.size,
    username: values.username, password: values.password, cacheDir: values['cache-dir'], log,
  });
  const hosts = values.host === '0.0.0.0' ? ['127.0.0.1', ...lanAddresses()] : [values.host];
  const { catalog } = demo;
  print(`Catalog (${values.size}): ${catalog.channels.length} channels, `
    + `${catalog.movies.length} movies, ${catalog.series.length} series`);
  for (const address of hosts) print(`Server URL: http://${address}:${demo.port}`);
  print(`Username: ${values.username}`);
  print(`Password: ${values.password}`);
  print('Add this in Settings → Xtream Accounts. Live channels encode on first play (a few seconds each).');

  const stop = () => {
    print('Stopping.');
    demo.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[xtream-demo] ${error.message}`);
    process.exit(1);
  });
}
