// Wall-clock timeline and playlist text for the demo server's live, DVR and
// catch-up HLS. Global segment `g` covers wall-clock seconds
// [g * SEGMENT_SECONDS, (g + 1) * SEGMENT_SECONDS) and replays loop segment
// `g % SEGMENTS_PER_LOOP`, so the burned-in seconds counter matches the clock.

import { PTS_HZ, wrapPts } from './mpegts.mjs';

export const SEGMENT_SECONDS = 4;
export const LOOP_SECONDS = 60;
export const SEGMENTS_PER_LOOP = LOOP_SECONDS / SEGMENT_SECONDS;
export const LIVE_WINDOW_SEGMENTS = 75; // a five-minute DVR window

export function loopIndex(g) {
  return Math.floor(g / SEGMENTS_PER_LOOP);
}

export function loopSegment(g) {
  return ((g % SEGMENTS_PER_LOOP) + SEGMENTS_PER_LOOP) % SEGMENTS_PER_LOOP;
}

/** PTS shift for segment `g` on a timeline whose zero is loop `baseLoop`. */
export function ptsOffset(g, baseLoop) {
  return wrapPts((loopIndex(g) - baseLoop) * LOOP_SECONDS * PTS_HZ);
}

/** Newest fully elapsed segment and the start of the sliding window. */
export function liveWindow(nowSeconds, windowSegments = LIVE_WINDOW_SEGMENTS) {
  const last = Math.floor(nowSeconds / SEGMENT_SECONDS) - 1;
  return { first: last - windowSegments + 1, last };
}

/** Segments covering [startSeconds, startSeconds + durationSeconds), capped at the live edge. */
export function archiveWindow(startSeconds, durationSeconds, nowSeconds) {
  const first = Math.floor(startSeconds / SEGMENT_SECONDS);
  const wanted = Math.ceil((startSeconds + durationSeconds) / SEGMENT_SECONDS) - 1;
  const edge = liveWindow(nowSeconds).last;
  return { first, last: Math.min(wanted, edge), complete: wanted <= edge };
}

function attributes(list) {
  return list.filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`).join(',');
}

const quoted = (value) => `"${value}"`;

/** A master playlist; `variants` ({ uri, bandwidth, codecs, resolution, frameRate }) share the renditions. */
export function masterPlaylist({ variants, audio, subtitles }) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const track of audio) {
    lines.push(`#EXT-X-MEDIA:${attributes([
      ['TYPE', 'AUDIO'], ['GROUP-ID', quoted('aud')], ['NAME', quoted(track.name)],
      ['LANGUAGE', quoted(track.language)], ['DEFAULT', track.default ? 'YES' : 'NO'],
      ['AUTOSELECT', 'YES'], ['CHANNELS', quoted('1')], ['URI', quoted(track.uri)],
    ])}`);
  }
  for (const track of subtitles) {
    lines.push(`#EXT-X-MEDIA:${attributes([
      ['TYPE', 'SUBTITLES'], ['GROUP-ID', quoted('subs')], ['NAME', quoted(track.name)],
      ['LANGUAGE', quoted(track.language)], ['DEFAULT', 'NO'], ['AUTOSELECT', 'NO'],
      ['FORCED', 'NO'], ['URI', quoted(track.uri)],
    ])}`);
  }
  for (const variant of variants) {
    lines.push(`#EXT-X-STREAM-INF:${attributes([
      ['BANDWIDTH', String(variant.bandwidth)], ['CODECS', quoted(variant.codecs)],
      ['RESOLUTION', variant.resolution], ['FRAME-RATE', variant.frameRate.toFixed(3)],
      ['AUDIO', audio.length ? quoted('aud') : undefined],
      ['SUBTITLES', subtitles.length ? quoted('subs') : undefined],
    ])}`);
    lines.push(variant.uri);
  }
  lines.push('');
  return lines.join('\n');
}

const isoTime = (seconds) => new Date(seconds * 1000).toISOString();

/**
 * Media playlist for segments first..last. `kind` is 'live' (sliding window),
 * 'event' (an archive still growing toward the live edge) or 'vod' (closed).
 */
export function mediaPlaylist({ first, last, kind, uri, duration = () => SEGMENT_SECONDS }) {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
  ];
  if (kind === 'vod') lines.push('#EXT-X-PLAYLIST-TYPE:VOD');
  if (kind === 'event') lines.push('#EXT-X-PLAYLIST-TYPE:EVENT');
  for (let g = first; g <= last; g++) {
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${isoTime(g * SEGMENT_SECONDS)}`);
    lines.push(`#EXTINF:${duration(g).toFixed(3)},`);
    lines.push(uri(g));
  }
  if (kind === 'vod') lines.push('#EXT-X-ENDLIST');
  lines.push('');
  return lines.join('\n');
}

const pad = (value, width = 2) => String(value).padStart(width, '0');

function cueTime(seconds) {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.000`;
}

function clock(seconds) {
  const date = new Date(seconds * 1000);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** One WebVTT segment: a cue per second showing the wall clock (UTC). */
export function webvttSegment({ g, baseLoop, firstVideoPts, label }) {
  const mpegts = wrapPts(
    firstVideoPts + loopSegment(g) * SEGMENT_SECONDS * PTS_HZ + ptsOffset(g, baseLoop),
  );
  const lines = ['WEBVTT', `X-TIMESTAMP-MAP=MPEGTS:${mpegts},LOCAL:00:00:00.000`, ''];
  for (let s = 0; s < SEGMENT_SECONDS; s++) {
    lines.push(`${cueTime(s)} --> ${cueTime(s + 1)}`);
    lines.push(`${label} ${clock(g * SEGMENT_SECONDS + s)} UTC`, '');
  }
  return lines.join('\n');
}
