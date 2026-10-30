import { describe, expect, it } from 'vitest';
import {
  GUIDE_SPAN_MS,
  HALF_HOUR_MS,
  alignHalfHour,
  cellBox,
  clampWindow,
  emptySlot,
  firstRowFor,
  initialWindowStart,
  pageTo,
  programAt,
  step,
} from './live-guide-math';

const at = (h: number, m = 0) => Date.UTC(2026, 8, 15, h, m);
const p = (from: number, to: number) => ({ start: from, stop: to });
// 20:00-21:00, 21:00-21:30, gap, 22:10-23:00
const ROW = [p(at(20), at(21)), p(at(21), at(21, 30)), p(at(22, 10), at(23))];

describe('the Guide window', () => {
  it('opens on the half hour before the current one', () => {
    expect(initialWindowStart(at(20, 42))).toBe(at(20));
    expect(initialWindowStart(at(20, 10))).toBe(at(19, 30));
    expect(alignHalfHour(at(20, 59))).toBe(at(20, 30));
  });

  it('pages only within the days it allows', () => {
    const now = at(12);
    expect(clampWindow(now - 10 * 24 * 3600000, now, 7, 7)).toBe(now - 7 * 24 * 3600000);
    expect(clampWindow(now + 10 * 24 * 3600000, now, 7, 7)).toBe(now + 7 * 24 * 3600000);
    expect(clampWindow(at(11), now, 7, 7)).toBe(at(11));
  });

  it('keeps the window while half an hour of the focused cell shows', () => {
    expect(pageTo(at(20), at(21), at(21, 30))).toBe(at(20));
    expect(pageTo(at(20), at(19), at(20, 45))).toBe(at(20));
  });

  it('pages forward to show a cell starting near the end, a span at most', () => {
    expect(pageTo(at(20), at(22), at(23))).toBe(at(20));
    expect(pageTo(at(20), at(22, 10), at(23))).toBe(at(21, 30));
    expect(pageTo(at(20), at(23, 30), at(24))).toBe(at(20) + GUIDE_SPAN_MS - HALF_HOUR_MS);
  });

  it('pages back to a cell that ended before the window, a span at most', () => {
    expect(pageTo(at(20), at(19), at(20, 10))).toBe(at(19));
    expect(pageTo(at(20), at(10), at(10, 30))).toBe(at(20) - GUIDE_SPAN_MS + HALF_HOUR_MS);
  });

  it('places a cell in px and clips it to the window', () => {
    const width = 1500;
    expect(cellBox(at(20), at(21), at(20), width)).toEqual({ left: 0, width: 600 });
    expect(cellBox(at(19), at(20, 30), at(20), width)).toEqual({ left: 0, width: 300 });
    expect(cellBox(at(22), at(23), at(20), width)).toEqual({ left: 1200, width: 300 });
    expect(cellBox(at(23), at(24), at(20), width)).toBeNull();
  });
});

describe('moving along a row', () => {
  it('finds the program airing at a time', () => {
    expect(programAt(ROW, at(20, 30))).toBe(ROW[0]);
    expect(programAt(ROW, at(21))).toBe(ROW[1]);
    expect(programAt(ROW, at(21, 45))).toBeNull();
  });

  it('steps to the next and previous programs', () => {
    expect(step(ROW, at(20), 1)).toEqual({ program: ROW[1], time: at(21) });
    expect(step(ROW, at(21), -1)).toEqual({ program: ROW[0], time: at(20) });
  });

  it('crosses a gap in empty slots cut by the programs around it', () => {
    expect(emptySlot(ROW, at(21, 45))).toEqual({ start: at(21, 30), stop: at(22) });
    expect(emptySlot(ROW, at(22, 5))).toEqual({ start: at(22), stop: at(22, 10) });
    expect(step(ROW, at(21), 1)).toEqual({ program: null, time: at(21, 30) });
    expect(step(ROW, at(21, 30), 1)).toEqual({ program: null, time: at(22) });
    expect(step(ROW, at(22), 1)).toEqual({ program: ROW[2], time: at(22, 10) });
    expect(step(ROW, at(22, 10), -1)).toEqual({ program: null, time: at(22) });
    expect(step(ROW, at(21, 30), -1)).toEqual({ program: ROW[1], time: at(21) });
  });

  it('pages through time in half hours on a row without programs', () => {
    expect(step([], at(20, 30), 1)).toEqual({ program: null, time: at(21) });
    expect(step([], at(20, 30), -1)).toEqual({ program: null, time: at(20) });
  });
});

describe('the rows on screen', () => {
  it('scrolls only as far as needed to show the focused row', () => {
    expect(firstRowFor(0, 3, 8, 20)).toBe(0);
    expect(firstRowFor(0, 8, 8, 20)).toBe(1);
    expect(firstRowFor(5, 2, 8, 20)).toBe(2);
    expect(firstRowFor(0, 19, 8, 20)).toBe(12);
    expect(firstRowFor(10, 3, 8, 5)).toBe(0);
  });
});
