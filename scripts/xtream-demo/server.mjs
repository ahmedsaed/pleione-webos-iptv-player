// HTTP front of the demo Xtream server: the Xtream URL surface the app uses
// (player_api.php, get.php, xmltv.php, /live, /movie, /series, /timeshift)
// plus the internal HLS, segment and artwork routes those responses point at.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { m3uPlaylist, playerApi, xmltvChunks } from './api.mjs';
import { logoSvg, posterSvg, stillSvg } from './assets.mjs';
import {
  archiveWindow, liveWindow, loopIndex, loopSegment, masterPlaylist, mediaPlaylist,
  ptsOffset, SEGMENT_SECONDS, webvttSegment,
} from './hls.mjs';
import { LIVE_AUDIO, LIVE_SUBTITLES, liveVariants } from './media.mjs';
import { shiftSegment } from './mpegts.mjs';

const TYPES = {
  hls: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  mp4: 'video/mp4',
  json: 'application/json',
  xml: 'application/xml',
  m3u: 'audio/x-mpegurl',
  svg: 'image/svg+xml',
  vtt: 'text/vtt',
  srt: 'application/x-subrip',
  text: 'text/plain; charset=utf-8',
};

const LIVE_TS_LEAD_SECONDS = 8;
const ARCHIVE_TS_LEAD_SECONDS = 30;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Parse a single `bytes=` range against a file size; null means "whole file". */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return { invalid: true };
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

/** Xtream catch-up start `YYYY-MM-DD:HH-MM` (server time, UTC here) to Unix seconds. */
export function parseTimeshiftStart(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[:_ T](\d{2})[-:](\d{2})$/.exec(decodeURIComponent(text));
  if (!match) return NaN;
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) / 1000;
}

function extension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { id: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() } : { id: name, ext: '' };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createDemoServer({
  catalog, media, username = 'demo', password = 'demo', now = () => Date.now(), log = () => {},
}) {
  const nowSeconds = () => Math.floor(now() / 1000);
  // The live PTS timeline starts one window before boot, so it never goes negative.
  const liveBaseLoop = loopIndex(liveWindow(nowSeconds()).first) - 1;

  const authorized = (user, pass) => user === username && pass === password;

  function context(req) {
    const host = req.headers.host || '127.0.0.1';
    return { origin: `http://${host}`, username, password, nowSeconds: nowSeconds() };
  }

  function send(res, status, type, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': type, ...extra });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }

  const sendJson = (res, body) => send(res, 200, TYPES.json, JSON.stringify(body));

  function channelOrThrow(id) {
    const channel = catalog.channel(id);
    if (!channel) throw new HttpError(404, 'Unknown stream');
    return channel;
  }

  // --- HLS ---------------------------------------------------------------

  function hlsMaster(channel, prefix) {
    return masterPlaylist({
      variants: liveVariants(channel).map(variant => ({
        uri: `${prefix}/${variant.set}.m3u8`,
        bandwidth: variant.bandwidth,
        codecs: variant.codecs,
        resolution: `${variant.width}x${variant.height}`,
        frameRate: variant.fps,
      })),
      audio: LIVE_AUDIO.map((track, i) => ({
        name: track.name, language: track.language, default: i === 0, uri: `${prefix}/audio-${track.id}.m3u8`,
      })),
      subtitles: LIVE_SUBTITLES.map(track => ({
        name: track.name, language: track.language, uri: `${prefix}/subs-${track.id}.m3u8`,
      })),
    });
  }

  const isVideoSet = (channel, set) => liveVariants(channel).some(variant => variant.set === set);

  async function hlsMedia(channel, rendition, window, baseLoop) {
    const meta = await media.ensureChannel(channel);
    const id = channel.streamId;
    let uri;
    let duration;
    if (isVideoSet(channel, rendition)) {
      const durations = meta.variants?.[rendition] ?? meta.video;
      uri = g => `/demo-hls/seg/${id}/${rendition}/${g}/${baseLoop}.ts`;
      duration = g => durations[loopSegment(g)];
    } else if (rendition.startsWith('audio-')) {
      const track = rendition.slice(6);
      const shared = await media.sharedMeta();
      if (!shared.audio[track]) throw new HttpError(404, 'Unknown audio rendition');
      uri = g => `/demo-hls/seg/${id}/audio-${track}/${g}/${baseLoop}.ts`;
      duration = g => shared.audio[track][loopSegment(g)];
    } else if (rendition.startsWith('subs-')) {
      const track = rendition.slice(5);
      if (!LIVE_SUBTITLES.some(item => item.id === track)) throw new HttpError(404, 'Unknown subtitle rendition');
      uri = g => `/demo-hls/vtt/${id}/${track}/${g}/${baseLoop}.vtt`;
      duration = () => SEGMENT_SECONDS;
    } else {
      throw new HttpError(404, 'Unknown rendition');
    }
    return mediaPlaylist({ ...window, uri, duration });
  }

  async function segment(channel, set, g, baseLoop, continuity) {
    const index = loopSegment(g);
    const data = set.startsWith('audio-')
      ? await media.audioSegment(set.slice(6), index)
      : await media.channelSegment(channel, set, index);
    return shiftSegment(data, ptsOffset(g, baseLoop), continuity);
  }

  // A continuous MPEG-TS response, paced against the wall clock.
  async function streamTs(req, res, channel, { first, last, baseLoop, lead }) {
    await media.ensureChannel(channel);
    res.writeHead(200, { 'Content-Type': TYPES.ts, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    let closed = false;
    res.on('close', () => { closed = true; });
    const continuity = new Map();
    const started = now();
    for (let g = first, sent = 0; !closed && g <= last; g++, sent += SEGMENT_SECONDS) {
      for (;;) {
        const ahead = sent - (now() - started) / 1000;
        if (closed || (g <= liveWindow(nowSeconds()).last && ahead <= lead)) break;
        await sleep(250);
      }
      if (closed) break;
      const data = await segment(channel, 'muxed', g, baseLoop, continuity);
      if (!res.write(data)) await new Promise(resolve => res.once('drain', resolve).once('close', resolve));
    }
    if (!closed) res.end();
  }

  async function serveLive(req, res, channel, ext) {
    if (ext === 'm3u8') {
      await media.ensureChannel(channel);
      send(res, 200, TYPES.hls, hlsMaster(channel, `/demo-hls/live/${channel.streamId}`), { 'Cache-Control': 'no-store' });
      return;
    }
    if (ext && ext !== 'ts') throw new HttpError(404, 'Unsupported live output');
    const { last } = liveWindow(nowSeconds());
    await streamTs(req, res, channel, {
      first: last - 1, last: Infinity, baseLoop: liveBaseLoop, lead: LIVE_TS_LEAD_SECONDS,
    });
  }

  async function serveTimeshift(req, res, { streamId, start, minutes, ext }) {
    const channel = channelOrThrow(streamId);
    const startSeconds = parseTimeshiftStart(start);
    const duration = Number(minutes) * 60;
    if (!Number.isFinite(startSeconds) || !(duration > 0)) throw new HttpError(400, 'Bad timeshift request');
    if (!channel.archive) throw new HttpError(404, 'No archive for this stream');
    const window = archiveWindow(startSeconds, duration, nowSeconds());
    if (window.last < window.first) throw new HttpError(404, 'Archive not available yet');
    if (ext === 'm3u8') {
      await media.ensureChannel(channel);
      send(res, 200, TYPES.hls,
        hlsMaster(channel, `/demo-hls/archive/${channel.streamId}/${startSeconds}/${duration}`),
        { 'Cache-Control': 'no-store' });
      return;
    }
    await streamTs(req, res, channel, {
      first: window.first, last: window.last, baseLoop: loopIndex(window.first), lead: ARCHIVE_TS_LEAD_SECONDS,
    });
  }

  async function serveFile(req, res, path, type) {
    const { size } = await stat(path);
    const range = parseRange(req.headers.range, size);
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (range?.invalid) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(path, { start, end }).on('error', () => res.destroy()).pipe(res);
  }

  function vodClip(kind, id) {
    if (kind === 'movie') {
      const movie = catalog.movie(id);
      if (!movie) throw new HttpError(404, 'Unknown movie');
      return movie.clip;
    }
    const found = catalog.episode(id);
    if (!found) throw new HttpError(404, 'Unknown episode');
    return found.episode.id === found.series.subtitledEpisodeId ? 'feature' : 'episode';
  }

  // --- artwork -------------------------------------------------------------

  function asset(res, parts) {
    const [kind, a, b] = parts;
    if (kind === 'logo') {
      const channel = channelOrThrow(extension(a).id);
      return send(res, 200, TYPES.svg, logoSvg(channel.name, channel.hue, channel.logo), { 'Cache-Control': 'max-age=86400' });
    }
    if (kind === 'poster' && a === 'movie') {
      const movie = catalog.movie(extension(b).id);
      if (!movie) throw new HttpError(404, 'Unknown movie');
      return send(res, 200, TYPES.svg, posterSvg(movie.name, String(movie.year), movie.hue));
    }
    if (kind === 'poster' && a === 'series') {
      const item = catalog.seriesItem(extension(b).id);
      if (!item) throw new HttpError(404, 'Unknown series');
      return send(res, 200, TYPES.svg, posterSvg(item.name, `${item.seasons.length} season(s)`, item.hue));
    }
    if (kind === 'still') {
      const found = catalog.episode(extension(a).id);
      if (!found) throw new HttpError(404, 'Unknown episode');
      const { series, episode } = found;
      return send(res, 200, TYPES.svg,
        stillSvg(`${series.name} S${episode.season}E${episode.episode}`, (series.hue + episode.episode * 25) % 360));
    }
    return null;
  }

  // --- routing -------------------------------------------------------------

  async function route(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const q = url.searchParams;
    const [head] = parts;

    if (url.pathname === '/') {
      return send(res, 200, TYPES.text,
        `Demo Xtream server\nUsername: ${username}\nPassword: ${password}\n`
        + `Catalog: ${catalog.channels.length} channels, ${catalog.movies.length} movies, `
        + `${catalog.series.length} series\n`);
    }

    if (head === 'player_api.php') {
      if (!authorized(q.get('username'), q.get('password'))) return sendJson(res, { user_info: { auth: 0 } });
      const body = playerApi(catalog, context(req), q);
      return sendJson(res, body ?? []);
    }

    if (head === 'get.php') {
      if (!authorized(q.get('username'), q.get('password'))) throw new HttpError(401, 'Invalid credentials');
      return send(res, 200, TYPES.m3u, m3uPlaylist(catalog, context(req), {
        type: q.get('type') || 'm3u_plus', output: q.get('output') || 'ts',
      }), { 'Content-Disposition': 'attachment; filename="playlist.m3u"' });
    }

    if (head === 'xmltv.php') {
      if (!authorized(q.get('username'), q.get('password'))) throw new HttpError(401, 'Invalid credentials');
      res.writeHead(200, { 'Content-Type': TYPES.xml });
      if (req.method === 'HEAD') return res.end();
      for (const chunk of xmltvChunks(catalog, context(req))) {
        if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
      }
      return res.end();
    }

    if (head === 'streaming' && parts[1] === 'timeshift.php') {
      if (!authorized(q.get('username'), q.get('password'))) throw new HttpError(401, 'Invalid credentials');
      return serveTimeshift(req, res, {
        streamId: q.get('stream'), start: q.get('start') || '', minutes: q.get('duration'),
        ext: (q.get('extension') || '').toLowerCase(),
      });
    }

    if (head === 'timeshift' && parts.length === 6) {
      if (!authorized(parts[1], parts[2])) throw new HttpError(401, 'Invalid credentials');
      const { id, ext } = extension(parts[5]);
      return serveTimeshift(req, res, { streamId: id, start: parts[4], minutes: parts[3], ext });
    }

    if ((head === 'live' || head === 'movie' || head === 'series') && parts.length === 4) {
      if (!authorized(parts[1], parts[2])) throw new HttpError(401, 'Invalid credentials');
      const { id, ext } = extension(parts[3]);
      if (head === 'live') return serveLive(req, res, channelOrThrow(id), ext);
      const clip = vodClip(head, id);
      return serveFile(req, res, await media.vodFile(clip), TYPES.mp4);
    }

    // The short Xtream live form: /<user>/<pass>/<id>
    if (parts.length === 3 && authorized(parts[0], parts[1])) {
      const { id, ext } = extension(parts[2]);
      return serveLive(req, res, channelOrThrow(id), ext);
    }

    if (head === 'demo-hls') {
      const [, kind] = parts;
      if (kind === 'live' && parts.length === 4) {
        const channel = channelOrThrow(parts[2]);
        const window = { ...liveWindow(nowSeconds()), kind: 'live' };
        return send(res, 200, TYPES.hls,
          await hlsMedia(channel, extension(parts[3]).id, window, liveBaseLoop), { 'Cache-Control': 'no-store' });
      }
      if (kind === 'archive' && parts.length === 6) {
        const channel = channelOrThrow(parts[2]);
        const archive = archiveWindow(Number(parts[3]), Number(parts[4]), nowSeconds());
        const window = { first: archive.first, last: archive.last, kind: archive.complete ? 'vod' : 'event' };
        return send(res, 200, TYPES.hls,
          await hlsMedia(channel, extension(parts[5]).id, window, loopIndex(archive.first)),
          { 'Cache-Control': 'no-store' });
      }
      if (kind === 'seg' && parts.length === 6) {
        const channel = channelOrThrow(parts[2]);
        const set = parts[3];
        if (!isVideoSet(channel, set) && !LIVE_AUDIO.some(track => set === `audio-${track.id}`)) {
          throw new HttpError(404, 'Unknown segment set');
        }
        const data = await segment(channel, set, Number(parts[4]), Number(extension(parts[5]).id));
        return send(res, 200, TYPES.ts, data, { 'Cache-Control': 'max-age=60' });
      }
      if (kind === 'vtt' && parts.length === 6) {
        const channel = channelOrThrow(parts[2]);
        const track = LIVE_SUBTITLES.find(item => item.id === parts[3]);
        if (!track) throw new HttpError(404, 'Unknown subtitle track');
        const meta = await media.ensureChannel(channel);
        return send(res, 200, TYPES.vtt, webvttSegment({
          g: Number(parts[4]), baseLoop: Number(extension(parts[5]).id),
          firstVideoPts: meta.firstVideoPts, label: `${track.name} (${track.language}) ${channel.name}`,
        }), { 'Cache-Control': 'max-age=60' });
      }
    }

    if (head === 'demo-assets') {
      if (parts[1] === 'subtitles' && (parts[2] === 'feature.srt' || parts[2] === 'feature.vtt')) {
        const ext = extension(parts[2]).ext;
        return send(res, 200, TYPES[ext], await readFile(await media.vodFile('feature', `sidecar.${ext}`)));
      }
      if (asset(res, parts.slice(1)) !== null) return undefined;
    }

    throw new HttpError(404, 'Not found');
  }

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, TYPES.text, 'Method not allowed\n');
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    route(req, res, url).then(() => {
      log('debug', `${req.method} ${url.pathname} ${res.statusCode}`);
    }, (error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) log('error', `${req.method} ${url.pathname}: ${error.message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      send(res, status, TYPES.text, `${error.message}\n`);
    });
  });

  return {
    server,
    listen(port = 0, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      server.closeAllConnections?.();
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}
