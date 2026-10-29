import { describe, expect, it } from 'vitest';
import {
  firstPts, readPcrBase, readTimestamp, shiftSegment, TS_PACKET_SIZE, wrapPts,
} from './mpegts.mjs';

function encodeTimestamp(prefix, value) {
  return [
    (prefix << 4) | ((Math.floor(value / 2 ** 30) & 0x07) << 1) | 1,
    (Math.floor(value / 2 ** 15) >> 7) & 0xff,
    (((Math.floor(value / 2 ** 15) & 0x7f) << 1) | 1),
    (value & 0x7fff) >> 7,
    ((value & 0x7f) << 1) | 1,
  ];
}

// One packet: optional PCR in an adaptation field, then a PES header with PTS (+DTS).
function packet({ pid, cc = 0, pcr, pts, dts }) {
  const buf = Buffer.alloc(TS_PACKET_SIZE, 0xff);
  buf[0] = 0x47;
  buf[1] = 0x40 | (pid >> 8);
  buf[2] = pid & 0xff;
  let at = 4;
  if (pcr !== undefined) {
    buf[3] = 0x30 | cc;
    buf[4] = 7;
    buf[5] = 0x10;
    buf[6] = Math.floor(pcr / 2 ** 25) & 0xff;
    buf[7] = Math.floor(pcr / 2 ** 17) & 0xff;
    buf[8] = Math.floor(pcr / 2 ** 9) & 0xff;
    buf[9] = Math.floor(pcr / 2) & 0xff;
    buf[10] = ((pcr & 1) << 7) | 0x7e;
    buf[11] = 0;
    at = 12;
  } else {
    buf[3] = 0x10 | cc;
  }
  const header = [0, 0, 1, 0xe0, 0, 0, 0x80, dts === undefined ? 0x80 : 0xc0,
    dts === undefined ? 5 : 10, ...encodeTimestamp(dts === undefined ? 2 : 3, pts)];
  if (dts !== undefined) header.push(...encodeTimestamp(1, dts));
  Buffer.from(header).copy(buf, at);
  return { buf, ptsAt: at + 9, dtsAt: at + 14 };
}

describe('mpegts', () => {
  it('shifts PTS, DTS and PCR by the offset', () => {
    const { buf, ptsAt, dtsAt } = packet({ pid: 0x100, pcr: 120000, pts: 126000, dts: 123000 });
    const out = shiftSegment(buf, 5_400_000);
    expect(readTimestamp(out, ptsAt)).toBe(5_526_000);
    expect(readTimestamp(out, dtsAt)).toBe(5_523_000);
    expect(readPcrBase(out, 6)).toBe(5_520_000);
    expect(readTimestamp(buf, ptsAt)).toBe(126000);
  });

  it('wraps at 33 bits', () => {
    const { buf, ptsAt } = packet({ pid: 0x101, pts: 2 ** 33 - 10 });
    expect(readTimestamp(shiftSegment(buf, 20), ptsAt)).toBe(10);
    expect(wrapPts(-5)).toBe(2 ** 33 - 5);
  });

  it('renumbers continuity counters across segments', () => {
    const one = Buffer.concat([packet({ pid: 0x100, cc: 7, pts: 0 }).buf, packet({ pid: 0x100, cc: 8, pts: 1 }).buf]);
    const continuity = new Map();
    shiftSegment(one, 0, continuity);
    const next = shiftSegment(packet({ pid: 0x100, cc: 7, pts: 2 }).buf, 0, continuity);
    expect(next[3] & 0x0f).toBe(9);
  });

  it('finds the first PTS of a PID', () => {
    const buf = Buffer.concat([packet({ pid: 0x101, pts: 900 }).buf, packet({ pid: 0x100, pts: 1800 }).buf]);
    expect(firstPts(buf)).toBe(900);
    expect(firstPts(buf, 0x100)).toBe(1800);
  });

  it('rejects data that is not MPEG-TS', () => {
    expect(() => shiftSegment(Buffer.alloc(100), 0)).toThrow('multiple of 188');
    expect(() => shiftSegment(Buffer.alloc(188), 0)).toThrow('sync');
  });
});
