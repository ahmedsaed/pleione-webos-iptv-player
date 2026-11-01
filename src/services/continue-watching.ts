import type { ResumeEntry } from '../types';
import { extFromUrl } from '../utils/url';

export interface WatchedTime {
  itemId: string;
  watchedAt: number;
}

// A series' episodes in viewing order, as the entry's player queue knew them.
function viewingOrder(entry: ResumeEntry): string[] {
  return (entry.previousEpisodes ?? []).map(item => item.itemId)
    .concat(entry.itemId, (entry.episodeQueue ?? []).map(item => item.itemId));
}

// Continue Watching keeps one entry per series: the episode played last. When
// that episode was finished (a watched record newer than every resume point,
// found through a saved episode queue) the series continues at the episode
// after it, or leaves the list after its last one. `entries` is newest first.
export function latestPerSeries(entries: ResumeEntry[], watched: WatchedTime[]): ResumeEntry[] {
  const watchedAt: Record<string, number> = {};
  for (const item of watched) watchedAt[item.itemId] = item.watchedAt;
  const groups: Record<string, ResumeEntry[]> = {};
  const result: ResumeEntry[] = [];
  for (const entry of entries) {
    const seriesId = entry.kind === 'episode' ? entry.watchlistOwner?.itemId : undefined;
    if (!seriesId) {
      result.push(entry);
      continue;
    }
    if (!groups[seriesId]) groups[seriesId] = [];
    groups[seriesId].push(entry);
  }
  for (const seriesId of Object.keys(groups)) {
    const next = seriesEntry(groups[seriesId], watchedAt);
    if (next) result.push(next);
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

function seriesEntry(group: ResumeEntry[], watchedAt: Record<string, number>): ResumeEntry | null {
  const latest = group[0];
  let finishedId = '';
  let finishedAt = latest.updatedAt;
  for (const entry of group) {
    for (const id of viewingOrder(entry)) {
      const at = watchedAt[id];
      if (at !== undefined && at > finishedAt) {
        finishedId = id;
        finishedAt = at;
      }
    }
  }
  if (!finishedId) return latest;
  // The newest entry whose queue holds the finished episode knows what follows it.
  for (const entry of group) {
    const order = viewingOrder(entry);
    const index = order.indexOf(finishedId);
    if (index < 0) continue;
    const nextId = order[index + 1];
    if (!nextId) return null;
    const saved = group.filter(e => e.itemId === nextId)[0];
    if (saved) return { ...saved, updatedAt: finishedAt };
    return nextEpisode(entry, nextId, finishedAt);
  }
  return null;
}

// The episode after a finished one, from the start, with the rest of the
// saved queue after it. The series page rebuilds both lists when it plays it.
function nextEpisode(entry: ResumeEntry, nextId: string, updatedAt: number): ResumeEntry | null {
  const queue = entry.episodeQueue ?? [];
  const items = (entry.previousEpisodes ?? []).concat(queue);
  const next = items.filter(item => item.itemId === nextId)[0];
  if (!next) return null;
  const queued = queue.indexOf(next);
  return {
    accountId: entry.accountId,
    kind: 'episode',
    itemId: next.itemId,
    name: next.title,
    poster: next.poster,
    ext: extFromUrl(next.url),
    position: 0,
    duration: 0,
    updatedAt,
    episodeQueue: queued >= 0 ? queue.slice(queued + 1) : undefined,
    watchlistOwner: next.watchlistOwner ?? entry.watchlistOwner,
    categoryId: next.categoryId ?? entry.categoryId,
  };
}
