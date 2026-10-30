import { describe, expect, it } from 'vitest';
import type { Programme } from '../types';
import { liveRowSchedule } from './live-row';

const at = (h: number, m: number) => new Date(2026, 0, 1, h, m).getTime();
const program = (title: string, from: number, to: number): Programme => ({
  title, start: new Date(from), stop: new Date(to), description: '', category: '', icon: '',
});

describe('liveRowSchedule', () => {
  it('reports how far the current program has run and what starts next', () => {
    const current = program('Program 1', at(20, 0), at(21, 0));
    const next = program('Program 2', at(21, 0), at(21, 30));
    const row = liveRowSchedule(current, [next], at(20, 45));
    expect(row.now).toEqual({ title: 'Program 1', progress: 0.75 });
    expect(row.next).toEqual({ start: next.start, title: 'Program 2' });
  });

  it('clamps progress to the program', () => {
    const current = program('Program 1', at(20, 0), at(21, 0));
    expect(liveRowSchedule(current, [], at(19, 0)).now?.progress).toBe(0);
    expect(liveRowSchedule(current, [], at(22, 0)).now?.progress).toBe(1);
  });

  it('skips programs with no length and ones that start before the current one ends', () => {
    const current = program('Program 1', at(20, 0), at(21, 0));
    const overlap = program('Program 9', at(20, 30), at(21, 30));
    const empty = program('Program 8', at(21, 0), at(21, 0));
    const next = program('Program 2', at(21, 0), at(22, 0));
    expect(liveRowSchedule(current, [overlap, empty, next], at(20, 10)).next?.title)
      .toBe('Program 2');
  });

  it('shows the next program when nothing airs now', () => {
    const next = program('Program 2', at(21, 0), at(22, 0));
    const row = liveRowSchedule(null, [next], at(20, 10));
    expect(row.now).toBeNull();
    expect(row.next?.title).toBe('Program 2');
  });

  it('is empty without guide data', () => {
    expect(liveRowSchedule(null, [], at(20, 0))).toEqual({ now: null, next: null });
  });
});
