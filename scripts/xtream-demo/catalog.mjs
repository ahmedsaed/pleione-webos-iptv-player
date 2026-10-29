// Deterministic synthetic catalog for the demo Xtream server: live channels,
// movies, series, and a wall-clock EPG schedule. Pure data — no I/O — so the
// API layer and the tests share one source of truth.

export const SIZES = {
  small: {
    liveCategories: 8, channels: 150,
    vodCategories: 6, movies: 120,
    seriesCategories: 4, series: 24,
    epgPastDays: 3, epgFutureDays: 2, archiveDays: 3,
    programmeMinutes: [15, 30, 30, 45, 60, 60, 90],
  },
  large: {
    liveCategories: 40, channels: 2000,
    vodCategories: 25, movies: 1500,
    seriesCategories: 12, series: 300,
    // Two guide days keep the full XMLTV under the app's retained-programme cap.
    epgPastDays: 1, epgFutureDays: 1, archiveDays: 1,
    programmeMinutes: [30, 45, 60, 60, 90, 120],
  },
};

const DAY_SECONDS = 86400;
// Fixed reference for `added`/`last_modified` so catalog output never depends on the clock.
const CATALOG_EPOCH = Date.UTC(2026, 0, 1) / 1000;
const GENRES = ['Drama', 'Comedy', 'Documentary', 'Adventure', 'Mystery', 'Family'];

export const LONG_NAME_CHANNEL = 4;
export const NO_EPG_CHANNEL = 6;
export const SUBTITLED_MOVIE_INDEX = 0;
export const SEASONLESS_SERIES_INDEX = 3;

// 32-bit integer mix of any number of integer inputs; stable across runs.
export function hash(...values) {
  let h = 0x2545f491;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

// 0 -> A, 25 -> Z, 26 -> AA: spreadsheet-style letter codes for item names.
export function letterCode(index) {
  let code = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    code = String.fromCharCode(65 + rem) + code;
    n = Math.floor((n - 1) / 26);
  }
  return code;
}

function channelName(n) {
  if (n === 1) return 'Alpha';
  if (n === 2) return 'Bravo';
  if (n === 3) return 'Charlie';
  if (n === LONG_NAME_CHANNEL) {
    return `Channel ${n} with an exceptionally long synthetic name that keeps going to test truncation`;
  }
  return `Channel ${n}`;
}

function spread(count, buckets) {
  const per = Math.ceil(count / buckets);
  return (index) => Math.floor(index / per);
}

function categories(count, extraEmpty) {
  const list = [];
  for (let i = 1; i <= count + (extraEmpty ? 1 : 0); i++) {
    list.push({ id: String(i), name: `Group ${i}`, empty: i > count });
  }
  return list;
}

function rating(seed) {
  return (5 + (seed % 45) / 10).toFixed(1);
}

export function createCatalog(size = 'small') {
  const spec = SIZES[size];
  if (!spec) throw new Error(`Unknown catalog size: ${size}`);

  const liveCategories = categories(spec.liveCategories, true);
  const liveBucket = spread(spec.channels, spec.liveCategories);
  const channels = [];
  for (let n = 1; n <= spec.channels; n++) {
    const archive = n === 1 || n % 3 === 0;
    channels.push({
      num: n,
      streamId: n,
      name: channelName(n),
      categoryId: liveCategories[liveBucket(n - 1)].id,
      epgId: n === NO_EPG_CHANNEL ? '' : `ch${n}`,
      archive,
      archiveDays: archive ? spec.archiveDays : 0,
      hue: (n * 47) % 360,
      added: CATALOG_EPOCH - n * 3600,
    });
  }

  const vodCategories = categories(spec.vodCategories, true);
  const vodBucket = spread(spec.movies, spec.vodCategories);
  const movies = [];
  for (let i = 0; i < spec.movies; i++) {
    const seed = hash(i, 11);
    const subtitled = i === SUBTITLED_MOVIE_INDEX;
    movies.push({
      num: i + 1,
      streamId: 10001 + i,
      name: `Movie ${letterCode(i)}`,
      categoryId: vodCategories[vodBucket(i)].id,
      clip: subtitled ? 'feature' : (i % 2 ? 'movie-b' : 'movie-a'),
      subtitled,
      rating: rating(seed),
      year: 1990 + (seed % 36),
      // Spread over ~2 years with a per-item jitter, so "Recently added" sorting is meaningful.
      added: CATALOG_EPOCH - ((i * 7919) % (spec.movies * 2)) * 21600 - (seed % 3600),
      genre: GENRES[seed % GENRES.length],
      hue: (i * 67 + 20) % 360,
    });
  }

  const seriesCategories = categories(spec.seriesCategories, true);
  const seriesBucket = spread(spec.series, spec.seriesCategories);
  const series = [];
  let episodeId = 200001;
  for (let i = 0; i < spec.series; i++) {
    const seed = hash(i, 23);
    const seasonCount = 1 + (seed % 3);
    const seasons = [];
    for (let s = 1; s <= seasonCount; s++) {
      const episodeCount = 3 + (hash(i, s, 29) % 6);
      const episodes = [];
      for (let e = 1; e <= episodeCount; e++) {
        episodes.push({ id: episodeId++, season: s, episode: e, title: `Episode ${e}` });
      }
      seasons.push({ number: s, episodes });
    }
    series.push({
      num: i + 1,
      seriesId: 5001 + i,
      name: `Series ${letterCode(i)}`,
      categoryId: seriesCategories[seriesBucket(i)].id,
      rating: rating(seed),
      year: 2000 + (seed % 26),
      lastModified: CATALOG_EPOCH - ((i * 4241) % (spec.series * 3)) * 43200,
      genre: GENRES[seed % GENRES.length],
      hue: (i * 83 + 200) % 360,
      seasonless: i === SEASONLESS_SERIES_INDEX,
      // The first episode of the first series carries the sidecar subtitles.
      subtitledEpisodeId: i === 0 ? seasons[0].episodes[0].id : 0,
      seasons,
    });
  }

  const byStreamId = new Map(channels.map(channel => [channel.streamId, channel]));
  const movieById = new Map(movies.map(movie => [movie.streamId, movie]));
  const seriesById = new Map(series.map(item => [item.seriesId, item]));
  const episodeById = new Map();
  for (const item of series) {
    for (const season of item.seasons) {
      for (const episode of season.episodes) episodeById.set(episode.id, { series: item, episode });
    }
  }

  return {
    size,
    spec,
    liveCategories,
    channels,
    vodCategories,
    movies,
    seriesCategories,
    series,
    channel: id => byStreamId.get(Number(id)),
    movie: id => movieById.get(Number(id)),
    seriesItem: id => seriesById.get(Number(id)),
    episode: id => episodeById.get(Number(id)),
  };
}

// One UTC day of programmes for a channel. Programmes tile the day exactly and
// never straddle midnight, so any window is just the union of whole days.
export function programmesForDay(catalog, channel, day) {
  const durations = catalog.spec.programmeMinutes;
  const start = day * DAY_SECONDS;
  const end = start + DAY_SECONDS;
  const list = [];
  let t = start;
  for (let k = 0; t < end; k++) {
    const h = hash(channel.streamId, day, k);
    const stop = Math.min(end, t + durations[h % durations.length] * 60);
    const number = 1 + (hash(channel.streamId, day, k, 7) % 400);
    list.push({
      id: `${channel.streamId}-${day}-${k}`,
      start: t,
      stop,
      title: `Program ${number}`,
      description: `Synthetic description for Program ${number} on ${channel.name}.`,
      category: GENRES[h % GENRES.length],
    });
    t = stop;
  }
  return list;
}

export function guideRange(catalog, nowSeconds) {
  const today = Math.floor(nowSeconds / DAY_SECONDS);
  return {
    firstDay: today - catalog.spec.epgPastDays,
    lastDay: today + catalog.spec.epgFutureDays - 1,
  };
}

// Programmes overlapping [from, to) inside the guide range; empty for a channel without EPG.
export function programmesBetween(catalog, channel, from, to, nowSeconds) {
  if (!channel.epgId) return [];
  const { firstDay, lastDay } = guideRange(catalog, nowSeconds);
  const result = [];
  const startDay = Math.max(firstDay, Math.floor(from / DAY_SECONDS));
  const endDay = Math.min(lastDay, Math.floor((to - 1) / DAY_SECONDS));
  for (let day = startDay; day <= endDay; day++) {
    for (const programme of programmesForDay(catalog, channel, day)) {
      if (programme.stop > from && programme.start < to) result.push(programme);
    }
  }
  return result;
}

export function hasArchive(channel, programme, nowSeconds) {
  return channel.archive
    && programme.stop <= nowSeconds
    && programme.start >= nowSeconds - channel.archiveDays * DAY_SECONDS;
}
