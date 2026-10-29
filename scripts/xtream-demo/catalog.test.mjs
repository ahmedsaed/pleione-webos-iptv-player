import { describe, expect, it } from 'vitest';
import {
  createCatalog, guideRange, hasArchive, letterCode, LONG_NAME_CHANNEL, NO_EPG_CHANNEL,
  programmesBetween, programmesForDay, SEASONLESS_SERIES_INDEX, SUBTITLED_MOVIE_INDEX,
} from './catalog.mjs';

const DAY = 86400;
const NOW = Date.UTC(2026, 2, 10, 12, 30) / 1000;

describe('createCatalog', () => {
  it('builds the small catalog', () => {
    const catalog = createCatalog('small');
    expect(catalog.channels).toHaveLength(150);
    expect(catalog.movies).toHaveLength(240);
    expect(catalog.series).toHaveLength(120);
    expect(catalog.channels.slice(0, 3).map(channel => channel.name))
      .toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('builds the large catalog for performance testing', () => {
    const catalog = createCatalog('large');
    expect(catalog.channels).toHaveLength(2000);
    expect(catalog.movies).toHaveLength(1500);
    expect(catalog.series).toHaveLength(300);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(createCatalog('small').movies))
      .toBe(JSON.stringify(createCatalog('small').movies));
  });

  it('rejects an unknown size', () => {
    expect(() => createCatalog('huge')).toThrow('Unknown catalog size');
  });

  it('keeps ids unique across channels, movies, series and episodes', () => {
    const catalog = createCatalog('large');
    const unique = list => new Set(list).size === list.length;
    expect(unique(catalog.channels.map(channel => channel.streamId))).toBe(true);
    expect(unique(catalog.movies.map(movie => movie.streamId))).toBe(true);
    const episodes = catalog.series.flatMap(item =>
      item.seasons.flatMap(season => season.episodes.map(episode => episode.id)));
    expect(unique(episodes)).toBe(true);
  });

  it('includes the edge cases the app must handle', () => {
    const catalog = createCatalog('small');
    expect(catalog.channel(LONG_NAME_CHANNEL).name.length).toBeGreaterThan(60);
    expect(catalog.channel(NO_EPG_CHANNEL).epgId).toBe('');
    const used = new Set(catalog.channels.map(channel => channel.categoryId));
    expect(catalog.liveCategories.filter(category => !used.has(category.id)))
      .toEqual([expect.objectContaining({ empty: true })]);
    expect(catalog.vodCategories.at(-1).empty).toBe(true);
    expect(catalog.seriesCategories.at(-1).empty).toBe(true);
    expect(catalog.movies[SUBTITLED_MOVIE_INDEX]).toMatchObject({ subtitled: true, clip: 'feature' });
    expect(catalog.series[SEASONLESS_SERIES_INDEX].seasonless).toBe(true);
    expect(catalog.channels.filter(channel => channel.archive).length).toBeGreaterThan(40);
  });

  it('spreads added dates so recently-added sorting is meaningful', () => {
    const added = createCatalog('small').movies.map(movie => movie.added);
    expect(new Set(added).size).toBe(added.length);
    expect([...added].sort((a, b) => b - a)).not.toEqual(added);
  });
});

describe('letterCode', () => {
  it('counts like spreadsheet columns', () => {
    expect([0, 25, 26, 27, 701].map(letterCode)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ']);
  });
});

describe('EPG schedule', () => {
  const catalog = createCatalog('small');
  const alpha = catalog.channel(1);

  it('tiles each UTC day exactly', () => {
    const day = Math.floor(NOW / DAY);
    const list = programmesForDay(catalog, alpha, day);
    expect(list[0].start).toBe(day * DAY);
    expect(list.at(-1).stop).toBe((day + 1) * DAY);
    for (let i = 1; i < list.length; i++) expect(list[i].start).toBe(list[i - 1].stop);
  });

  it('covers past days for catch-up and future days for the guide', () => {
    const { firstDay, lastDay } = guideRange(catalog, NOW);
    expect(lastDay - firstDay + 1).toBe(catalog.spec.epgPastDays + catalog.spec.epgFutureDays);
    const window = programmesBetween(catalog, alpha, 0, 4e9, NOW);
    expect(window[0].start).toBe(firstDay * DAY);
    expect(window.at(-1).stop).toBe((lastDay + 1) * DAY);
  });

  it('has no programmes for the channel without EPG', () => {
    expect(programmesBetween(catalog, catalog.channel(NO_EPG_CHANNEL), 0, 4e9, NOW)).toEqual([]);
  });

  it('marks only finished programmes inside the archive window as archived', () => {
    const list = programmesBetween(catalog, alpha, NOW - 4 * DAY, NOW + DAY, NOW);
    const archived = list.filter(programme => hasArchive(alpha, programme, NOW));
    expect(archived.length).toBeGreaterThan(0);
    for (const programme of archived) {
      expect(programme.stop).toBeLessThanOrEqual(NOW);
      expect(programme.start).toBeGreaterThanOrEqual(NOW - alpha.archiveDays * DAY);
    }
    expect(list.some(programme => hasArchive(catalog.channel(2), programme, NOW))).toBe(false);
  });
});

describe('small catalog rails', () => {
  it('fills every non-empty group past the 20-title rail, so each ends in See all', () => {
    const catalog = createCatalog('small');
    for (const [items, groups] of [[catalog.movies, catalog.vodCategories], [catalog.series, catalog.seriesCategories]]) {
      for (const group of groups.filter(g => !g.empty)) {
        expect(items.filter(item => item.categoryId === group.id).length).toBeGreaterThan(20);
      }
    }
  });
});
