// Time math for the Guide inside Pleione's Live: a window of
// GUIDE_SPAN_MIN minutes that pages in half hours, and the program cell
// focus moves to along a channel's row.

export const HALF_HOUR_MS = 30 * 60 * 1000;
export const GUIDE_SPAN_MIN = 150;
export const GUIDE_SPAN_MS = GUIDE_SPAN_MIN * 60 * 1000;

export interface GuideProgram {
  start: number;
  stop: number;
}

export function alignHalfHour(ms: number): number {
  return Math.floor(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
}

// The window opens on the half hour before the current one, so the program
// that started a little earlier shows its start.
export function initialWindowStart(now: number): number {
  return alignHalfHour(now - HALF_HOUR_MS);
}

// Clamp a window start into the days the guide can page across.
export function clampWindow(start: number, now: number, backDays: number, aheadDays: number): number {
  const day = 24 * 60 * 60 * 1000;
  const min = alignHalfHour(now - backDays * day);
  const max = alignHalfHour(now + aheadDays * day);
  return Math.max(min, Math.min(max, start));
}

/** The program airing at `time`, if any. Programs are sorted by start. */
export function programAt<T extends GuideProgram>(programs: readonly T[], time: number): T | null {
  for (const program of programs) {
    if (program.start <= time && program.stop > time) return program;
    if (program.start > time) break;
  }
  return null;
}

/**
 * Where focus lands moving `dir` along a row from the cell that starts at
 * `from` (or the empty slot at `from`): the next program, or, past the
 * row's data, the next half hour so focus can still page through time.
 */
export function step<T extends GuideProgram>(
  programs: readonly T[], from: number, dir: -1 | 1,
): { program: T | null; time: number } {
  const current = programAt(programs, from);
  if (dir > 0) {
    const after = current ? current.stop : emptySlot(programs, from).stop;
    return { program: programAt(programs, after), time: after };
  }
  const before = current ? current.start : from;
  const previous = programAt(programs, before - 1);
  if (previous) return { program: previous, time: previous.start };
  return { program: null, time: emptySlot(programs, before - 1).start };
}

/**
 * The span of the empty slot holding `time` where a row has no program:
 * its half hour, cut short by the programs on either side.
 */
export function emptySlot(programs: readonly GuideProgram[], time: number): { start: number; stop: number } {
  let start = alignHalfHour(time);
  let stop = start + HALF_HOUR_MS;
  for (const program of programs) {
    if (program.stop <= time && program.stop > start) start = program.stop;
    if (program.start > time && program.start < stop) stop = program.start;
  }
  return { start, stop };
}

/**
 * The window start that shows a cell focus moved to: unchanged while at
 * least half an hour of it shows, else paged by whole half hours, never
 * further than one span at a time.
 */
export function pageTo(windowStart: number, cellStart: number, cellStop: number): number {
  const windowEnd = windowStart + GUIDE_SPAN_MS;
  if (cellStart < windowStart && cellStop - windowStart < HALF_HOUR_MS) {
    return Math.max(alignHalfHour(cellStart), windowStart - GUIDE_SPAN_MS + HALF_HOUR_MS);
  }
  if (cellStart > windowEnd - HALF_HOUR_MS) {
    return Math.min(alignHalfHour(cellStart) - HALF_HOUR_MS, windowStart + GUIDE_SPAN_MS - HALF_HOUR_MS);
  }
  return windowStart;
}

/** The horizontal box of a cell in the window, in px of `width`. */
export function cellBox(
  start: number, stop: number, windowStart: number, width: number,
): { left: number; width: number } | null {
  const from = Math.max(start, windowStart);
  const to = Math.min(stop, windowStart + GUIDE_SPAN_MS);
  if (to <= from) return null;
  const perMs = width / GUIDE_SPAN_MS;
  return { left: (from - windowStart) * perMs, width: (to - from) * perMs };
}

/** The first row to draw so that `row` shows among `visible` rows. */
export function firstRowFor(first: number, row: number, visible: number, count: number): number {
  const fit = Math.max(1, visible);
  let next = first;
  if (row < next) next = row;
  else if (row >= next + fit) next = row - fit + 1;
  return Math.max(0, Math.min(next, Math.max(0, count - fit)));
}
