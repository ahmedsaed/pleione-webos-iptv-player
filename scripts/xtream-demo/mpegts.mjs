// MPEG-TS packet surgery for the demo server's looping live media. A loop of
// pre-encoded segments is replayed forever by shifting every PTS/DTS/PCR by a
// whole number of loops, so players see one continuous, ever-advancing
// timeline instead of a timestamp jump at each loop seam.

export const TS_PACKET_SIZE = 188;
export const PTS_HZ = 90000;
const PTS_WRAP = 2 ** 33;
const SYNC_BYTE = 0x47;
const NULL_PID = 0x1fff;
// PES stream ids without the optional header that carries PTS/DTS (ISO 13818-1 table 2-21).
const NO_PES_HEADER = new Set([0xbc, 0xbe, 0xbf, 0xf0, 0xf1, 0xf2, 0xf8, 0xff]);

export function wrapPts(value) {
  const wrapped = value % PTS_WRAP;
  return wrapped < 0 ? wrapped + PTS_WRAP : wrapped;
}

export function readTimestamp(buf, at) {
  return ((buf[at] >> 1) & 0x07) * 2 ** 30
    + ((buf[at + 1] << 7) | (buf[at + 2] >> 1)) * 2 ** 15
    + ((buf[at + 3] << 7) | (buf[at + 4] >> 1));
}

function writeTimestamp(buf, at, value) {
  const high = Math.floor(value / 2 ** 30) & 0x07;
  const mid = Math.floor(value / 2 ** 15) & 0x7fff;
  const low = value & 0x7fff;
  // Keep the 4-bit '0010'/'0011'/'0001' prefix; markers are always 1.
  buf[at] = (buf[at] & 0xf0) | (high << 1) | 0x01;
  buf[at + 1] = mid >> 7;
  buf[at + 2] = ((mid & 0x7f) << 1) | 0x01;
  buf[at + 3] = low >> 7;
  buf[at + 4] = ((low & 0x7f) << 1) | 0x01;
}

export function readPcrBase(buf, at) {
  return buf[at] * 2 ** 25 + buf[at + 1] * 2 ** 17 + buf[at + 2] * 2 ** 9
    + buf[at + 3] * 2 + (buf[at + 4] >> 7);
}

function writePcrBase(buf, at, base) {
  buf[at] = Math.floor(base / 2 ** 25) & 0xff;
  buf[at + 1] = Math.floor(base / 2 ** 17) & 0xff;
  buf[at + 2] = Math.floor(base / 2 ** 9) & 0xff;
  buf[at + 3] = Math.floor(base / 2) & 0xff;
  buf[at + 4] = ((base & 1) << 7) | (buf[at + 4] & 0x7f);
}

// Walk the packets, yielding the byte offsets of interest in each one.
function eachPacket(buf, visit) {
  if (buf.length % TS_PACKET_SIZE !== 0) {
    throw new Error(`MPEG-TS length ${buf.length} is not a multiple of ${TS_PACKET_SIZE}`);
  }
  for (let pos = 0; pos < buf.length; pos += TS_PACKET_SIZE) {
    if (buf[pos] !== SYNC_BYTE) throw new Error(`Lost MPEG-TS sync at byte ${pos}`);
    const pid = ((buf[pos + 1] & 0x1f) << 8) | buf[pos + 2];
    const unitStart = (buf[pos + 1] & 0x40) !== 0;
    const control = (buf[pos + 3] >> 4) & 0x03;
    const end = pos + TS_PACKET_SIZE;
    let payload = pos + 4;
    let pcr = -1;
    if (control & 0x02) {
      const length = buf[pos + 4];
      if (length > 0 && (buf[pos + 5] & 0x10) && pos + 12 <= end) pcr = pos + 6;
      payload = pos + 5 + length;
    }
    const hasPayload = (control & 0x01) !== 0 && payload < end;
    let pts = -1;
    let dts = -1;
    if (hasPayload && unitStart && payload + 14 <= end
        && buf[payload] === 0 && buf[payload + 1] === 0 && buf[payload + 2] === 1
        && !NO_PES_HEADER.has(buf[payload + 3])) {
      const flags = buf[payload + 7] >> 6;
      if (flags & 0x02) pts = payload + 9;
      if (flags === 0x03 && payload + 19 <= end) dts = payload + 14;
    }
    visit({ pos, pid, hasPayload, pcr, pts, dts });
  }
}

/** First PES presentation timestamp in a segment, optionally for one PID. */
export function firstPts(buf, pid) {
  let found = -1;
  eachPacket(buf, (packet) => {
    if (found < 0 && packet.pts >= 0 && (pid === undefined || packet.pid === pid)) {
      found = readTimestamp(buf, packet.pts);
    }
  });
  return found;
}

/**
 * Copy of `buf` with every PTS, DTS and PCR shifted by `offset` 90 kHz ticks.
 * With a `continuity` map (pid -> last counter), continuity counters are
 * renumbered too, so back-to-back segments form one gapless transport stream.
 */
export function shiftSegment(buf, offset, continuity) {
  const out = Buffer.from(buf);
  eachPacket(out, ({ pos, pid, hasPayload, pcr, pts, dts }) => {
    if (offset) {
      if (pcr >= 0) writePcrBase(out, pcr, wrapPts(readPcrBase(out, pcr) + offset));
      if (pts >= 0) writeTimestamp(out, pts, wrapPts(readTimestamp(out, pts) + offset));
      if (dts >= 0) writeTimestamp(out, dts, wrapPts(readTimestamp(out, dts) + offset));
    }
    if (continuity && hasPayload && pid !== NULL_PID) {
      const previous = continuity.get(pid);
      const counter = previous === undefined ? out[pos + 3] & 0x0f : (previous + 1) & 0x0f;
      out[pos + 3] = (out[pos + 3] & 0xf0) | counter;
      continuity.set(pid, counter);
    }
  });
  return out;
}
