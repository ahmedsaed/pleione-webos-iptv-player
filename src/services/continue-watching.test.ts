import { describe, expect, it } from 'vitest';
import { latestPerSeries } from './continue-watching';
import type { ResumeEntry, VodQueueItem } from '../types';

const owner = (itemId: string) => ({ kind: 'series' as const, itemId });

const item = (id: string, series = 's1'): VodQueueItem => ({
  url: `http://host/series/u/p/${id}.mkv`, title: `Series ${series} ${id}`, poster: `http://host/${id}.jpg`,
  accountId: 'x1', itemId: id, kind: 'episode', categoryId: 'c1', parentalItemId: series,
  subtitles: [], watchlistOwner: owner(series),
});

// An episode of a five-or-more-episode series s1 (e1..e8), with the queue the
// series page gives the player: the episodes before and after it.
const episode = (id: string, over: Partial<ResumeEntry> = {}, all = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']): ResumeEntry => {
  const index = all.indexOf(id);
  return {
    accountId: 'x1', kind: 'episode', itemId: id, name: `Series s1 ${id}`, poster: '', ext: 'mkv',
    position: 300, duration: 1500, updatedAt: 1000,
    previousEpisodes: all.slice(0, index).map(e => item(e)),
    episodeQueue: all.slice(index + 1).map(e => item(e)),
    watchlistOwner: owner('s1'), categoryId: 'c1', ...over,
  };
};

const movie = (id: string, updatedAt: number): ResumeEntry => ({
  accountId: 'x1', kind: 'vod', itemId: id, name: id, poster: '', ext: 'mp4',
  position: 100, duration: 6000, updatedAt,
});

describe('latestPerSeries', () => {
  it('continues at the next episode after a partial one was followed by later finished ones', () => {
    const list = latestPerSeries([episode('e5', { updatedAt: 1000 })], [
      { itemId: 'e6', watchedAt: 2000 },
      { itemId: 'e7', watchedAt: 3000 },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      itemId: 'e8', name: 'Series s1 e8', poster: 'http://host/e8.jpg', ext: 'mkv',
      position: 0, duration: 0, updatedAt: 3000, watchlistOwner: owner('s1'), categoryId: 'c1',
    });
    expect(list[0].episodeQueue).toEqual([]);
  });

  it('drops the series once its last episode was finished', () => {
    expect(latestPerSeries([episode('e5')], [
      { itemId: 'e6', watchedAt: 2000 },
      { itemId: 'e8', watchedAt: 3000 },
    ])).toEqual([]);
  });

  it('keeps only the series\' most recently played partial episode', () => {
    const list = latestPerSeries([
      episode('e7', { updatedAt: 3000 }),
      episode('e5', { updatedAt: 1000 }),
    ], [{ itemId: 'e6', watchedAt: 2000 }]);
    expect(list.map(e => [e.itemId, e.position])).toEqual([['e7', 300]]);
  });

  it('keeps a partial episode played after the finished ones', () => {
    const list = latestPerSeries([episode('e5', { updatedAt: 3000 })], [
      { itemId: 'e6', watchedAt: 2000 },
    ]);
    expect(list.map(e => e.itemId)).toEqual(['e5']);
  });

  it('continues at the saved point of the next episode when one is stored', () => {
    const list = latestPerSeries([
      episode('e3', { updatedAt: 2000 }),
      episode('e7', { updatedAt: 1000, position: 600 }),
    ], [{ itemId: 'e6', watchedAt: 3000 }]);
    expect(list.map(e => [e.itemId, e.position, e.updatedAt])).toEqual([['e7', 600, 3000]]);
  });

  it('continues after an earlier episode played again to its end', () => {
    const list = latestPerSeries([episode('e5', { updatedAt: 1000 })], [
      { itemId: 'e2', watchedAt: 2000 },
    ]);
    expect(list.map(e => [e.itemId, e.position])).toEqual([['e3', 0]]);
  });

  it('ignores watched episodes older than the latest play or outside the saved queue', () => {
    const list = latestPerSeries([episode('e5', { updatedAt: 2000 })], [
      { itemId: 'e6', watchedAt: 1000 },
      { itemId: 'other', watchedAt: 3000 },
    ]);
    expect(list.map(e => e.itemId)).toEqual(['e5']);
  });

  it('leaves movies and other series alone, newest first', () => {
    const other = { ...episode('e1', { updatedAt: 2500 }, ['e1', 'e2']), itemId: 'f1', watchlistOwner: owner('s2') };
    const list = latestPerSeries([
      movie('m2', 4000),
      episode('e5', { updatedAt: 3000 }),
      other,
      movie('m1', 2000),
      episode('e4', { updatedAt: 1000 }),
    ], [{ itemId: 'm1', watchedAt: 5000 }]);
    expect(list.map(e => e.itemId)).toEqual(['m2', 'e5', 'f1', 'm1']);
  });
});
