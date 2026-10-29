import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createXtreamClient } from '../../src/services/xtream-client.ts';
import { parseM3U } from '../../src/parsers/m3u-parser.ts';
import { parseXMLTVWithStats } from '../../src/parsers/xmltv-parser.ts';
import { parseSubtitleFile } from '../../src/utils/srt.ts';
import {
  formatXtreamCatchupStart, xtreamCatchupSources, xtreamEpgUrl, xtreamLiveUrl, xtreamPlaylistUrl,
} from '../../src/utils/xtream-url.ts';
import { createCatalog, NO_EPG_CHANNEL, SEASONLESS_SERIES_INDEX } from './catalog.mjs';
import { SEGMENTS_PER_LOOP } from './hls.mjs';
import { toSrt, toWebvtt, subtitleCues } from './media.mjs';
import { createDemoServer, parseRange, parseTimeshiftStart } from './server.mjs';

const NOW_MS = Date.UTC(2026, 2, 10, 12, 30, 2);
const NOW = Math.floor(NOW_MS / 1000);

function tsPacket() {
  const buf = Buffer.alloc(188, 0xff);
  buf.set([0x47, 0x41, 0x00, 0x10, 0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, 0x21, 0, 1, 0, 1]);
  return buf;
}

let dir;
let demo;
let base;
const catalog = createCatalog('small');
const creds = () => ({ baseUrl: base, username: 'u1', password: 'p1' });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xtream-demo-test-'));
  const mp4 = Buffer.alloc(1000);
  for (let i = 0; i < mp4.length; i++) mp4[i] = i % 256;
  await writeFile(join(dir, 'clip.mp4'), mp4);
  await writeFile(join(dir, 'sidecar.srt'), toSrt(subtitleCues(30, 'Line')));
  await writeFile(join(dir, 'sidecar.vtt'), toWebvtt(subtitleCues(30, 'Line')));
  const fours = Array(SEGMENTS_PER_LOOP).fill(4);
  const media = {
    ensureShared: async () => {},
    sharedMeta: async () => ({ audio: { l1: fours, l2: fours } }),
    ensureChannel: async () => ({ video: fours, muxed: fours, firstVideoPts: 126000 }),
    channelSegment: async () => tsPacket(),
    audioSegment: async () => tsPacket(),
    vodFile: async (_clip, name = 'clip.mp4') => join(dir, name),
  };
  demo = createDemoServer({ catalog, media, username: 'u1', password: 'p1', now: () => NOW_MS });
  base = `http://127.0.0.1:${await demo.listen(0, '127.0.0.1')}`;
});

afterAll(async () => {
  await demo.close();
  await rm(dir, { recursive: true, force: true });
});

describe('player_api.php through the app client', () => {
  it('reports an active account and the server clock', async () => {
    const client = createXtreamClient(creds());
    expect(await client.getAccountInfo()).toMatchObject({
      auth: true, status: 'Active', allowedOutputFormats: ['m3u8', 'ts'],
    });
    expect(await client.getServerClock()).toEqual({ timeZone: 'UTC', offsetMinutes: 0 });
  });

  it('rejects wrong credentials', async () => {
    const client = createXtreamClient({ ...creds(), password: 'nope' });
    expect(await client.getAccountInfo()).toMatchObject({ auth: false });
  });

  it('lists live categories and streams with catch-up flags', async () => {
    const client = createXtreamClient(creds());
    const categories = await client.getLiveCategories();
    expect(categories).toHaveLength(catalog.liveCategories.length);
    const result = await client.getLiveStreamsResult();
    expect(result.available).toBe(true);
    expect(result.streams).toHaveLength(150);
    expect(result.streams[0]).toMatchObject({
      streamId: '1', name: 'Alpha', epgChannelId: 'ch1', categoryId: '1', archive: true, archiveDurationDays: 3,
    });
    expect(result.streams[0].icon).toBe(`${base}/demo-assets/logo/1.svg`);
    expect(result.streams[NO_EPG_CHANNEL - 1].epgChannelId).toBe('');
  });

  it('serves movies with sort metadata and sidecar subtitles', async () => {
    const client = createXtreamClient(creds(), 'x1');
    expect(await client.getVodCategories()).toHaveLength(catalog.vodCategories.length);
    const all = await client.getVodStreams();
    expect(all).toHaveLength(240);
    expect(all[0]).toMatchObject({ name: 'Movie A', containerExtension: 'mp4', accountId: 'x1' });
    expect(all.every(movie => movie.addedAt > 0 && movie.year > 1900)).toBe(true);
    expect(await client.getVodStreams('2')).toHaveLength(40);
    expect(await client.getVodStreams(String(catalog.vodCategories.length))).toEqual([]);
    const info = await client.getVodInfo(all[0].streamId);
    expect(info.durationSecs).toBeGreaterThan(0);
    expect(info.subtitles.map(subtitle => [subtitle.name, subtitle.lang])).toEqual([
      ['Sidecar SRT', 'l1'], ['Sidecar WebVTT', 'l2'],
    ]);
    const srt = await (await fetch(info.subtitles[0].url)).text();
    expect(parseSubtitleFile(srt)[0].text).toBe('Line 1');
    const vtt = await (await fetch(info.subtitles[1].url)).text();
    expect(parseSubtitleFile(vtt)).toHaveLength(parseSubtitleFile(srt).length);
  });

  it('serves series with seasons, episodes and the seasonless quirk', async () => {
    const client = createXtreamClient(creds(), 'x1');
    expect(await client.getSeriesCategories()).toHaveLength(catalog.seriesCategories.length);
    const list = await client.getSeries();
    expect(list).toHaveLength(120);
    expect(list.every(item => item.addedAt > 0)).toBe(true);
    const info = await client.getSeriesInfo(list[0].seriesId);
    expect(info.seasons).toEqual(catalog.series[0].seasons.map(season => season.number));
    const first = info.episodesBySeason[1][0];
    expect(first).toMatchObject({ season: 1, episode: 1, containerExtension: 'mp4' });
    expect(first.subtitles).toHaveLength(2);
    const quirk = await client.getSeriesInfo(list[SEASONLESS_SERIES_INDEX].seriesId);
    expect(quirk.seasons[0]).toBe(1);
    expect(quirk.episodesBySeason[1][0].season).toBe(1);
  });

  it('returns archive listings that match the XMLTV guide', async () => {
    const listings = await createXtreamClient(creds()).getArchiveListings('1');
    expect(listings.length).toBeGreaterThan(50);
    const archived = listings.filter(listing => listing.hasArchive);
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.every(listing => listing.stop <= NOW)).toBe(true);

    const xml = await (await fetch(xtreamEpgUrl(creds()))).text();
    const { data } = parseXMLTVWithStats(xml, { nowMs: NOW_MS });
    const guide = data.programmes.ch1.map(programme => programme.start.getTime() / 1000);
    expect(guide).toEqual(listings.map(listing => listing.start));
    expect(data.programmes[`ch${NO_EPG_CHANNEL}`]).toBeUndefined();
  });

  it('answers get_short_epg with base64 titles', async () => {
    const res = await fetch(`${base}/player_api.php?username=u1&password=p1&action=get_short_epg&stream_id=2&limit=3`);
    const { epg_listings: listings } = await res.json();
    expect(listings).toHaveLength(3);
    expect(Buffer.from(listings[0].title, 'base64').toString()).toMatch(/^Program \d+$/);
    expect(Number(listings[0].stop_timestamp)).toBeGreaterThan(NOW);
  });
});

describe('get.php', () => {
  it('lists live channels first, then movies and episodes', async () => {
    const text = await (await fetch(xtreamPlaylistUrl(creds(), 'm3u8'))).text();
    const parsed = parseM3U(text);
    expect(parsed.channels[0]).toMatchObject({ name: 'Alpha', id: 'ch1', group: 'Group 1' });
    expect(parsed.channels[0].url).toBe(xtreamLiveUrl(creds(), '1', 'm3u8'));
    expect(parsed.channels.some(channel => channel.url.includes('/movie/u1/p1/10001.mp4'))).toBe(true);
    expect(parsed.channels.some(channel => channel.url.includes('/series/u1/p1/'))).toBe(true);
  });

  it('requires credentials', async () => {
    expect((await fetch(`${base}/get.php?username=u1&password=x`)).status).toBe(401);
  });
});

describe('streams', () => {
  it('serves a live HLS master with two audio tracks and a subtitle track', async () => {
    const res = await fetch(xtreamLiveUrl(creds(), '1', 'm3u8'));
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const master = await res.text();
    expect(master.match(/TYPE=AUDIO/g)).toHaveLength(2);
    expect(master).toContain('TYPE=SUBTITLES');
    const media = await (await fetch(`${base}/demo-hls/live/1/video.m3u8`)).text();
    expect(media).toContain('#EXT-X-PROGRAM-DATE-TIME:');
    const segment = media.split('\n').find(line => line.startsWith('/demo-hls/seg/'));
    const body = Buffer.from(await (await fetch(base + segment)).arrayBuffer());
    expect(body[0]).toBe(0x47);
  });

  it('streams live MPEG-TS continuously', async () => {
    const controller = new AbortController();
    const res = await fetch(xtreamLiveUrl(creds(), '2', 'ts'), { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('video/mp2t');
    const { value } = await res.body.getReader().read();
    expect(value[0]).toBe(0x47);
    controller.abort();
  });

  it('serves every timeshift URL form the app builds for a past programme', async () => {
    const start = formatXtreamCatchupStart(NOW - 3600, 'UTC');
    const sources = xtreamCatchupSources(creds(), '3', 'm3u8');
    for (const source of sources) {
      const url = source.url.replace('{duration}', '30').replace('{start}', start);
      const controller = new AbortController();
      const res = await fetch(url, { signal: controller.signal });
      expect(res.status, source.kind).toBe(200);
      controller.abort();
    }
    expect((await fetch(`${base}/timeshift/u1/p1/30/${start}/2.m3u8`)).status).toBe(404);
  });

  it('serves movie byte ranges for seeking', async () => {
    const res = await fetch(`${base}/movie/u1/p1/10001.mp4`, { headers: { Range: 'bytes=10-19' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const whole = await fetch(`${base}/series/u1/p1/200001.mp4`);
    expect(whole.headers.get('content-length')).toBe('1000');
    expect((await fetch(`${base}/movie/u1/p1/10001.mp4`, { headers: { Range: 'bytes=5000-' } })).status).toBe(416);
  });

  it('answers CORS preflights', async () => {
    const res = await fetch(`${base}/movie/u1/p1/10001.mp4`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Range');
  });

  it('serves generated artwork', async () => {
    const res = await fetch(`${base}/demo-assets/poster/movie/10001.svg`);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(await res.text()).toContain('Movie A');
  });
});

describe('helpers', () => {
  it('parses byte ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toEqual({ invalid: true });
    expect(parseRange('items=1-2', 100)).toEqual({ invalid: true });
  });

  it('parses the Xtream timeshift start', () => {
    expect(parseTimeshiftStart('2024-03-09:12-00')).toBe(Date.UTC(2024, 2, 9, 12) / 1000);
    expect(parseTimeshiftStart('yesterday')).toBeNaN();
  });
});
