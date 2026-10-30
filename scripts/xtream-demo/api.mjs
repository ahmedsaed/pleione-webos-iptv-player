// Xtream Codes response bodies for the demo catalog: player_api.php actions,
// the get.php M3U and the xmltv.php guide. Shapes follow what real panels
// send, including their habit of mixing numbers and numeric strings.

import { escapeXml } from './assets.mjs';
import { guideRange, hasArchive, programmesBetween, programmesForDay } from './catalog.mjs';
import { RENDITIONS, VOD_CLIPS } from './media.mjs';

export const SERVER_TIMEZONE = 'UTC';
const DAY_SECONDS = 86400;

const pad = (value) => String(value).padStart(2, '0');

export function formatDateTime(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function xmltvTime(seconds) {
  return `${formatDateTime(seconds).replace(/[-: ]/g, '')} +0000`;
}

function formatDuration(seconds) {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

const base64 = (text) => Buffer.from(text, 'utf8').toString('base64');

export function assetUrls(ctx) {
  const asset = `${ctx.origin}/demo-assets`;
  return {
    logo: channel => `${asset}/logo/${channel.streamId}.svg`,
    moviePoster: movie => `${asset}/poster/movie/${movie.streamId}.svg`,
    seriesCover: series => `${asset}/poster/series/${series.seriesId}.svg`,
    still: episode => `${asset}/still/${episode.id}.svg`,
    sidecar: ext => `${asset}/subtitles/feature.${ext}`,
  };
}

function streamPath(ctx, kind, id, ext) {
  const user = encodeURIComponent(ctx.username);
  const pass = encodeURIComponent(ctx.password);
  return `${ctx.origin}/${kind}/${user}/${pass}/${id}${ext ? `.${ext}` : ''}`;
}

export function accountInfo(ctx) {
  const port = new URL(ctx.origin).port || '80';
  return {
    user_info: {
      username: ctx.username,
      password: ctx.password,
      message: 'Demo Xtream server',
      auth: 1,
      status: 'Active',
      exp_date: String(ctx.nowSeconds + 365 * DAY_SECONDS),
      is_trial: '0',
      active_cons: '0',
      created_at: String(ctx.nowSeconds - 30 * DAY_SECONDS),
      max_connections: '4',
      allowed_output_formats: ['m3u8', 'ts'],
    },
    server_info: {
      url: new URL(ctx.origin).hostname,
      port,
      https_port: '',
      server_protocol: 'http',
      rtmp_port: '',
      timezone: SERVER_TIMEZONE,
      timestamp_now: ctx.nowSeconds,
      time_now: formatDateTime(ctx.nowSeconds),
      process: true,
    },
  };
}

const categoryList = (categories) => categories.map(category => ({
  category_id: category.id,
  category_name: category.name,
  parent_id: 0,
}));

function inCategory(items, categoryId) {
  return categoryId ? items.filter(item => item.categoryId === categoryId) : items;
}

export function liveStreams(catalog, ctx, categoryId) {
  const urls = assetUrls(ctx);
  return inCategory(catalog.channels, categoryId).map(channel => ({
    num: channel.num,
    name: channel.name,
    stream_type: 'live',
    stream_id: channel.streamId,
    stream_icon: urls.logo(channel),
    epg_channel_id: channel.epgId || null,
    added: String(channel.added),
    is_adult: 0,
    category_id: channel.categoryId,
    category_ids: [Number(channel.categoryId)],
    custom_sid: '',
    tv_archive: channel.archive ? 1 : 0,
    direct_source: '',
    tv_archive_duration: channel.archive ? String(channel.archiveDays) : 0,
  }));
}

export function vodStreams(catalog, ctx, categoryId) {
  const urls = assetUrls(ctx);
  return inCategory(catalog.movies, categoryId).map(movie => ({
    num: movie.num,
    name: movie.name,
    title: movie.name,
    year: String(movie.year),
    stream_type: 'movie',
    stream_id: movie.streamId,
    stream_icon: urls.moviePoster(movie),
    rating: movie.rating,
    rating_5based: Number(movie.rating) / 2,
    added: String(movie.added),
    is_adult: 0,
    category_id: movie.categoryId,
    category_ids: [Number(movie.categoryId)],
    container_extension: 'mp4',
    custom_sid: '',
    direct_source: '',
  }));
}

function sidecarSubtitles(ctx) {
  const urls = assetUrls(ctx);
  return [
    { id: '1', title: 'Sidecar SRT', language: 'l1', url: urls.sidecar('srt') },
    { id: '2', title: 'Sidecar WebVTT', language: 'l2', url: urls.sidecar('vtt') },
  ];
}

const PEOPLE = 'Person 1, Person 2, Person 3';

export function vodInfo(catalog, ctx, vodId) {
  const movie = catalog.movie(vodId);
  if (!movie) return [];
  const urls = assetUrls(ctx);
  const clip = VOD_CLIPS[movie.clip];
  const seconds = clip.seconds;
  const video = RENDITIONS[clip.rendition];
  let plot = `${movie.name} is a synthetic demo title in ${movie.genre.toLowerCase()} for testing the catalog.`;
  if (movie.subtitled) {
    plot = `${movie.name} is a synthetic demo title with two audio tracks, an embedded subtitle track, and sidecar SRT and WebVTT subtitles.`;
  } else if (video) {
    plot = `${movie.name} is a synthetic ${video.width}x${video.height} H.264 and AAC test clip for checking playback at this resolution.`;
  }
  return {
    info: {
      name: movie.name,
      o_name: movie.name,
      cover_big: urls.moviePoster(movie),
      movie_image: urls.moviePoster(movie),
      releasedate: `${movie.year}-0${1 + (movie.streamId % 9)}-15`,
      youtube_trailer: '',
      director: 'Person 4',
      actors: PEOPLE,
      cast: PEOPLE,
      description: plot,
      plot,
      age: '',
      country: '',
      genre: movie.genre,
      backdrop_path: [urls.moviePoster(movie)],
      duration_secs: seconds,
      duration: formatDuration(seconds),
      bitrate: video ? video.kbps : 400,
      ...(video ? { video: { width: video.width, height: video.height, codec_name: 'h264' } } : {}),
      rating: movie.rating,
      tmdb_id: '',
      subtitles: movie.subtitled ? sidecarSubtitles(ctx) : [],
    },
    movie_data: {
      stream_id: movie.streamId,
      name: movie.name,
      title: movie.name,
      year: String(movie.year),
      added: String(movie.added),
      category_id: movie.categoryId,
      category_ids: [Number(movie.categoryId)],
      container_extension: 'mp4',
      custom_sid: '',
      direct_source: '',
    },
  };
}

export function seriesList(catalog, ctx, categoryId) {
  const urls = assetUrls(ctx);
  return inCategory(catalog.series, categoryId).map(item => ({
    num: item.num,
    name: item.name,
    title: item.name,
    year: String(item.year),
    stream_type: 'series',
    series_id: item.seriesId,
    cover: urls.seriesCover(item),
    plot: `${item.name} is a synthetic demo series.`,
    cast: PEOPLE,
    director: 'Person 4',
    genre: item.genre,
    releaseDate: `${item.year}-03-01`,
    release_date: `${item.year}-03-01`,
    last_modified: String(item.lastModified),
    rating: item.rating,
    rating_5based: Number(item.rating) / 2,
    backdrop_path: [urls.seriesCover(item)],
    youtube_trailer: '',
    episode_run_time: String(Math.round(VOD_CLIPS.episode.seconds / 60)),
    category_id: item.categoryId,
    category_ids: [Number(item.categoryId)],
  }));
}

export function seriesInfo(catalog, ctx, seriesId) {
  const item = catalog.seriesItem(seriesId);
  if (!item) return [];
  const urls = assetUrls(ctx);
  const seconds = VOD_CLIPS.episode.seconds;
  const episodes = {};
  for (const season of item.seasons) {
    episodes[String(season.number)] = season.episodes.map((episode) => {
      const entry = {
        id: String(episode.id),
        episode_num: episode.episode,
        title: `${item.name} - S${pad(season.number)}E${pad(episode.episode)} - ${episode.title}`,
        container_extension: 'mp4',
        info: {
          releasedate: `${item.year}-03-${pad(Math.min(28, episode.episode))}`,
          plot: `Synthetic plot for ${episode.title} of ${item.name}.`,
          duration_secs: seconds,
          duration: formatDuration(seconds),
          movie_image: urls.still(episode),
          bitrate: 400,
          rating: item.rating,
          season: String(season.number),
        },
        subtitles: episode.id === item.subtitledEpisodeId ? sidecarSubtitles(ctx) : [],
        custom_sid: '',
        added: String(item.lastModified),
        season: season.number,
        direct_source: '',
      };
      // A provider quirk: episodes that never say which season they belong to.
      if (item.seasonless) {
        delete entry.season;
        delete entry.info.season;
      }
      return entry;
    });
  }
  return {
    seasons: item.seasonless ? [] : item.seasons.map(season => ({
      air_date: `${item.year}-03-01`,
      episode_count: season.episodes.length,
      id: item.seriesId * 100 + season.number,
      name: `Season ${season.number}`,
      overview: '',
      season_number: season.number,
      cover: urls.seriesCover(item),
      cover_big: urls.seriesCover(item),
    })),
    info: {
      name: item.name,
      cover: urls.seriesCover(item),
      plot: `${item.name} is a synthetic demo series with ${item.seasons.length} season(s).`,
      cast: PEOPLE,
      director: 'Person 4',
      genre: item.genre,
      releaseDate: `${item.year}-03-01`,
      last_modified: String(item.lastModified),
      rating: item.rating,
      rating_5based: Number(item.rating) / 2,
      backdrop_path: [urls.seriesCover(item)],
      youtube_trailer: '',
      episode_run_time: String(Math.round(seconds / 60)),
      category_id: item.categoryId,
    },
    episodes,
  };
}

function epgListing(channel, programme, nowSeconds) {
  return {
    id: programme.id,
    epg_id: programme.id,
    title: base64(programme.title),
    lang: '',
    start: formatDateTime(programme.start),
    end: formatDateTime(programme.stop),
    description: base64(programme.description),
    channel_id: channel.epgId,
    start_timestamp: String(programme.start),
    stop_timestamp: String(programme.stop),
    now_playing: programme.start <= nowSeconds && nowSeconds < programme.stop ? 1 : 0,
    has_archive: hasArchive(channel, programme, nowSeconds) ? 1 : 0,
  };
}

export function shortEpg(catalog, ctx, streamId, limit = 4) {
  const channel = catalog.channel(streamId);
  if (!channel) return { epg_listings: [] };
  const programmes = programmesBetween(
    catalog, channel, ctx.nowSeconds, ctx.nowSeconds + 2 * DAY_SECONDS, ctx.nowSeconds,
  ).slice(0, Math.max(1, limit));
  return {
    epg_listings: programmes.map((programme) => {
      const listing = epgListing(channel, programme, ctx.nowSeconds);
      delete listing.now_playing;
      delete listing.has_archive;
      return listing;
    }),
  };
}

export function simpleDataTable(catalog, ctx, streamId) {
  const channel = catalog.channel(streamId);
  if (!channel) return { epg_listings: [] };
  const { firstDay, lastDay } = guideRange(catalog, ctx.nowSeconds);
  const programmes = programmesBetween(
    catalog, channel, firstDay * DAY_SECONDS, (lastDay + 1) * DAY_SECONDS, ctx.nowSeconds,
  );
  return { epg_listings: programmes.map(programme => epgListing(channel, programme, ctx.nowSeconds)) };
}

/** Body for a player_api.php request, or null for an unknown action. */
export function playerApi(catalog, ctx, params) {
  const action = params.get('action');
  const categoryId = params.get('category_id') || '';
  switch (action) {
    case null:
    case '':
      return accountInfo(ctx);
    case 'get_live_categories': return categoryList(catalog.liveCategories);
    case 'get_live_streams': return liveStreams(catalog, ctx, categoryId);
    case 'get_vod_categories': return categoryList(catalog.vodCategories);
    case 'get_vod_streams': return vodStreams(catalog, ctx, categoryId);
    case 'get_vod_info': return vodInfo(catalog, ctx, params.get('vod_id'));
    case 'get_series_categories': return categoryList(catalog.seriesCategories);
    case 'get_series': return seriesList(catalog, ctx, categoryId);
    case 'get_series_info': return seriesInfo(catalog, ctx, params.get('series_id'));
    case 'get_short_epg':
      return shortEpg(catalog, ctx, params.get('stream_id'), Number(params.get('limit')) || 4);
    case 'get_simple_data_table':
    case 'get_simple_date_table':
      return simpleDataTable(catalog, ctx, params.get('stream_id'));
    default:
      return null;
  }
}

/** get.php: live channels, then movies and episodes, as real m3u_plus output does. */
export function m3uPlaylist(catalog, ctx, { type = 'm3u_plus', output = 'ts' } = {}) {
  const plus = type !== 'm3u';
  const liveExt = output === 'm3u8' || output === 'hls' ? 'm3u8' : 'ts';
  const urls = assetUrls(ctx);
  const groups = new Map(catalog.liveCategories.map(category => [category.id, category.name]));
  const vodGroups = new Map(catalog.vodCategories.map(category => [category.id, category.name]));
  const seriesGroups = new Map(catalog.seriesCategories.map(category => [category.id, category.name]));
  const lines = ['#EXTM3U'];
  const entry = (attrs, name, url) => {
    const attrText = plus
      ? attrs.map(([key, value]) => ` ${key}="${String(value).replace(/"/g, "'")}"`).join('')
      : '';
    lines.push(`#EXTINF:-1${attrText},${name}`, url);
  };
  for (const channel of catalog.channels) {
    entry([
      ['tvg-id', channel.epgId], ['tvg-name', channel.name], ['tvg-logo', urls.logo(channel)],
      ['group-title', groups.get(channel.categoryId)],
    ], channel.name, streamPath(ctx, 'live', channel.streamId, liveExt));
  }
  for (const movie of catalog.movies) {
    entry([
      ['tvg-id', ''], ['tvg-name', movie.name], ['tvg-logo', urls.moviePoster(movie)],
      ['group-title', vodGroups.get(movie.categoryId)],
    ], movie.name, streamPath(ctx, 'movie', movie.streamId, 'mp4'));
  }
  for (const item of catalog.series) {
    for (const season of item.seasons) {
      for (const episode of season.episodes) {
        const name = `${item.name} S${pad(season.number)} E${pad(episode.episode)}`;
        entry([
          ['tvg-id', ''], ['tvg-name', name], ['tvg-logo', urls.seriesCover(item)],
          ['group-title', seriesGroups.get(item.categoryId)],
        ], name, streamPath(ctx, 'series', episode.id, 'mp4'));
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Iterate the XMLTV guide in chunks so a large catalog never builds one huge string. */
export function* xmltvChunks(catalog, ctx) {
  const urls = assetUrls(ctx);
  yield '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n'
    + '<tv generator-info-name="xtream-demo-server">\n';
  const guided = catalog.channels.filter(channel => channel.epgId);
  let chunk = '';
  for (const channel of guided) {
    chunk += `<channel id="${escapeXml(channel.epgId)}"><display-name>${escapeXml(channel.name)}</display-name>`
      + `<icon src="${escapeXml(urls.logo(channel))}"/></channel>\n`;
  }
  yield chunk;
  const { firstDay, lastDay } = guideRange(catalog, ctx.nowSeconds);
  for (const channel of guided) {
    chunk = '';
    for (let day = firstDay; day <= lastDay; day++) {
      for (const programme of programmesForDay(catalog, channel, day)) {
        chunk += `<programme start="${xmltvTime(programme.start)}" stop="${xmltvTime(programme.stop)}"`
          + ` channel="${escapeXml(channel.epgId)}"><title>${escapeXml(programme.title)}</title>`
          + `<desc>${escapeXml(programme.description)}</desc>`
          + `<category>${escapeXml(programme.category)}</category></programme>\n`;
      }
    }
    yield chunk;
  }
  yield '</tv>\n';
}

export function xmltv(catalog, ctx) {
  return Array.from(xmltvChunks(catalog, ctx)).join('');
}
