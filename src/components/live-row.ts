import type { Programme } from '../types';

export interface LiveRowSchedule {
  now: { title: string; progress: number } | null;
  next: { start: Date; title: string } | null;
}

// What a Live row shows from the guide: the current program with how far it
// has run (0..1), and the next program that starts after it.
export function liveRowSchedule(
  current: Programme | null,
  upcoming: readonly Programme[],
  at: number,
): LiveRowSchedule {
  let now: LiveRowSchedule['now'] = null;
  if (current) {
    const length = current.stop.getTime() - current.start.getTime();
    const progress = length > 0
      ? Math.max(0, Math.min(1, (at - current.start.getTime()) / length))
      : 0;
    now = { title: current.title, progress };
  }
  const after = current ? current.stop.getTime() : at;
  const following = upcoming.find(item =>
    item.start.getTime() >= after - 1000 && item.stop.getTime() > item.start.getTime()
    && item !== current);
  return {
    now,
    next: following ? { start: following.start, title: following.title } : null,
  };
}
