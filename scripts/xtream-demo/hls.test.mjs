import { describe, expect, it } from 'vitest';
import { parseAudioRenditions } from '../../src/utils/audio-tracks.ts';
import { parseSubtitleRenditions } from '../../src/utils/subtitle-tracks.ts';
import { parseWebVTT } from '../../src/utils/webvtt.ts';
import { parseMediaPlaylist } from '../../src/services/hls-subtitles.ts';
import {
  archiveWindow, liveWindow, loopSegment, masterPlaylist, mediaPlaylist, ptsOffset,
  SEGMENT_SECONDS, SEGMENTS_PER_LOOP, webvttSegment,
} from './hls.mjs';

const NOW = 1_800_000_002;

describe('timeline', () => {
  it('ends the live window at the newest finished segment', () => {
    const { first, last } = liveWindow(NOW, 10);
    expect((last + 1) * SEGMENT_SECONDS).toBeLessThanOrEqual(NOW);
    expect((last + 2) * SEGMENT_SECONDS).toBeGreaterThan(NOW);
    expect(last - first + 1).toBe(10);
  });

  it('aligns loop segments with wall-clock seconds', () => {
    const g = 1_800_000_000 / SEGMENT_SECONDS;
    expect(loopSegment(g) * SEGMENT_SECONDS).toBe(1_800_000_000 % 60);
  });

  it('advances PTS by one loop per loop', () => {
    expect(ptsOffset(SEGMENTS_PER_LOOP * 10, 10)).toBe(0);
    expect(ptsOffset(SEGMENTS_PER_LOOP * 11 + 3, 10)).toBe(60 * 90000);
  });

  it('caps an archive window at the live edge', () => {
    expect(archiveWindow(NOW - 3600, 1800, NOW)).toMatchObject({ complete: true });
    const open = archiveWindow(NOW - 60, 1800, NOW);
    expect(open.complete).toBe(false);
    expect(open.last).toBe(liveWindow(NOW).last);
  });
});

describe('playlists, read by the app parsers', () => {
  const master = masterPlaylist({
    variants: [{
      uri: '/v.m3u8', bandwidth: 400000, codecs: 'avc1.4d401e,mp4a.40.2', resolution: '640x360', frameRate: 15,
    }],
    audio: [
      { name: 'Track 1', language: 'l1', default: true, uri: '/a1.m3u8' },
      { name: 'Track 2', language: 'l2', default: false, uri: '/a2.m3u8' },
    ],
    subtitles: [{ name: 'Track 3', language: 'l1', uri: '/s.m3u8' }],
  });

  it('names two audio renditions', () => {
    expect(parseAudioRenditions(master).map(track => [track.name, track.lang]))
      .toEqual([['Track 1', 'l1'], ['Track 2', 'l2']]);
  });

  it('names an unforced subtitle rendition', () => {
    expect(parseSubtitleRenditions(master)).toEqual([
      expect.objectContaining({ name: 'Track 3', lang: 'l1', isForced: false }),
    ]);
  });

  it('lists one STREAM-INF per variant, in order, sharing the renditions', () => {
    const ladder = masterPlaylist({
      variants: [
        { uri: '/a.m3u8', bandwidth: 500000, codecs: 'c1', resolution: '640x360', frameRate: 30 },
        { uri: '/b.m3u8', bandwidth: 5000000, codecs: 'c2', resolution: '1920x1080', frameRate: 30 },
      ],
      audio: [{ name: 'Track 1', language: 'l1', default: true, uri: '/a1.m3u8' }],
      subtitles: [],
    });
    const lines = ladder.split('\n');
    const inf = lines.filter(line => line.startsWith('#EXT-X-STREAM-INF:'));
    expect(inf).toEqual([
      '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="c1",RESOLUTION=640x360,FRAME-RATE=30.000,AUDIO="aud"',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="c2",RESOLUTION=1920x1080,FRAME-RATE=30.000,AUDIO="aud"',
    ]);
    expect(lines[lines.indexOf(inf[1]) + 1]).toBe('/b.m3u8');
  });

  it('tags every segment with PROGRAM-DATE-TIME', () => {
    const text = mediaPlaylist({ first: 100, last: 104, kind: 'live', uri: g => `/s/${g}.vtt` });
    const parsed = parseMediaPlaylist(text);
    expect(parsed.segs).toHaveLength(5);
    expect(parsed.segs[0].pdtMs).toBe(100 * SEGMENT_SECONDS * 1000);
    expect(text).not.toContain('ENDLIST');
    expect(mediaPlaylist({ first: 1, last: 2, kind: 'vod', uri: String })).toContain('#EXT-X-ENDLIST');
  });

  it('writes WebVTT segments with a timestamp map and wall-clock cues', () => {
    const vtt = webvttSegment({ g: 450_000_000, baseLoop: 29_999_999, firstVideoPts: 126000, label: 'ch1' });
    expect(vtt).toContain(`X-TIMESTAMP-MAP=MPEGTS:${126000 + 60 * 90000},LOCAL:00:00:00.000`);
    const parsed = parseWebVTT(vtt);
    expect(parsed.cues).toHaveLength(SEGMENT_SECONDS);
    expect(parsed.cues[0].text).toBe('ch1 08:00:00 UTC');
  });
});
