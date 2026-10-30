import { ImageResponse } from 'next/og';

import { blue, dataUri, fonts, ink, muted, sky, Tv, Wordmark, words } from './render';

/**
 * The 1200×630 card a link to this site unfurls into, rendered to a PNG at
 * BUILD time by `app/og/[card]/route.tsx` and named in each page's metadata
 * through `pageMeta`.
 *
 * Generated rather than drawn once in an editor, because the TVs on it show
 * the app's real screenshots: when `npm run screenshots:store` replaces them,
 * every card follows on the next build.
 */
export const cardSize = { width: 1200, height: 630 };

type Card = {
  /** Small caps line above the title; omitted on the home card. */
  eyebrow?: string;
  title: string;
  /** Trailing words of the title, drawn in the accent color. */
  highlight?: string;
  subtitle: string;
  /** Two screenshot names from store/screenshots: back, front. */
  shots: [string, string];
  /** What the card shows, for og:image:alt. */
  alt: string;
};

export const CARDS = {
  home: {
    title: 'Your TV, your',
    highlight: 'provider.',
    subtitle: 'A free IPTV player for LG webOS TVs. M3U and Xtream, guide, catch-up, movies and series.',
    shots: ['movie-detail', 'home'],
    alt: 'Pleione, a free IPTV player for LG webOS TVs, with two screens of the app.',
  },
  privacy: {
    eyebrow: 'Privacy policy',
    title: 'Your accounts stay',
    highlight: 'on your TV.',
    subtitle: 'No account with us, no analytics, no server of ours. Requests go to your own providers.',
    shots: ['settings', 'live'],
    alt: 'The Pleione privacy policy.',
  },
  terms: {
    eyebrow: 'Terms of use',
    title: 'A player,',
    highlight: 'not a provider.',
    subtitle: 'Pleione ships no channels or content. You bring your own, and you answer for it.',
    shots: ['live', 'guide'],
    alt: 'The Pleione terms of use.',
  },
  setup: {
    eyebrow: 'Setup guide',
    title: 'From install to',
    highlight: 'first channel.',
    subtitle: 'Install Pleione, add your M3U playlist or Xtream account, or set it up from your phone.',
    shots: ['settings', 'home'],
    alt: 'Setting up Pleione on an LG TV.',
  },
  support: {
    eyebrow: 'Support',
    title: 'Something not',
    highlight: 'working?',
    subtitle: 'Where to report a bug, ask a question, or reach the developer.',
    shots: ['player', 'search'],
    alt: 'Getting help with Pleione.',
  },
  credits: {
    eyebrow: 'Open source',
    title: 'Built on',
    highlight: 'open source.',
    subtitle: 'Pleione is free software under the Apache-2.0 license, based on webOS IPTV Player.',
    shots: ['series-detail', 'movies'],
    alt: 'Open-source credits for Pleione.',
  },
} satisfies Record<string, Card>;

export type CardName = keyof typeof CARDS;

export function socialCard({ eyebrow, title, highlight, subtitle, shots }: Card) {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundImage: sky('85% 15%', '15% 100%'),
          color: ink,
          fontFamily: 'Roboto',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: 620,
            padding: '60px 0 56px 68px',
          }}
        >
          <Wordmark size={60} />

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {eyebrow ? (
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  color: muted,
                  marginBottom: 16,
                }}
              >
                {eyebrow}
              </div>
            ) : null}
            {/* Word by word: Satori lays out multi-child text as flex items, so a
                single highlighted span would wrap as one block. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                fontSize: 58,
                fontWeight: 900,
                lineHeight: 1.08,
                letterSpacing: -1.5,
              }}
            >
              {words(title).map((word, i) => (
                <span key={`t${i}`} style={{ marginRight: 15 }}>
                  {word}
                </span>
              ))}
              {words(highlight ?? '').map((word, i) => (
                <span key={`h${i}`} style={{ marginRight: 15, color: blue }}>
                  {word}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 26, lineHeight: 1.4, color: muted, marginTop: 22, maxWidth: 520 }}>
              {subtitle}
            </div>
          </div>

          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: ink }}>pleione.merope.dev</div>
        </div>

        <div style={{ display: 'flex', position: 'relative', flex: 1 }}>
          <Tv src={dataUri(`public/screenshots/${shots[0]}.png`)} width={560} style={{ left: 120, top: 70 }} />
          <Tv src={dataUri(`public/screenshots/${shots[1]}.png`)} width={560} style={{ left: 30, top: 290 }} />
        </div>
      </div>
    ),
    { ...cardSize, fonts: fonts() },
  );
}
