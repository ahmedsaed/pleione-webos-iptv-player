// Locally generated, cached media for the demo Xtream server. Everything comes
// from ffmpeg's own test sources (color bars + sine tones), so no content is
// downloaded or bundled. Shared pieces (audio loops, VOD clips) are built up
// front; each live channel's loop is encoded on first use (or by --prepare).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { firstPts } from './mpegts.mjs';
import { LOOP_SECONDS, SEGMENT_SECONDS, SEGMENTS_PER_LOOP } from './hls.mjs';

export const MEDIA_VERSION = 'v2';
export const VIDEO = { width: 640, height: 360, fps: 15 };
export const VIDEO_PID = 0x100;
export const LIVE_CODECS = 'avc1.4d401e,mp4a.40.2';
export const LIVE_BANDWIDTH = 400_000;

export const LIVE_AUDIO = [
  { id: 'l1', name: 'Track 1', language: 'l1', frequency: 440, beep: 2 },
  { id: 'l2', name: 'Track 2', language: 'l2', frequency: 330, beep: 3 },
];
export const LIVE_SUBTITLES = [{ id: 'l1', name: 'Track 3', language: 'l1' }];

export const VOD_CLIPS = {
  'movie-a': { seconds: 120, label: 'Movie clip A', hue: 200 },
  'movie-b': { seconds: 180, label: 'Movie clip B', hue: 20 },
  // Two audio tracks plus an embedded subtitle track; sidecars are served beside it.
  feature: { seconds: 150, label: 'Feature clip', hue: 280, extraTracks: true },
  episode: { seconds: 90, label: 'Episode clip', hue: 120 },
};

const AUDIO_RATE = 32000;
// AAC in MPEG-TS keeps the encoder's 1024-sample priming frame, so trim one
// frame from the source to make the loop exactly LOOP_SECONDS long.
const AUDIO_LOOP_SAMPLES = LOOP_SECONDS * AUDIO_RATE - 1024;
const GOP = VIDEO.fps * SEGMENT_SECONDS;
const SIZE = `${VIDEO.width}x${VIDEO.height}`;

// Static color bars with a sliding box: cheap to encode, tiny on disk, and the
// motion still shows at a glance whether playback is advancing.
function testPattern(seconds) {
  return `smptehdbars=size=${SIZE}:rate=${VIDEO.fps}:duration=${seconds},`
    + "drawbox=x='mod(t*144\\,iw-48)':y=140:w=48:h=48:color=white@0.9:t=fill";
}

export function runFfmpeg(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      cwd, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export function ffmpegAvailable() {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Build into a private temp dir and rename it into place, so concurrent
// servers (or test workers) sharing a cache never see a half-written entry.
async function buildOnce(target, build) {
  if (await exists(target)) return;
  const temp = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await mkdir(temp, { recursive: true });
  try {
    await build(temp);
    try {
      await rename(temp, target);
    } catch (error) {
      if (!(await exists(target))) throw error;
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function segmentDurations(playlist) {
  return playlist.split('\n')
    .filter(line => line.startsWith('#EXTINF:'))
    .map(line => Number(line.slice(8).split(',')[0]));
}

async function segmentLoop(dir, name, inputArgs, mapArgs) {
  await mkdir(join(dir, name));
  await runFfmpeg([
    ...inputArgs, ...mapArgs, '-c', 'copy',
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_list_size', '0',
    '-hls_segment_filename', join(dir, name, '%02d.ts'), join(dir, name, 'index.m3u8'),
  ]);
  const durations = segmentDurations(await readFile(join(dir, name, 'index.m3u8'), 'utf8'));
  if (durations.length !== SEGMENTS_PER_LOOP) {
    throw new Error(`Expected ${SEGMENTS_PER_LOOP} ${name} segments, ffmpeg wrote ${durations.length}`);
  }
  return durations;
}

function srtTime(seconds) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor(seconds / 60) % 60)}:${p(seconds % 60)},000`;
}

export function subtitleCues(seconds, label, every = 5) {
  const cues = [];
  for (let start = 1, n = 1; start + 3 <= seconds; start += every, n++) {
    cues.push({ start, end: start + 3, text: `${label} ${n}` });
  }
  return cues;
}

export function toSrt(cues) {
  return cues.map((cue, i) =>
    `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

export function toWebvtt(cues) {
  return `WEBVTT\n\n${cues.map(cue =>
    `${srtTime(cue.start).replace(',', '.')} --> ${srtTime(cue.end).replace(',', '.')}\n${cue.text}\n`)
    .join('\n')}`;
}

function semaphore(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active++;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return task => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

export function createMediaStore({ cacheDir, log = () => {}, concurrency = 2 }) {
  const root = join(cacheDir, MEDIA_VERSION);
  const shared = join(root, 'shared');
  const channelJobs = new Map();
  const metaCache = new Map();
  let limit = semaphore(concurrency);
  let sharedJob = null;

  async function buildShared() {
    await mkdir(root, { recursive: true });
    await buildOnce(shared, async (dir) => {
      log('Generating the shared live test pattern and audio loops...');
      await runFfmpeg([
        '-f', 'lavfi', '-i', testPattern(LOOP_SECONDS),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
        join(dir, 'base.mp4'),
      ]);
      const audio = {};
      for (const track of LIVE_AUDIO) {
        const m4a = join(dir, `audio-${track.id}.m4a`);
        await runFfmpeg([
          '-f', 'lavfi',
          '-i', `sine=frequency=${track.frequency}:beep_factor=${track.beep}:sample_rate=${AUDIO_RATE}`,
          '-af', `atrim=end_sample=${AUDIO_LOOP_SAMPLES},volume=0.25`,
          '-c:a', 'aac', '-b:a', '48k', '-ac', '1', m4a,
        ]);
        audio[track.id] = await segmentLoop(dir, `audio-${track.id}`, ['-i', m4a], ['-map', '0:a']);
      }
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ audio }));
    });
    await mkdir(join(root, 'vod'), { recursive: true });
    await Promise.all(Object.entries(VOD_CLIPS).map(([clip, spec]) =>
      buildOnce(join(root, 'vod', clip), dir => buildVodClip(dir, spec))));
  }

  async function buildVodClip(dir, spec) {
    log(`Generating the ${spec.label.toLowerCase()} (${spec.seconds}s)...`);
    await writeFile(join(dir, 'label.txt'), `${spec.label}  %{pts:hms}`);
    const inputs = [
      '-f', 'lavfi', '-i', testPattern(spec.seconds),
      '-f', 'lavfi', '-i', `sine=frequency=520:beep_factor=2:sample_rate=48000:duration=${spec.seconds}`,
    ];
    const maps = ['-map', '0:v', '-map', '1:a'];
    const metadata = ['-metadata:s:a:0', 'title=Track 1', '-metadata:s:a:0', 'handler_name=Track 1'];
    if (spec.extraTracks) {
      const cues = subtitleCues(spec.seconds, 'Embedded subtitle');
      await writeFile(join(dir, 'embedded.srt'), toSrt(cues));
      inputs.push(
        '-f', 'lavfi', '-i', `sine=frequency=780:beep_factor=1.5:sample_rate=48000:duration=${spec.seconds}`,
        '-i', join(dir, 'embedded.srt'),
      );
      maps.push('-map', '2:a', '-map', '3:s');
      metadata.push(
        '-metadata:s:a:1', 'title=Track 2', '-metadata:s:a:1', 'handler_name=Track 2',
        '-metadata:s:s:0', 'title=Track 3', '-metadata:s:s:0', 'handler_name=Track 3',
        '-c:s', 'mov_text',
      );
      await writeFile(join(dir, 'sidecar.srt'), toSrt(subtitleCues(spec.seconds, 'Sidecar SRT line', 6)));
      await writeFile(join(dir, 'sidecar.vtt'), toWebvtt(subtitleCues(spec.seconds, 'Sidecar WebVTT line', 7)));
    }
    await runFfmpeg([
      ...inputs, ...maps,
      // Top of the frame, so the player's bottom OSD never covers the running time.
      '-vf', `hue=h=${spec.hue},drawtext=textfile=label.txt:font=Sans:fontsize=28:fontcolor=white:`
        + 'box=1:boxcolor=black@0.6:boxborderw=10:x=(w-tw)/2:y=36',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-crf', '24', '-maxrate', '400k', '-bufsize', '800k', '-g', String(VIDEO.fps * 2),
      '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
      ...metadata, '-movflags', '+faststart', '-t', String(spec.seconds), 'clip.mp4',
    ], { cwd: dir });
  }

  async function buildChannel(dir, channel) {
    const long = channel.name.length > 28;
    await writeFile(join(dir, 'name.txt'), channel.name);
    await writeFile(join(dir, 'clock.txt'), 'LIVE  :%{pts:gmtime:0:%S}');
    await runFfmpeg([
      '-i', join(shared, 'base.mp4'),
      '-vf', [
        `hue=h=${channel.hue}`,
        `drawtext=textfile=name.txt:expansion=none:font=Sans:fontsize=${long ? 20 : 48}:fontcolor=white:`
          + 'box=1:boxcolor=black@0.65:boxborderw=14:x=(w-tw)/2:y=40',
        'drawtext=textfile=clock.txt:font=Sans:fontsize=40:fontcolor=yellow:'
          + 'box=1:boxcolor=black@0.65:boxborderw=12:x=(w-tw)/2:y=h-th-40',
      ].join(','),
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-level', '3.0',
      '-bf', '0', '-pix_fmt', 'yuv420p', '-crf', '26', '-maxrate', '300k',
      '-bufsize', '600k', '-g', String(GOP), '-keyint_min', String(GOP), '-sc_threshold', '0',
      '-an', 'video.mp4',
    ], { cwd: dir });
    const video = await segmentLoop(dir, 'video', ['-i', join(dir, 'video.mp4')], ['-map', '0:v']);
    const muxed = await segmentLoop(dir, 'muxed', [
      '-i', join(dir, 'video.mp4'),
      ...LIVE_AUDIO.flatMap(track => ['-i', join(shared, `audio-${track.id}.m4a`)]),
    ], ['-map', '0:v', ...LIVE_AUDIO.flatMap((_, i) => ['-map', `${i + 1}:a`])]);
    const firstVideoPts = firstPts(await readFile(join(dir, 'video', '00.ts')), VIDEO_PID);
    await rm(join(dir, 'video.mp4'));
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ video, muxed, firstVideoPts }));
  }

  const store = {
    root,

    ensureShared() {
      if (!sharedJob) {
        sharedJob = buildShared().catch((error) => {
          sharedJob = null;
          throw error;
        });
      }
      return sharedJob;
    },

    async sharedMeta() {
      if (!metaCache.has('shared')) {
        await store.ensureShared();
        metaCache.set('shared', JSON.parse(await readFile(join(shared, 'meta.json'), 'utf8')));
      }
      return metaCache.get('shared');
    },

    channelDir: channel => join(root, 'live', String(channel.streamId)),

    /** Loop metadata for a channel, encoding it first if needed. */
    async ensureChannel(channel) {
      const key = channel.streamId;
      if (metaCache.has(key)) return metaCache.get(key);
      let job = channelJobs.get(key);
      if (!job) {
        job = (async () => {
          await store.ensureShared();
          const dir = store.channelDir(channel);
          if (!(await exists(dir))) {
            await mkdir(join(root, 'live'), { recursive: true });
            await limit(() => buildOnce(dir, temp => buildChannel(temp, channel)));
          }
          const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
          metaCache.set(key, meta);
          return meta;
        })().finally(() => channelJobs.delete(key));
        channelJobs.set(key, job);
      }
      return job;
    },

    async channelSegment(channel, set, index) {
      await store.ensureChannel(channel);
      return readFile(join(store.channelDir(channel), set, `${String(index).padStart(2, '0')}.ts`));
    },

    async audioSegment(trackId, index) {
      await store.ensureShared();
      return readFile(join(shared, `audio-${trackId}`, `${String(index).padStart(2, '0')}.ts`));
    },

    async vodFile(clip, name = 'clip.mp4') {
      await store.ensureShared();
      return join(root, 'vod', clip, name);
    },

    /** Encode every channel loop now instead of on first play. */
    async prepareChannels(channels, { jobs = 2, onProgress = () => {} } = {}) {
      limit = semaphore(jobs);
      let done = 0;
      await Promise.all(channels.map(channel => store.ensureChannel(channel).then(() => {
        onProgress(++done, channels.length);
      })));
      limit = semaphore(concurrency);
    },
  };
  return store;
}
