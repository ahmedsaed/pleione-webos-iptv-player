import { ImageResponse } from 'next/og';

import { blue, dataUri, fonts, ink, logoUri, sky, violet } from './render';

/**
 * The LG Content Store listing's images, drawn at build time and published
 * under `/store/` (see `store/README.md` for what goes where in Seller Lounge).
 *
 * The screenshots are the app's real 1920×1080 captures, unframed and
 * uncaptioned: LG reviews a screenshot as the app's own screen, and a TV
 * screenshot already is the size LG asks for. Their ORDER lives here, so the
 * listing and the store page cannot disagree about which one is the primary.
 */

export const SHOT_SIZE = { width: 1920, height: 1080 };
export const ICON_SIZE = { width: 400, height: 400 };

type StoreShot = {
  /** A capture in store/screenshots. */
  shot: string;
  /** What the screen shows, for the store page and the listing. */
  label: string;
};

/** In listing order: the first is LG's primary screenshot. */
export const STORE_SHOTS: StoreShot[] = [
  { shot: 'home', label: 'Home' },
  { shot: 'movies', label: 'Movies' },
  { shot: 'series-detail', label: 'Series detail' },
  { shot: 'guide', label: 'Program guide' },
  { shot: 'player', label: 'Live player' },
  { shot: 'search', label: 'Search' },
];

export function storeShot(index: number) {
  const { shot } = STORE_SHOTS[index];
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <img src={dataUri(`public/screenshots/${shot}.png`)} width={1920} height={1080} />
      </div>
    ),
    SHOT_SIZE,
  );
}

/** The 400×400 store icon: the app's logo, drawn from its SVG at full size. */
export function storeIcon() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <img src={logoUri()} width={400} height={400} />
      </div>
    ),
    ICON_SIZE,
  );
}

/**
 * 1920×1080, shown behind the app's details in the store and launcher. LG lays
 * its own title, text and buttons over the left and bottom, so the mark sits
 * right of center, the rest is sky, and there are no words of our own.
 */
export function launcherBackground() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundImage: sky('78% 30%', '30% 90%'),
          color: ink,
          fontFamily: 'Roboto',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Faint stars: fixed positions, so every build draws the same sky. */}
        {STARS.map(([x, y, r], i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              background: i % 3 === 0 ? violet : i % 3 === 1 ? blue : '#ffffff',
              opacity: 0.35,
            }}
          />
        ))}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'absolute',
            left: 1110,
            top: 330,
            width: 420,
          }}
        >
          <img src={logoUri()} width={420} height={420} style={{ borderRadius: 96 }} />
        </div>
      </div>
    ),
    { ...SHOT_SIZE, fonts: fonts() },
  );
}

const STARS: [number, number, number][] = [
  [140, 120, 2], [380, 260, 1.5], [620, 90, 2.5], [860, 210, 1.5], [1010, 70, 2],
  [1340, 140, 1.5], [1720, 90, 2.5], [1830, 320, 1.5], [1600, 860, 2], [1820, 980, 1.5],
  [960, 980, 2], [700, 760, 1.5], [420, 900, 2.5], [180, 640, 1.5], [90, 980, 2],
  [520, 470, 1.5], [800, 520, 2], [260, 380, 1.5], [1500, 540, 1.5], [1180, 900, 2.5],
];
